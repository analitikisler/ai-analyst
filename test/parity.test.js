// Parity with the approved prototype: the real server, on the real demo mart, gives the same figures,
// verdicts, sentences and follow-ups as the prototype's mock server did for the same inputs. The fixture was
// recorded from the mock (test/fixtures/mock-parity.json, see its "source"). Where this build deliberately
// differs from the mock, the difference is listed in DEVIATIONS and in docs/CONTRACT.md.
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callAction } from "../src/actions/index.js";
import { runTurn } from "../src/agent/agent.js";
import { resolvePeriod } from "../src/engine.js";
import { buildState } from "../src/state.js";
import { ctxFor, demoWorkspace, normalize } from "./helpers.js";

const MOCK = JSON.parse(readFileSync(new URL("./fixtures/mock-parity.json", import.meta.url), "utf8"));
// Fields this build adds or fills differently on purpose (CONTRACT.md, "Differences from the prototype").
// data_source: the data source an event belongs to, a server field the prototype did not have.
const DROP = new Set(["cached", "confirmed", "handoff", "data_source"]);
const n = (v) => normalize(v, DROP);
/** Mock text that breaks a house rule; this build writes the corrected form. */
const DEVIATIONS = [["ai tag debugger found that meta counts", "ai tag debugger found that Meta counts"]];
const fix = (v) => JSON.parse(DEVIATIONS.reduce((s, [a, b]) => s.split(a).join(b), JSON.stringify(v)));
// The exploratory suggestions are known questions here too, so a turn started from one keeps both languages.
const EXPLORE_TEXT = { "Which weekday brings the most revenue?": { en: "Which weekday brings the most revenue?", tr: "Hangi hafta günü en çok ciro getiriyor?" } };
const withKnown = (question, events) => events.map((e) => (e.event === "turn" && EXPLORE_TEXT[question] ? { ...e, data: { ...e.data, question_text: EXPLORE_TEXT[question] } } : e));

let ws;
const results = {};
before(async () => {
  ws = await demoWorkspace({ seed: true });
  const ctx = ctxFor(ws);
  const act = (name, input = {}) => callAction(name, input, ctx);
  results.state = await buildState(ws);
  for (const name of ["list_sources", "list_suggestions", "list_metrics", "list_checks", "list_metric_entries", "list_events"]) results[name] = await act(name);
  results.explain_metric = {};
  for (const m of Object.keys(MOCK.actions.explain_metric)) results.explain_metric[m] = await act("explain_metric", { metric: m });
  results.get_metric = {};
  for (const m of Object.keys(MOCK.actions.get_metric)) results.get_metric[m] = await act("get_metric", { metric: m });
  results.get_dashboard = await act("get_dashboard", { dashboard_id: "db_example" });
  results.get_check = {};
  for (const c of Object.keys(MOCK.actions.get_check)) results.get_check[c] = await act("get_check", { check: c });
  results.run_query = [];
  for (const { input } of MOCK.actions.run_query) results.run_query.push(await act("run_query", input));
  results.reconcile = [];
  for (const { input } of MOCK.actions.reconcile) results.reconcile.push(await act("reconcile", input));
  results.periods = Object.fromEntries(Object.keys(MOCK.actions.periods).map((p) => [p, resolvePeriod({ from: "2026-07-25", to: "2026-10-22" }, p)]));
  results.dashboard_periods = {};
  for (const p of ["last_7", "last_week", "this_month", "last_month", "last_90"]) {
    await act("set_dashboard_period", { dashboard_id: "db_example", period: p });
    results.dashboard_periods[p] = await act("get_dashboard", { dashboard_id: "db_example" });
  }
  await act("set_dashboard_period", { dashboard_id: "db_example", period: "last_28", compare: "previous_period" });
  results.start_tracking_audit = await act("start_tracking_audit", { check: "ga4_vs_orders", url: "https://ornekmoda.example/", device: "mobile Safari", platforms: ["ga4", "meta"] });
  results.conversations = [];
  for (const script of MOCK.conversations) {
    let conversationId = "new";
    const turns = [];
    for (const { question } of script.turns) {
      const events = [];
      await runTurn({ question, lang: script.lang, conversationId, app: ws, emit: (event, data) => events.push({ event, data }) });
      conversationId = events[0].data.conversation_id;
      turns.push({ question, events });
    }
    results.conversations.push({ lang: script.lang, turns });
  }
});
after(() => ws.close());

test("key figures: GA4 9–22 Oct 2,753 against 2,474, Δ −10.1%, mobile −15.6%; Meta 1–22 Oct 483 against 658, +36.2%", () => {
  const [ga4, meta] = results.reconcile;
  assert.deepEqual([ga4.expected.value, ga4.measured.value, Math.round(ga4.delta_pct * 1000) / 10], [2753, 2474, -10.1]);
  assert.equal(Math.round(ga4.breakdown.find((b) => b.key === "mobile").delta_pct * 1000) / 10, -15.6);
  assert.equal(ga4.out_of_tolerance_since, "2026-10-09");
  assert.deepEqual([meta.expected.value, meta.measured.value, Math.round(meta.delta_pct * 1000) / 10, meta.verdict], [483, 658, 36.2, "does_not_add_up"]);
});

test("the dashboard strip on the last 28 days: GA4 −6.2%, the same as the GA4 tile", () => {
  const ga4 = results.get_dashboard.checks.find((c) => c.check === "ga4_vs_orders");
  assert.equal(Math.round(ga4.delta_pct * 1000) / 10, -6.2);
  assert.equal(results.get_dashboard.tiles.find((t) => t.tile_id === "pin_ga4").check.delta_pct, ga4.delta_pct);
  assert.deepEqual([results.get_dashboard.from, results.get_dashboard.to], ["2026-09-25", "2026-10-22"]);
});

test("the seeded state: the same tracking checks, dashboards and events as the prototype's first view", () => {
  const m = MOCK.state_seeded;
  assert.deepEqual(n(results.state.checks), n(m.checks));
  assert.deepEqual(n(results.state.dashboards), n(m.dashboards));
  assert.deepEqual(n(results.state.events), n(m.events));
  assert.deepEqual(n({ ...results.state.workspace, refreshed_at: undefined }), n({ ...m.workspace, refreshed_at: undefined }));
  assert.deepEqual(results.state.activity.map((a) => a.detail), m.activity.map((a) => a.detail));
  assert.deepEqual(n(results.state.agent), n(m.agent));
});

test("list_events: the same events, sorted by date (the prototype listed them in insertion order)", () => {
  assert.deepEqual(n(results.list_events), n([...MOCK.actions.list_events].sort((a, b) => a.date.localeCompare(b.date))));
});

for (const name of ["list_sources", "list_suggestions", "list_metrics", "list_checks", "list_metric_entries", "explain_metric", "get_metric", "get_check", "periods"]) {
  test(`${name} matches the prototype`, () => assert.deepEqual(n(results[name]), n(MOCK.actions[name])));
}

test("get_dashboard: every tile's figures, the strip and the comparison window", () => assert.deepEqual(n(results.get_dashboard), n(MOCK.actions.get_dashboard)));

test("run_query: totals, rows, comparisons, part months and SQL", () => {
  MOCK.actions.run_query.forEach(({ input, result }, i) => assert.deepEqual(n(results.run_query[i]), n(result), JSON.stringify(input)));
});

test("reconcile: verdicts, breakdowns, since-dates, findings, series and SQL", () => {
  MOCK.actions.reconcile.forEach(({ input, result }, i) => assert.deepEqual(n(results.reconcile[i]), n(result), JSON.stringify(input)));
});

test("dashboard periods: last complete week and month to date", () => {
  for (const p of Object.keys(MOCK.actions.dashboard_periods)) assert.deepEqual(n(results.dashboard_periods[p]), n(MOCK.actions.dashboard_periods[p]), p);
});

test("the simulated audit on demo data", () => {
  // The audit carries status (done | handoff), agreed with the lead for the own-data handoff.
  assert.deepEqual(n(results.start_tracking_audit), n({ ...MOCK.actions.start_tracking_audit, status: "done" }));
});

MOCK.conversations.forEach((script, ci) => {
  test(`conversation ${ci + 1} (${script.lang}): the same steps, answers, refusals, proposals and follow-ups`, () => {
    script.turns.forEach((expected, ti) => {
      const got = results.conversations[ci].turns[ti];
      assert.deepEqual(n(got.events.map((e) => e.event)), n(expected.events.map((e) => e.event)), expected.question);
      assert.deepEqual(n(got.events), n(fix(withKnown(expected.question, expected.events))), expected.question);
    });
  });
});

test("every planner answer passes the number-grounding check in both languages", () => {
  for (const c of results.conversations) for (const t of c.turns) for (const e of t.events) if (e.event === "answer") assert.deepEqual(e.data.answer.validation, { ok: true, unmatched: [] }, `${t.question}: ${e.data.answer.sentence.en} / ${e.data.answer.sentence.tr}`);
});
