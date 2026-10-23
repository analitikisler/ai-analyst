// The action registry: shapes, storage, and who may do what.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { actionsFor, callAction, inputJsonSchema, registry, toolDefinitions } from "../src/actions/index.js";
import { ctxFor, demoWorkspace } from "./helpers.js";

let ws;
before(async () => (ws = await demoWorkspace({ seed: false })));
after(() => ws.close());

const person = () => ctxFor(ws, "person");
const agent = (turn = { id: "turn_test", question: "q", answers: [], approvals: [] }) => ctxFor(ws, "agent", { turn, mode: "model" });

test("every action in the CONTRACT table is registered with its kind and actors", () => {
  const table = {
    list_metrics: ["read", true, true], explain_metric: ["read", true, true], list_checks: ["read", true, true], run_query: ["read", true, true],
    reconcile: ["read", true, true], run_all_checks: ["write", true, true], list_sources: ["read", true, true], get_workspace: ["read", true, true],
    publish_answer: ["write", true, false], pin_answer: ["write", true, true], unpin: ["write", false, true], create_alert: ["write", true, true],
    decide_alert: ["write", false, true], remove_alert: ["write", false, true], undo: ["write", false, true],
  };
  assert.deepEqual([...registry.keys()].sort(), Object.keys(table).sort());
  for (const [name, [kind, agentOk, personOk]] of Object.entries(table)) {
    const a = registry.get(name);
    assert.deepEqual([a.kind, a.agent, a.person], [kind, agentOk, personOk], name);
  }
});

test("the agent's tools are the agent actions, with JSON Schema inputs from zod", () => {
  const tools = toolDefinitions(ws.pack, { eager: true });
  assert.deepEqual(tools.map((t) => t.name).sort(), actionsFor("agent").map((a) => a.name).sort());
  assert.ok(!tools.some((t) => ["unpin", "decide_alert", "remove_alert", "undo"].includes(t.name)));
  const rq = tools.find((t) => t.name === "run_query");
  assert.equal(rq.input_schema.type, "object");
  assert.equal(rq.input_schema.$schema, undefined);
  assert.ok(rq.input_schema.properties.metric.enum.includes("orders"));
  assert.deepEqual(rq.input_schema.required, ["metric"]);
  assert.equal(rq.eager_input_streaming, true);
  assert.equal(inputJsonSchema(registry.get("run_all_checks"), ws.pack).properties.days.default, 14);
});

test("run_query returns a stored QueryResult; ratios come from sums; channels sorted by value", async () => {
  const q = await callAction("run_query", { metric: "roas", group_by: "channel", from: "2026-09-25", to: "2026-10-22" }, person());
  for (const k of ["id", "metric", "metric_version", "group_by", "from", "to", "filters", "unit", "rows", "total", "sql", "dialect", "ran_at"]) assert.ok(k in q, k);
  assert.deepEqual(q.rows.map((r) => r.key), ["google_ads", "meta_ads", "tiktok_ads"]);
  assert.ok(q.rows[0].value >= q.rows[1].value && q.rows[1].value >= q.rows[2].value);
  const rev = await callAction("run_query", { metric: "revenue", from: "2026-09-25", to: "2026-10-22", filters: { channel: ["google_ads", "meta_ads", "tiktok_ads"] } }, person());
  const spend = await callAction("run_query", { metric: "ad_spend", from: "2026-09-25", to: "2026-10-22" }, person());
  assert.ok(Math.abs(q.total - rev.total / spend.total) < 1e-9, "ROAS total is total revenue over total spend, not an average of channel ROAS");
  assert.deepEqual(ws.store.getQuery(q.id), q);
});

test("run_query by day is in date order and sums to the total", async () => {
  const q = await callAction("run_query", { metric: "orders", group_by: "day", from: "2026-10-09", to: "2026-10-22" }, person());
  assert.equal(q.rows.length, 14);
  assert.deepEqual(q.rows.map((r) => r.key), [...q.rows.map((r) => r.key)].sort());
  assert.equal(q.rows.reduce((a, r) => a + r.value, 0), q.total);
  assert.equal(q.total, 2753);
});

test("bad input comes back as invalid_input with what to fix", async () => {
  await assert.rejects(callAction("run_query", { metric: "profit" }, person()), (e) => e.code === "invalid_input" && /metric/.test(e.message));
  await assert.rejects(callAction("run_query", { metric: "orders", channel: "meta_ads" }, person()), (e) => e.code === "invalid_input");
  await assert.rejects(callAction("nope", {}, person()), (e) => e.code === "unknown_action");
});

test("person-only and agent-only actions refuse the other actor", async () => {
  await assert.rejects(callAction("publish_answer", { sentence: "x", query_id: "q" }, person()), (e) => e.code === "forbidden");
  for (const name of ["unpin", "decide_alert", "remove_alert", "undo"]) {
    await assert.rejects(callAction(name, {}, agent()), (e) => e.code === "forbidden", name);
  }
});

test("publish_answer refuses ungrounded numbers twice, then publishes flagged", async () => {
  const q = await callAction("run_query", { metric: "orders", from: "2026-10-09", to: "2026-10-22" }, agent());
  const turn = { id: "turn_pub", question: "How many orders?", answers: [], approvals: [] };
  const ctx = agent(turn);
  const input = { sentence: "Orders for 9–22 Oct 2026: 2,900.", query_id: q.id };
  await assert.rejects(callAction("publish_answer", input, ctx), (e) => e.code === "ungrounded_numbers" && e.unmatched[0] === "2,900");
  await assert.rejects(callAction("publish_answer", input, ctx), (e) => e.code === "ungrounded_numbers");
  const flagged = await callAction("publish_answer", input, ctx);
  assert.deepEqual(flagged.validation, { ok: false, unmatched: ["2,900"] });
  assert.deepEqual(turn.answers, [flagged.id]);

  const good = await callAction("publish_answer", { sentence: "Orders for 9–22 Oct 2026: 2,753.", query_id: q.id, followups: ["Is the gap only on mobile?"] }, agent());
  assert.deepEqual(good.validation, { ok: true, unmatched: [] });
  assert.equal(good.created_by, "agent");
  assert.equal(good.title, "Orders · 9–22 Oct 2026");
  assert.deepEqual(good.metric, { id: "orders", label: { en: "Orders", tr: "Sipariş" }, version: 3, description: ws.pack.metrics.orders.description, source: "backoffice" });
  for (const k of ["id", "turn_id", "question", "sentence", "title", "followups", "query", "check", "metric", "validation", "created_by", "created_at"]) assert.ok(k in good, k);
  await assert.rejects(callAction("publish_answer", { sentence: "x", query_id: "q_missing" }, agent()), (e) => e.code === "not_found");
});

test("pins: pin, pin again is a no-op, undo removes it, unpin logs", async () => {
  const q = await callAction("run_query", { metric: "sessions" }, person());
  const a = await callAction("publish_answer", { sentence: "Sessions.", query_id: q.id }, agent());
  const pin = await callAction("pin_answer", { answer_id: a.id }, agent());
  assert.equal(pin.created_by, "agent");
  assert.equal(pin.answer.id, a.id);
  assert.equal((await callAction("pin_answer", { answer_id: a.id }, person())).already, true);
  const entry = ws.store.listActivity().find((e) => e.action === "pin_answer" && e.undo?.id === pin.id);
  assert.equal(entry.actor, "agent");
  await callAction("undo", { activity_id: entry.id }, person());
  assert.equal(ws.store.getPin(pin.id), null);
  assert.equal(ws.store.getActivity(entry.id).undone, true);
  await assert.rejects(callAction("undo", { activity_id: entry.id }, person()), (e) => e.code === "already_undone");

  const again = await callAction("pin_answer", { answer_id: a.id, title: "Sessions" }, person());
  assert.deepEqual(await callAction("unpin", { pin_id: again.id }, person()), { removed: true, pin_id: again.id });
  assert.equal(ws.store.listActivity()[0].action, "unpin");
});

test("alerts: the agent's wait for approval, a person's are active", async () => {
  const turn = { id: "turn_al", question: "Tell me when GA4 breaks", answers: [], approvals: [] };
  const proposed = await callAction("create_alert", { check: "ga4_vs_orders", title: "GA4 check" }, agent(turn));
  assert.equal(proposed.status, "pending");
  assert.equal(proposed.rule, "when the check does not add up");
  assert.equal(proposed.schedule, "every morning at 08:00");
  assert.deepEqual(turn.approvals, [proposed.id]);
  const mine = await callAction("create_alert", { metric: "revenue", title: "Revenue" }, person());
  assert.equal(mine.status, "active");
  await assert.rejects(callAction("create_alert", { title: "Nothing" }, person()), (e) => e.code === "invalid_input");

  const decided = await callAction("decide_alert", { alert_id: proposed.id, approve: true }, person());
  assert.equal(decided.alert.status, "active");
  await assert.rejects(callAction("decide_alert", { alert_id: proposed.id, approve: true }, person()), (e) => e.code === "not_pending");

  const declined = await callAction("create_alert", { check: "meta_vs_orders", title: "Meta" }, agent());
  await callAction("decide_alert", { alert_id: declined.id, approve: false }, person());
  assert.equal(ws.store.getAlert(declined.id), null);

  await callAction("remove_alert", { alert_id: mine.id }, person());
  assert.equal(ws.store.getAlert(mine.id), null);
});

test("run_all_checks stores a run and logs it", async () => {
  const run = await callAction("run_all_checks", {}, person());
  assert.equal(run.days, 14);
  assert.equal(run.results.length, 4);
  assert.deepEqual(ws.store.latestCheckRun().id, run.id);
  assert.match(ws.store.listActivity()[0].detail, /^4 checks · 3 do not add up$/);
});

test("catalogue actions describe the pack, the sources and the workspace", async () => {
  const metrics = await callAction("list_metrics", {}, person());
  assert.equal(metrics.length, 11);
  const explained = await callAction("explain_metric", { metric: "aov" }, person());
  assert.match(explained.sql_example, /SUM\(revenue\) \/ NULLIF\(SUM\(orders\), 0\) AS value/);
  const checks = await callAction("list_checks", {}, person());
  assert.equal(checks.find((c) => c.id === "meta_vs_orders").tolerance, 0.2);
  const sources = await callAction("list_sources", {}, person());
  assert.equal(sources.warehouse.rows, 1080);
  const info = await callAction("get_workspace", {}, person());
  assert.equal(info.name, "Örnek Moda");
  assert.equal(info.demo, true);
  assert.equal(info.data_to, "2026-10-22");
});
