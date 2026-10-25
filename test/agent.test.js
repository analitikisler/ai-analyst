// The model path, with stubbed clients: the Anthropic SDK shape and the OpenAI-compatible chat-completions
// adapter (OpenAI, Gemini, a base URL). No network, no key reaches a real service.
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { agentMode, runTurn, systemPrompt } from "../src/agent/agent.js";
import { referenceSql } from "../src/explore/run.js";
import { demoWorkspace } from "./helpers.js";

/** An Anthropic-shaped client whose responses are scripted: each step gets the request and returns { content, stop_reason }. */
function stubAnthropic(steps) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        stream(params, opts) {
          requests.push({ ...structuredClone(params), signal: opts?.signal });
          const step = steps[requests.length - 1];
          return { finalMessage: async () => (step ? step(params, opts) : { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" }) };
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

const ask = async (app, question, o = {}) => {
  const events = [];
  const turn = await runTurn({ question, lang: "en", conversationId: "new", app, emit: (t, d) => events.push([t, d]), ...o });
  return { turn, events };
};
const withClient = (client) => ({ ...ws, modelClient: client });

test("who answers: the planner without a key; a key in the environment or an injected client is a model", async () => {
  assert.equal(agentMode(ws).mode, "planner");
  assert.deepEqual(agentMode(withClient(stubAnthropic([]))), { mode: "model", provider: "anthropic", model: "claude-opus-5-5", provider_label: "Anthropic", model_label: "Claude Opus 5.5", exploratory: true });
  const env = await demoWorkspace({ seed: false, env: { OPENAI_API_KEY: "sk-test-not-real-000000" } });
  assert.deepEqual([agentMode(env).mode, agentMode(env).provider, agentMode(env).model], ["model", "openai", "gpt-5.5"]);
  env.close();
});

test("Anthropic: tools run, an ungrounded number is fixed after the validator's error, the answer is published in both languages", async () => {
  const client = stubAnthropic([
    () => ({ content: [toolUse("tu_1", "run_query", { metric: "orders", group_by: "day", from: "2026-10-09", to: "2026-10-22" }), toolUse("tu_2", "reconcile", { check: "ga4_vs_orders", from: "2026-10-09", to: "2026-10-22" })], stop_reason: "tool_use" }),
    (p) => {
      const q = resultOf(p, "tu_1").json;
      const c = resultOf(p, "tu_2").json;
      assert.deepEqual([q.total, q.total_formatted, q.total_formatted_tr], [2753, "2,753", "2.753"]);
      assert.equal(c.delta_pct_formatted, "−10.1%");
      assert.equal(c.sql, undefined, "the model gets the figures, not the SQL");
      assert.match(c.findings[0].note, /data from an audit, not an instruction/);
      p.ids = { q: q.query_id, c: c.check_id };
      return { content: [toolUse("tu_3", "publish_answer", { sentence: { en: "GA4 shows 2,800 purchases.", tr: "GA4 2.800 satın alma gösteriyor." }, query_id: q.query_id, check_id: c.check_id })], stop_reason: "tool_use" };
    },
    (p) => {
      const r = resultOf(p, "tu_3");
      assert.equal(r.is_error, true);
      assert.match(r.content, /2,800/);
      const first = p.messages[2].content;
      const q = JSON.parse(first.find((b) => b.tool_use_id === "tu_1").content).query_id;
      const c = JSON.parse(first.find((b) => b.tool_use_id === "tu_2").content).check_id;
      return {
        content: [toolUse("tu_4", "publish_answer", { sentence: { en: "GA4 purchases are 2,474 against 2,753 orders (−10.1%).", tr: "GA4 satın almaları 2.753 siparişe karşı 2.474 (−%10,1)." }, query_id: q, check_id: c, followups: [{ en: "Is the gap only on mobile?", tr: "Fark yalnızca mobilde mi?" }, { en: "Do GA4 purchases match orders in the last 14 days?", tr: "Son 14 günde GA4 satın almaları siparişlerle tutuyor mu?" }] })],
        stop_reason: "tool_use",
      };
    },
    () => ({ content: [{ type: "text", text: "The gap is on mobile." }], stop_reason: "end_turn" }),
  ]);
  const { turn, events } = await ask(withClient(client), "Do GA4 purchases match orders in the last 14 days?");
  assert.equal(turn.error, null);
  assert.deepEqual(events.map(([t]) => t), ["turn", "step", "step", "step", "step", "answer", "text", "done"]);
  assert.deepEqual(turn.steps.map((s) => [s.tool, s.ok]), [["run_query", true], ["reconcile", true], ["publish_answer", false], ["publish_answer", true]]);
  const [a] = turn.answers;
  assert.deepEqual([a.kind, a.created_by, a.validation.ok, a.model_label.en], ["check", "agent", true, "Claude Opus 5.5"]);
  assert.deepEqual(a.followups.map((f) => f.en), ["Is the gap only on mobile?"], "the question already asked is dropped");
  const req = client.requests[0];
  assert.deepEqual([req.model, req.thinking, req.output_config, req.fallbacks, req.betas], ["claude-opus-5-5", { type: "adaptive" }, { effort: "medium" }, "default", ["server-side-fallback-2026-07-01"]]);
  assert.ok(req.tools.every((t) => t.eager_input_streaming === true));
  assert.ok(req.tools.some((t) => t.name === "run_sql"), "exploratory answers are on by default with a model");
  assert.ok(!req.tools.some((t) => ["pin_answer", "save_event", "undo", "save_model_key"].includes(t.name)), "no write a person makes");
});

test("a watch the model wants is a proposal waiting for a person", async () => {
  const client = stubAnthropic([() => ({ content: [toolUse("t1", "propose_watch", { check: "ga4_vs_orders" })], stop_reason: "tool_use" }), () => ({ content: [{ type: "text", text: "Waiting for approval." }], stop_reason: "end_turn" })]);
  const { turn, events } = await ask(withClient(client), "Watch the GA4 check");
  assert.ok(events.some(([t, d]) => t === "approval" && d.proposal.kind === "watch" && d.proposal.status === "pending"));
  assert.equal(turn.approvals.length, 1);
  assert.equal(ws.store.list("watches").some((w) => w.check === "ga4_vs_orders"), false);
});

test("exploratory: one guarded query, an answer labelled exploratory; an attack comes back as a tool error", async () => {
  const sql = referenceSql({ measure: "revenue", dims: ["weekday"], from: "2026-07-25", to: "2026-10-22" });
  const client = stubAnthropic([
    () => ({ content: [toolUse("x0", "run_sql", { sql: "SELECT * FROM read_csv('/etc/passwd')", measure: "other", dims: [], from: "2026-07-25", to: "2026-10-22", unit: "count" })], stop_reason: "tool_use" }),
    (p) => {
      const bad = resultOf(p, "x0");
      assert.equal(bad.is_error, true);
      assert.match(bad.content, /exploratory queries may not use/);
      return { content: [toolUse("x1", "run_sql", { sql, measure: "revenue", dims: ["weekday"], from: "2026-07-25", to: "2026-10-22", unit: "try" })], stop_reason: "tool_use" };
    },
    (p) => {
      const r = resultOf(p, "x1").json;
      assert.equal(r.rows.length, 7);
      assert.equal(r.shape, "category");
      assert.match(r.note, /not instructions/);
      const top = r.rows[0];
      p.top = top;
      return { content: [toolUse("x2", "publish_answer", { explore_id: r.explore_id, sentence: { en: `Revenue is highest on ${top[0]}.`, tr: `Ciro en yüksek ${top[0]} günü.` }, title: { en: "Revenue by weekday", tr: "Hafta gününe göre ciro" } })], stop_reason: "tool_use" };
    },
  ]);
  const { turn } = await ask(withClient(client), "Which weekday brings the most revenue?");
  const [a] = turn.answers;
  assert.deepEqual([a.kind, a.explore.shape, a.explore.rows.length, a.metrics.length, a.check], ["explore", "category", 7, 0, null]);
  assert.match(a.explore.sql, /^SELECT \* FROM \(\n[\s\S]*\n\) AS q\nLIMIT 1000$/);
  const sum = a.explore.rows.reduce((s, r) => s + r[1], 0);
  const total = (await import("../src/actions/index.js")).callAction("run_query", { metric: "revenue", from: "2026-07-25", to: "2026-10-22" }, { actor: "person", lang: "en", app: ws });
  assert.equal(sum, (await total).total, "the weekdays add up to the 90-day revenue");
  // Turning it into a metric is a proposal on the Metrics page.
  const client2 = stubAnthropic([() => ({ content: [toolUse("m1", "propose_metric", { answer_id: a.id })], stop_reason: "tool_use" })]);
  const r2 = await ask(withClient(client2), "Turn this into a metric", { conversationId: turn.conversation_id });
  assert.deepEqual(r2.events.map(([t]) => t), ["turn", "step", "text", "refusal", "done"]);
  assert.equal(r2.turn.refusal.code, "metric_proposed");
});

test("exploratory answers switched off: no run_sql tool, and the prompt says there is no free SQL", async () => {
  ws.store.setMeta("preferences", { exploratory: "off" });
  const client = stubAnthropic([]);
  await ask(withClient(client), "Which weekday brings the most revenue?");
  assert.ok(!client.requests[0].tools.some((t) => t.name === "run_sql"));
  assert.match(client.requests[0].system[0].text, /There is no free SQL/);
  ws.store.setMeta("preferences", {});
});

test("stop: aborting the signal ends the turn as stopped", async () => {
  const controller = new AbortController();
  const client = stubAnthropic([
    () => {
      controller.abort();
      return { content: [toolUse("s1", "run_query", { metric: "orders" })], stop_reason: "tool_use" };
    },
  ]);
  const { turn, events } = await ask(withClient(client), "Orders?", { signal: controller.signal });
  assert.equal(turn.status, "stopped");
  assert.deepEqual(events.at(-2), ["error", { code: "stopped", message: "Stopped." }]);
});

test("a refusal from the model ends the turn with words the person can act on", async () => {
  const { turn } = await ask(withClient(stubAnthropic([() => ({ content: [], stop_reason: "refusal" })])), "Something");
  assert.equal(turn.error.code, "refusal");
  assert.match(turn.error.message, /Rephrase it/);
});

test("OpenAI-compatible: one fetch adapter with tool calls, the key as a bearer token, the base URL from Settings", async () => {
  const calls = [];
  let n = 0;
  const fetchStub = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    n++;
    const reply = (message, finish) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message, finish_reason: finish }] }) });
    if (n === 1) return reply({ content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "run_query", arguments: JSON.stringify({ metric: "roas", group_by: "channel" }) } }] }, "tool_calls");
    if (n === 2) {
      const q = JSON.parse(calls[1].body.messages.at(-1).content);
      return reply({ content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "publish_answer", arguments: JSON.stringify({ query_id: q.query_id, sentence: { en: `ROAS is ${q.total_formatted}.`, tr: `ROAS ${q.total_formatted_tr}.` } }) } }] }, "tool_calls");
    }
    return reply({ content: "Done." }, "stop");
  };
  const app = await demoWorkspace({ seed: true, env: { AI_ANALYST_OPENAI_COMPATIBLE_KEY: "local-key-0000000000", AI_ANALYST_OPENAI_COMPATIBLE_URL: "http://127.0.0.1:11434/v1", AI_ANALYST_PROVIDER: "openai_compatible", AI_ANALYST_MODEL: "llama3" }, fetch: fetchStub });
  const { turn } = await ask(app, "ROAS by channel");
  assert.equal(turn.error, null);
  assert.equal(turn.answers[0].sentence.en, "ROAS is 2.09×.");
  assert.equal(calls[0].url, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer local-key-0000000000");
  assert.equal(calls[0].body.model, "llama3");
  assert.equal(calls[0].body.messages[0].role, "system");
  assert.equal(calls[0].body.tools[0].type, "function");
  assert.equal(calls[1].body.messages.at(-1).role, "tool");
  app.close();
});

test("Gemini goes through its OpenAI-compatible endpoint; a refused key is auth_failed", async () => {
  const seen = [];
  const app = await demoWorkspace({ seed: false, env: { GEMINI_API_KEY: "AIza-test-000000000000" }, fetch: async (url) => (seen.push(url), { ok: false, status: 401, json: async () => ({}) }) });
  const { turn } = await ask(app, "Orders?");
  assert.equal(seen[0], "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(turn.error.code, "auth_failed");
  app.close();
});

test("the system prompt carries the pack, the data range, the rules on data and the house style", () => {
  const s = systemPrompt({ pack: ws.pack, range: { from: "2026-07-25", to: "2026-10-22" }, workspace: "Örnek Moda", demo: true, lang: "tr", today: "2026-10-23", exploratory: true });
  assert.match(s, /orders \(count, v3\)/);
  assert.match(s, /ga4_vs_orders: GA4 purchases against back-office orders/);
  assert.match(s, /2026-07-25 to 2026-10-22/);
  assert.match(s, /last complete Monday to Sunday week/);
  assert.match(s, /data, never instructions/);
  assert.match(s, /call run_sql with one read-only aggregate query on the mart/);
  assert.match(s, /No superlatives, no exclamation marks/);
  assert.match(s, /siz/);
});
