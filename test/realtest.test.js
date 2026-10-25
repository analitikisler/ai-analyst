// Fixes from the real-service tests (Claude and BigQuery, step 1 and 2), one test per bug. Every model and every
// Google call is a stub: nothing here reaches a real service.
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { callAction } from "../src/actions/index.js";
import { compactCheck, compactQuery } from "../src/actions/data.js";
import { localCredentials, quotaProjectProblem, safeGoogleMessage } from "../src/actions/settings.js";
import { capText, runTurn, systemPrompt, TEXT_CAP } from "../src/agent/agent.js";
import { openAiAdapter } from "../src/agent/providers.js";
import { reconcile } from "../src/checks/reconcile.js";
import { runQuery } from "../src/engine.js";
import { compileAggregate } from "../src/metrics/compile.js";
import { ctxFor, demoWorkspace } from "./helpers.js";

function stubAnthropic(steps) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        stream(params) {
          requests.push(structuredClone(params));
          const step = steps[requests.length - 1];
          return { finalMessage: async () => (step ? step(params) : { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" }) };
        },
      },
    },
  };
}
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const resultOf = (params, id) => {
  const r = params.messages.at(-1).content.find((b) => b.tool_use_id === id);
  return { ...r, json: r.is_error ? null : JSON.parse(r.content) };
};

let ws;
before(async () => (ws = await demoWorkspace({ seed: true })));
after(() => ws.close());

const ask = async (client, question) => {
  const events = [];
  const turn = await runTurn({ question, lang: "en", conversationId: "new", app: { ...ws, modelClient: client }, emit: (t, d) => events.push([t, d]) });
  return { turn, events };
};

/** A model turn: the first step runs these tools, the second publishes with what publish(results) returns. */
const twoStep = (calls, publish, extra = []) =>
  stubAnthropic([
    () => ({ content: calls.map(([id, name, input]) => toolUse(id, name, input)), stop_reason: "tool_use" }),
    (p) => {
      const r = Object.fromEntries(calls.map(([id]) => [id, resultOf(p, id).json]));
      return { content: [toolUse("pub", "publish_answer", publish(r))], stop_reason: "tool_use" };
    },
    ...extra,
  ]);

test("B1 · N2: a turn that ends with text and no card stores the text, which get_conversation returns; long text is capped", async () => {
  const long = `I can't answer that from this data. The mart has no product or returns columns.\n\n- Revenue by channel\n- **Orders** by device\n\n${"More words here. ".repeat(200)}`;
  const client = stubAnthropic([() => ({ content: [{ type: "text", text: long }], stop_reason: "end_turn" })]);
  const { turn, events } = await ask(client, "Which products are returned most often?");
  assert.equal(turn.error, null);
  assert.equal(turn.answers.length, 0);
  assert.ok(turn.text?.en.startsWith("I can't answer that from this data."));
  assert.ok(turn.text.en.length <= TEXT_CAP.alone + 1);
  assert.ok(turn.text.en.endsWith("…"));
  assert.ok(events.some(([t]) => t === "text"));
  const conv = await callAction("get_conversation", { conversation_id: turn.conversation_id }, ctxFor(ws));
  assert.equal(conv.turn_list.at(-1).text.en, turn.text.en, "the text survives a reload");
  assert.equal(capText("Short.", 400), "Short.");
  assert.equal(capText("One. Two. Three.", 10), "One. Two.…");
});

test("B2: publish_answer kind why on a check that does not add up is a why card; on one that adds up it is refused", async () => {
  const client = twoStep([["r", "reconcile", { check: "ga4_vs_orders", from: "2026-10-09", to: "2026-10-22" }], ["q", "run_query", { metric: "orders", group_by: "device", from: "2026-10-09", to: "2026-10-22" }]], (r) => ({
    kind: "why",
    sentence: { en: "GA4 misses purchases on mobile since the release.", tr: "GA4 sürümden beri mobilde satın almaları kaçırıyor." },
    query_id: r.q.query_id,
    check_id: r.r.check_id,
  }));
  const { turn } = await ask(client, "Why does it not add up?");
  const a = turn.answers[0];
  assert.equal(a.kind, "why");
  assert.equal(a.check.verdict, "does_not_add_up");
  assert.equal(a.why.started, a.check.out_of_tolerance_since);
  assert.ok(Array.isArray(a.why.next) && a.why.next.length);

  const adds = twoStep(
    [["r", "reconcile", { check: "ga4_vs_orders", from: "2026-09-25", to: "2026-10-08" }], ["q", "run_query", { metric: "orders", from: "2026-09-25", to: "2026-10-08" }]],
    (r) => ({ kind: "why", sentence: { en: "No gap.", tr: "Fark yok." }, query_id: r.q.query_id, check_id: r.r.check_id }),
    [(p) => {
      const res = resultOf(p, "pub");
      assert.equal(res.is_error, true);
      assert.match(res.content, /adds up/);
      return { content: [{ type: "text", text: "It adds up in that period." }], stop_reason: "end_turn" };
    }],
  );
  const t2 = await ask(adds, "Why does it not add up?");
  assert.equal(t2.turn.answers.length, 0);
  assert.match(systemPrompt({ pack: ws.pack, range: { from: "2026-07-25", to: "2026-10-22" }, workspace: "W", demo: true, lang: "en" }), /kind "why"/);
});

test("B3: a segment makes a check_split card with the segment's figures and the whole check on one line", async () => {
  const client = twoStep([["r", "reconcile", { check: "ga4_vs_orders", from: "2026-10-09", to: "2026-10-22" }], ["q", "run_query", { metric: "orders", group_by: "device", from: "2026-10-09", to: "2026-10-22" }]], (r) => ({
    sentence: { en: "The gap is on mobile.", tr: "Fark mobilde." },
    query_id: r.q.query_id,
    check_id: r.r.check_id,
    segment: { dimension: "device", key: "mobile" },
  }));
  const { turn } = await ask(client, "Is the gap only on mobile?");
  const a = turn.answers[0];
  const whole = ws.store.getCheck(a.check.id) ? a.check : null;
  assert.ok(whole);
  assert.equal(a.kind, "check_split");
  assert.deepEqual(a.check.filters.device, ["mobile"]);
  assert.match(a.check.label.en, /Mobile$/);
  assert.ok(a.overall && Math.abs(a.overall.delta_pct - -0.101) < 0.001, "the whole check is the overall line");
  assert.notEqual(a.check.delta_pct, a.overall.delta_pct, "the headline is the segment's, not the all-device figure");
  assert.ok(Math.abs(a.check.delta_pct - -0.156) < 0.001);
});

test("B4: the Turkish back-office term is scoped to Turkish", () => {
  const p = systemPrompt({ pack: ws.pack, range: { from: "2026-07-25", to: "2026-10-22" }, workspace: "W", demo: true, lang: "en" });
  assert.doesNotMatch(p, /Use "sipariş paneli" for the back office/);
  assert.match(p, /In Turkish[^.]*call the back office "sipariş paneli"\. In English call it "the back office"; never use the Turkish term in English text\./);
});

test("B5: an exploratory answer cannot carry a check", async () => {
  ws.store.put("queries", { id: "x_b5test", created_at: new Date().toISOString(), explore: { label: { en: "X", tr: "X" } } }, { kind: "explore" });
  const c = await reconcile({ pack: ws.pack, warehouse: ws.warehouse, check: "ga4_vs_orders" });
  ws.store.saveCheck(c);
  await assert.rejects(
    callAction("publish_answer", { sentence: { en: "Email leads.", tr: "E-posta önde." }, explore_id: "x_b5test", check_id: c.id }, ctxFor(ws, "agent")),
    (e) => e.code === "invalid_input" && /without check_id/.test(e.message),
  );
});

test("B6: the agent lists dashboards and pins by name; the pin comes back as an approval card", async () => {
  const client = stubAnthropic([
    () => ({ content: [toolUse("q", "run_query", { metric: "roas", group_by: "channel" }), toolUse("d", "list_dashboards", {})], stop_reason: "tool_use" }),
    (p) => {
      const q = resultOf(p, "q").json;
      const dash = resultOf(p, "d").json;
      assert.ok(dash.some((d) => d.dashboard_id && d.name.en === "Shop overview"));
      return { content: [toolUse("pub", "publish_answer", { sentence: { en: "ROAS by channel.", tr: "Kanala göre ROAS." }, query_id: q.query_id })], stop_reason: "tool_use" };
    },
    (p) => ({ content: [toolUse("pin", "propose_pin", { answer_id: resultOf(p, "pub").json.answer_id, dashboard_id: "Shop overview" })], stop_reason: "tool_use" }),
    (p) => {
      assert.equal(resultOf(p, "pin").is_error, undefined);
      return { content: [{ type: "text", text: "The pin waits for approval." }], stop_reason: "end_turn" };
    },
  ]);
  const { turn, events } = await ask(client, "Pin ROAS by channel to Shop overview");
  const approval = events.find(([t]) => t === "approval");
  assert.ok(approval, "an approval card");
  assert.equal(approval[1].proposal.kind, "pin");
  assert.equal(turn.approvals.length, 1);
  await assert.rejects(callAction("propose_pin", { answer_id: turn.answers[0].id, dashboard_id: "shop_overview" }, ctxFor(ws, "agent")), (e) => e.code === "not_found" && /The dashboards are/.test(e.message));
});

test("B7: missing (NULL) data is never zero: SUM keeps NULL, a check side with no data is insufficient_data with a reason, a ratio over no spend is no data", async () => {
  for (const dialect of ["duckdb", "bigquery"]) {
    const sql = compileAggregate(ws.pack.metrics.roas, { dims: ["channel"], from: "2026-10-01", to: "2026-10-14", dialect, table: "t" });
    assert.doesNotMatch(sql, /COALESCE|IFNULL/i);
  }
  const days = ["2026-10-01", "2026-10-02"];
  const channels = ["organic", "direct", "google_ads", "meta_ads", "tiktok_ads", "email"];
  // A mart with orders and revenue but no GA4, platform or ad spend columns filled (all NULL).
  const warehouse = {
    dialect: "duckdb",
    table: "daily_channel_device",
    demo: false,
    range: async () => ({ from: days[0], to: days[1], rows: 24 }),
    async query(sql) {
      const has = (col) => new RegExp(`SUM\\(${col}\\)`).test(sql);
      const value = has("orders") ? 10 : has("revenue") && !has("ga4_revenue") ? 1000 : null;
      const dims = (sql.match(/GROUP BY (.*)/)?.[1] ?? "").split(", ").filter(Boolean);
      const out = [];
      for (const day of days) for (const device of ["mobile", "desktop"]) for (const channel of channels) {
        const r = { day, device, channel };
        if (/numerator/.test(sql)) Object.assign(r, { numerator: has("revenue") ? 1000 : 10, denominator: null, value: null });
        else r.value = value;
        out.push(r);
      }
      if (!dims.length) return [out.reduce((a, r) => ({ value: r.value == null ? a.value : (a.value ?? 0) + r.value, numerator: r.numerator ?? null, denominator: null }), { value: null })];
      return out;
    },
  };
  const c = await reconcile({ pack: ws.pack, warehouse, check: "ga4_vs_orders" });
  assert.equal(c.verdict, "insufficient_data");
  assert.equal(c.measured.value, null);
  assert.equal(c.expected.value, 240);
  assert.equal(c.delta, null);
  assert.equal(c.delta_pct, null);
  assert.match(c.reason.en, /No data for ga4 purchases/i);
  assert.ok(c.breakdown.every((b) => b.verdict === "insufficient_data" && b.measured === null && b.reason));
  assert.ok(c.series.every((p) => p.measured === null));
  const store = ws.store;
  const roas = await runQuery({ pack: ws.pack, warehouse, store }, { metric: "roas", group_by: "channel" }, { save: false });
  assert.equal(roas.total, null, "ROAS with no ad spend is no data, not infinity");
  assert.ok(roas.rows.every((r) => r.value === null));
  const spend = await runQuery({ pack: ws.pack, warehouse, store }, { metric: "ad_spend" }, { save: false });
  assert.equal(spend.total, null, "spend over only NULLs is NULL, not 0 TL");
  const forModel = compactQuery(spend);
  assert.equal(forModel.total_formatted, "–");
  assert.match(forModel.total_note, /missing, not zero/);
});

test("B9: tool results carry channel and device labels in both languages; grounding still passes with labels", async () => {
  const q = await runQuery({ pack: ws.pack, warehouse: ws.warehouse, store: ws.store }, { metric: "orders", group_by: "channel", from: "2026-10-09", to: "2026-10-22" });
  const m = compactQuery(q);
  assert.deepEqual(m.labels.google_ads, { en: "Google Ads", tr: "Google Ads" });
  assert.deepEqual(m.labels.email, { en: "Email", tr: "E-posta" });
  const c = compactCheck(await reconcile({ pack: ws.pack, warehouse: ws.warehouse, check: "ga4_vs_orders" }));
  assert.deepEqual(c.labels.mobile, { en: "Mobile", tr: "Mobil" });
  assert.match(systemPrompt({ pack: ws.pack, range: { from: "2026-07-25", to: "2026-10-22" }, workspace: "W", demo: true, lang: "en" }), /google_ads \(Google Ads \/ Google Ads\)[\s\S]*never by raw ids/);
  const g = q.rows.find((r) => r.key === "google_ads").value;
  const client = twoStep([["q", "run_query", { metric: "orders", group_by: "channel", from: "2026-10-09", to: "2026-10-22" }]], (r) => ({
    sentence: { en: `Google Ads brought ${g.toLocaleString("en-GB")} orders.`, tr: `Google Ads ${g.toLocaleString("de-DE")} sipariş getirdi.` },
    query_id: r.q.query_id,
  }));
  const { turn } = await ask(client, "Orders by channel");
  assert.equal(turn.answers[0].validation.ok, true);
});

test("B10: Google's real error reaches the step, short and without tokens; a deleted quota project gets its own hint; a user sign-in shows its email", async () => {
  const msg = safeGoogleMessage(new Error(`Project example-quota-project has been deleted. Bearer ya29.a0AfH6SMBxxxxxxxxxxxx access_token=abc123 ${"x".repeat(300)}\nstack line`));
  assert.ok(msg.length < 200);
  assert.match(msg, /^Project example-quota-project has been deleted\./);
  assert.doesNotMatch(msg, /ya29|abc123|stack line/);
  assert.equal(quotaProjectProblem("Project example-quota-project has been deleted.", ["ornek-jobs"]), "example-quota-project");
  assert.equal(quotaProjectProblem("Access Denied: User does not have bigquery.jobs.create", ["ornek-jobs"]), null);

  const gdir = path.join(ws.dir, "gcloud");
  mkdirSync(path.join(gdir, "configurations"), { recursive: true });
  writeFileSync(path.join(gdir, "application_default_credentials.json"), JSON.stringify({ type: "authorized_user", client_id: "c", client_secret: "s", refresh_token: "r" }));
  assert.deepEqual(localCredentials({ CLOUDSDK_CONFIG: gdir }), { adc_found: true, identity: null, kind: "authorized_user" });
  writeFileSync(path.join(gdir, "configurations", "config_default"), "[core]\naccount = person@example.com\nproject = p\n");
  assert.equal(localCredentials({ CLOUDSDK_CONFIG: gdir }).identity, "person@example.com");

  const app = await demoWorkspace({ seed: false, env: { CLOUDSDK_CONFIG: gdir } });
  try {
    writeFileSync(path.join(gdir, "configurations", "config_default"), "[core]\nproject = p\n");
    app.bigQueryTester = async () => ({
      identity: async () => null,
      canRunJobs: async () => {
        throw Object.assign(new Error("Project example-quota-project has been deleted."), { code: 403 });
      },
    });
    const values = { data_project: "ornek-data", job_project: "ornek-jobs", dataset: "ai_analyst", location: null, auth: { kind: "adc" }, max_bytes: 1024 ** 3 };
    const t = await callAction("test_bigquery", values, ctxFor(app));
    assert.deepEqual(t.steps[0].detail, { identity: "", method: "adc", identity_kind: "user" }, "no email on this machine: the app says your Google account");
    assert.equal(t.steps[1].error.code, "quota_project");
    assert.deepEqual(t.steps[1].error.params, { q: "example-quota-project", p: "ornek-jobs", google: "Project example-quota-project has been deleted." });
    app.bigQueryTester = async () => ({ identity: async () => null, canRunJobs: async () => { throw new Error("Access Denied: bigquery.jobs.create permission"); } });
    const t2 = await callAction("test_bigquery", values, ctxFor(app));
    assert.equal(t2.steps[1].error.code, "no_jobs");
    assert.equal(t2.steps[1].error.params.google, "Access Denied: bigquery.jobs.create permission");
  } finally {
    app.close();
  }
});

test("N1: a metric question with a check leads with the metric; the check stays on the answer, below", async () => {
  const client = twoStep(
    [["q", "run_query", { metric: "revenue", from: "2026-10-12", to: "2026-10-18", compare: "previous_period" }], ["r", "reconcile", { check: "ga4_rev_vs_revenue", from: "2026-10-12", to: "2026-10-18" }]],
    (r) => ({ sentence: { en: `Revenue was ${r.q.total_formatted}.`, tr: `Gelir ${r.q.total_formatted_tr}.` }, query_id: r.q.query_id, check_id: r.r.check_id }),
  );
  const { turn } = await ask(client, "Revenue last week against the week before");
  const a = turn.answers[0];
  assert.equal(a.kind, "number");
  assert.ok(a.check, "the check is kept for the card");
  assert.deepEqual(a.metrics.map((m) => m.id), ["revenue"]);
  assert.equal(a.title.en, ws.pack.metrics.revenue.label.en);
});

test("prompt caching: the system prompt carries a cache breakpoint, stays byte-identical across rounds, and usage is recorded per turn", async () => {
  const usage = (i) => ({ input_tokens: 100 + i, output_tokens: 20, cache_read_input_tokens: i ? 5000 : 0, cache_creation_input_tokens: i ? 0 : 5000 });
  const client = stubAnthropic([
    () => ({ content: [toolUse("q", "run_query", { metric: "orders" })], stop_reason: "tool_use", usage: usage(0) }),
    (p) => ({ content: [toolUse("pub", "publish_answer", { sentence: { en: `Orders: ${resultOf(p, "q").json.total_formatted}.`, tr: `Siparişler: ${resultOf(p, "q").json.total_formatted_tr}.` }, query_id: resultOf(p, "q").json.query_id })], stop_reason: "tool_use", usage: usage(1) }),
    () => ({ content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", usage: usage(2) }),
  ]);
  const logs = [];
  const info = console.info;
  console.info = (...a) => logs.push(a.join(" "));
  let turn;
  try {
    ({ turn } = await ask(client, "How many orders in the last 28 days?"));
  } finally {
    console.info = info;
  }
  const [r0, r1] = client.requests;
  assert.deepEqual(r0.system.at(-1).cache_control, { type: "ephemeral" });
  assert.equal(JSON.stringify(r0.system), JSON.stringify(r1.system), "the system prefix is byte-stable across rounds");
  assert.equal(JSON.stringify(r0.tools), JSON.stringify(r1.tools), "the tools are byte-stable across rounds");
  assert.doesNotMatch(r0.system[0].text, /\d{2}:\d{2}:\d{2}|turn_|conv_/, "no time of day or ids before the breakpoint");
  assert.deepEqual(turn.usage, { input: 303, output: 60, cache_read: 10000, cache_write: 5000, calls: 3 });
  const conv = await callAction("get_conversation", { conversation_id: turn.conversation_id }, ctxFor(ws));
  assert.deepEqual(conv.turn_list.at(-1).usage, turn.usage);
  assert.ok(logs.some((l) => l.includes(turn.id) && /cache read 10000 · cache write 5000/.test(l)));
});

test("prompt caching: the OpenAI-compatible adapter records usage when the response has it", async () => {
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 1200, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1000 } } }) });
  const a = openAiAdapter({ baseUrl: "http://127.0.0.1:1/v1", key: null, model: "m", fetch });
  const s = a.start({ system: "S", tools: [], history: [], question: "Q" });
  const r = await a.step(s);
  assert.deepEqual(r.usage, { input: 200, output: 30, cache_read: 1000, cache_write: 0 });
  const none = openAiAdapter({ baseUrl: "http://127.0.0.1:1/v1", key: null, model: "m", fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Hi" }, finish_reason: "stop" }] }) }) });
  assert.equal((await none.step(none.start({ system: "S", tools: [], history: [], question: "Q" }))).usage, null);
});
