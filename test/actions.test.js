// The action registry: every action of the contract, who may call it, and what each one does, with Activity
// and Undo for every write.
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { actionsFor, callAction, inputJsonSchema, registry, toolDefinitions } from "../src/actions/index.js";
import { ctxFor, demoWorkspace } from "./helpers.js";

let ws;
before(async () => (ws = await demoWorkspace({ seed: true })));
after(() => ws.close());

const person = (extra) => ctxFor(ws, "person", extra);
const agent = (turn = { id: "turn_test", conversation_id: "conv_test", question: "q", answers: [], approvals: [] }) => ctxFor(ws, "agent", { turn, mode: { model_label: "Claude Opus 5.5" } });
const act = (name, input = {}, ctx = person()) => callAction(name, input, ctx);
const lastActivity = () => ws.store.listActivity(1)[0];

// Every entry of Actions in web/src/api/types.ts, the web app's API.
const WEB_ACTIONS = [
  "list_sources", "list_suggestions", "list_metrics", "list_metric_entries", "get_metric", "decide_metric", "list_events", "save_event", "delete_event", "import_gtm_events",
  "start_tracking_audit", "get_audit", "explain_metric", "list_checks", "run_query", "reconcile", "run_all_checks", "get_check", "watch_check", "unwatch_check", "mark_checks_seen",
  "list_conversations", "get_conversation", "decide_proposal", "undo", "list_dashboards", "get_dashboard", "create_dashboard", "rename_dashboard", "delete_dashboard",
  "set_dashboard_period", "pin_answer", "update_tile", "move_tile", "duplicate_tile", "remove_tile", "get_settings", "test_bigquery", "save_data_source", "set_bytes_cap",
  "rebuild_demo", "test_model_key", "save_model_key", "remove_model_key", "set_model_provider", "get_chat_app_setup", "list_chat_app_calls", "set_preference",
];

test("every action of the web contract is registered and a person may call it", () => {
  for (const name of WEB_ACTIONS) {
    assert.ok(registry.has(name), name);
    assert.equal(registry.get(name).person, true, name);
  }
  // Beyond the web contract: the agent's own tools, the workspace header, and the audit callback for chat apps.
  const extra = [...registry.keys()].filter((k) => !WEB_ACTIONS.includes(k)).sort();
  assert.deepEqual(extra, ["attach_audit_finding", "get_workspace", "propose_event", "propose_metric", "propose_pin", "propose_watch", "publish_answer", "run_sql"]);
});

test("the agent's tools: reads, the check run, publishing, proposals and SQL; never a person's write", () => {
  const tools = actionsFor("agent").map((a) => a.name).sort();
  assert.deepEqual(tools, ["explain_metric", "get_workspace", "list_checks", "list_events", "list_metrics", "list_sources", "propose_event", "propose_metric", "propose_pin", "propose_watch", "publish_answer", "reconcile", "run_all_checks", "run_query", "run_sql"]);
  const defs = toolDefinitions(ws.pack, { eager: true });
  const rq = defs.find((t) => t.name === "run_query");
  assert.equal(rq.input_schema.type, "object");
  assert.equal(rq.input_schema.$schema, undefined);
  assert.ok(rq.input_schema.properties.metric.enum.includes("orders"));
  assert.equal(rq.eager_input_streaming, true);
  assert.equal(inputJsonSchema(registry.get("run_all_checks"), ws.pack).properties.days.default, 14);
});

test("who may call what is enforced once, in the registry", async () => {
  await assert.rejects(act("pin_answer", { answer_id: "x" }, agent()), (e) => e.code === "forbidden");
  await assert.rejects(act("publish_answer", { sentence: { en: "x", tr: "x" }, query_id: "q" }), (e) => e.code === "forbidden");
  await assert.rejects(act("save_event", { event: { date: "2026-10-01", title: { en: "a", tr: "a" }, type: "other" } }, ctxFor(ws, "chat_app")), (e) => e.code === "forbidden");
  await assert.rejects(act("set_model_provider", { provider: "planner" }, person({ loopback: false })), (e) => e.code === "loopback_only");
  await assert.rejects(act("run_query", { metric: "nope" }), (e) => e.code === "invalid_input");
  await assert.rejects(act("no_such_action"), (e) => e.code === "unknown_action");
});

test("catalogue: sources, suggestions, metrics, checks, the workspace", async () => {
  assert.equal((await act("list_sources")).length, 6);
  assert.deepEqual((await act("list_suggestions")).map((s) => s.tag), ["check", "check", "by_channel", "comparison"]);
  const metrics = await act("list_metrics");
  assert.equal(metrics.length, 11);
  assert.deepEqual(metrics.find((m) => m.id === "roas").definition, { ratio: { numerator: "revenue", denominator: "ad_spend" } });
  const ex = await act("explain_metric", { metric: "orders" });
  assert.match(ex.sql_example, /SUM\(orders\) AS value/);
  assert.equal(ex.check.tolerance, 0.05);
  const checks = await act("list_checks");
  assert.deepEqual(checks.find((c) => c.id === "ga4_vs_orders").findings.map((f) => f.id), ["f_ga4_mobile_safari"]);
  assert.deepEqual(await act("get_workspace"), { name: "Örnek Moda", demo: true, data_from: "2026-07-25", data_to: "2026-10-22", refreshed_at: (await act("get_workspace")).refreshed_at, rows: 1080 });
});

test("run_query compares with the previous period and marks a part month", async () => {
  const q = await act("run_query", { metric: "revenue", group_by: "month", from: "2026-08-01", to: "2026-10-22" });
  assert.deepEqual(q.partial, { key: "2026-10-01", days: 22, of: 31 });
  assert.equal(q.provisional_from, "2026-10-20");
  const c = await act("run_query", { metric: "revenue", compare: "previous_period" });
  assert.deepEqual([c.comparison.kind, c.comparison.from, c.comparison.to, c.comparison.shift_days], ["previous_period", "2026-08-28", "2026-09-24", 28]);
  assert.equal(c.comparison.delta, c.total - c.comparison.total);
  const y = await act("run_query", { metric: "orders", compare: "previous_year" });
  assert.deepEqual([y.comparison, y.comparison_note], [null, "no_data"]);
});

test("run_all_checks stores a run, logs it, and flags a watched check whose verdict changed", async () => {
  const { watch } = await act("watch_check", { check: "gads_vs_orders" });
  ws.store.put("watches", { ...watch, last_verdict: "does_not_add_up" });
  const run = await act("run_all_checks", { days: 14 });
  assert.equal(run.results.length, 4);
  assert.equal(ws.store.latestCheckRun().id, run.id);
  assert.deepEqual(lastActivity().detail, { en: "Ran 4 tracking checks · 3 do not add up", tr: "4 ölçüm kontrolü çalıştırıldı · 3 tanesi tutmuyor" });
  assert.equal(ws.store.get("watches", watch.id).changed, true);
  const detail = await act("get_check", { check: "gads_vs_orders" });
  assert.equal(detail.watch.changed, false, "opening the check clears the flag");
  assert.equal(detail.weeks.length, 7);
  assert.equal(detail.runs[0].id, run.id);
  await act("unwatch_check", { check: "gads_vs_orders" });
  assert.deepEqual((await act("mark_checks_seen")), { ok: true });
});

test("watch and unwatch log activity, and undo reverses each", async () => {
  const w = await act("watch_check", { check: "meta_vs_orders" });
  assert.equal((await act("watch_check", { check: "meta_vs_orders" })).activity_id, null, "watching twice is a no-op");
  await act("undo", { activity_id: w.activity_id });
  assert.equal(ws.store.list("watches").some((x) => x.check === "meta_vs_orders"), false);
  await assert.rejects(act("undo", { activity_id: w.activity_id }), (e) => e.code === "already_undone");
  await act("watch_check", { check: "meta_vs_orders" });
  const u = await act("unwatch_check", { check: "meta_vs_orders" });
  await act("undo", { activity_id: u.activity_id });
  assert.equal(ws.store.list("watches").some((x) => x.check === "meta_vs_orders"), true);
  await act("unwatch_check", { check: "meta_vs_orders" });
});

async function publishedAnswer() {
  const q = await act("run_query", { metric: "orders", from: "2026-10-09", to: "2026-10-22" }, agent());
  return act("publish_answer", { sentence: { en: "Orders for 9–22 Oct 2026: 2,753.", tr: "9–22 Eki 2026 döneminde sipariş: 2.753." }, query_id: q.id, title: { en: "Orders", tr: "Sipariş" } }, agent());
}

test("publish_answer checks numbers in both languages: refused twice, then published flagged", async () => {
  const q = await act("run_query", { metric: "orders", from: "2026-10-09", to: "2026-10-22" }, agent());
  const turn = { id: "turn_g", conversation_id: "c", question: "q", answers: [], approvals: [] };
  const bad = { sentence: { en: "Orders: 2,753.", tr: "Sipariş: 2.800." }, query_id: q.id };
  await assert.rejects(act("publish_answer", bad, agent(turn)), (e) => e.code === "ungrounded_numbers" && e.unmatched.includes("2.800"));
  await assert.rejects(act("publish_answer", bad, agent(turn)), (e) => e.code === "ungrounded_numbers");
  const a = await act("publish_answer", bad, agent(turn));
  assert.deepEqual(a.validation, { ok: false, unmatched: ["2.800"] });
  const good = await publishedAnswer();
  assert.deepEqual([good.kind, good.validation.ok, good.created_by, good.model_label.en], ["number", true, "agent", "Claude Opus 5.5"]);
  assert.deepEqual(good.metrics.map((m) => m.id), ["orders"]);
});

test("dashboards: create, rename, period, pin, update, move, duplicate, remove, delete, each with undo", async () => {
  const d = await act("create_dashboard", { name: "Team" });
  assert.deepEqual([d.name, d.tiles.length, d.example], [{ en: "Team", tr: "Team" }, 0, false]);
  const r = await act("rename_dashboard", { dashboard_id: d.id, name: "Growth" });
  const p = await act("set_dashboard_period", { dashboard_id: d.id, period: "last_week", compare: "off" });
  assert.deepEqual([p.dashboard.period, p.dashboard.compare], ["last_week", "off"]);
  const a = await publishedAnswer();
  const pin = await act("pin_answer", { answer_id: a.id, dashboard_id: d.id });
  assert.deepEqual([pin.tile.chart, pin.tile.size], ["number", { w: 3, h: 1 }]);
  assert.equal((await act("pin_answer", { answer_id: a.id, dashboard_id: d.id })).tile.id, pin.tile.id, "pinning twice returns the tile");
  await assert.rejects(act("update_tile", { tile_id: pin.tile.id, chart: "tally" }), (e) => e.code === "invalid_chart");
  const up = await act("update_tile", { tile_id: pin.tile.id, chart: "line" });
  assert.equal(up.tile.size.w, 4, "a line needs 4 columns");
  await assert.rejects(act("update_tile", { tile_id: pin.tile.id, size: { w: 3, h: 1 } }), (e) => e.code === "invalid_size");
  const dup = await act("duplicate_tile", { tile_id: pin.tile.id });
  const mv = await act("move_tile", { tile_id: dup.tile.id, to_index: 0 });
  assert.equal(mv.dashboard.tiles[0].id, dup.tile.id);
  await act("undo", { activity_id: mv.activity_id });
  const res = await act("get_dashboard", { dashboard_id: d.id });
  assert.deepEqual(res.tiles.map((t) => t.tile_id), [pin.tile.id, dup.tile.id]);
  assert.deepEqual([res.from, res.to], ["2026-10-12", "2026-10-18"]);
  const week = await act("run_query", { metric: "orders", from: "2026-10-12", to: "2026-10-18" });
  assert.equal(res.tiles[0].query.total, week.total, "the tile follows the dashboard period");
  const rm = await act("remove_tile", { tile_id: dup.tile.id });
  await act("undo", { activity_id: rm.activity_id });
  assert.equal((await act("get_dashboard", { dashboard_id: d.id })).tiles.length, 2);
  await act("undo", { activity_id: up.activity_id });
  assert.equal(ws.store.get("dashboards", d.id).tiles[0].chart, "number");
  await act("undo", { activity_id: p.activity_id });
  assert.equal(ws.store.get("dashboards", d.id).period, "last_28");
  await act("undo", { activity_id: r.activity_id });
  assert.equal(ws.store.get("dashboards", d.id).name.en, "Team");
  const del = await act("delete_dashboard", { dashboard_id: d.id });
  assert.equal(del.next, "db_example");
  const delAct = lastActivity();
  await act("undo", { activity_id: delAct.id });
  assert.ok(ws.store.get("dashboards", d.id));
  // Undoing the pin after the dashboard is gone says so.
  await act("delete_dashboard", { dashboard_id: d.id });
  await assert.rejects(act("undo", { activity_id: pin.activity_id }), (e) => e.code === "undo_gone");
  assert.equal(ws.store.getActivity(pin.activity_id).undo_gone, true);
  await assert.rejects(act("delete_dashboard", { dashboard_id: "db_example" }), (e) => e.code === "only_one");
  assert.deepEqual((await act("list_dashboards")).map((x) => x.id), ["db_example"]);
});

test("proposals: the agent proposes a watch, a pin and an event; a person approves or declines", async () => {
  const turn = { id: "turn_p", conversation_id: "conv_p", question: "q", answers: [], approvals: [] };
  const w = await act("propose_watch", { check: "ga4_rev_vs_revenue" }, agent(turn));
  assert.equal(w.status, "pending");
  assert.deepEqual(turn.approvals, [w.id]);
  assert.equal(ws.store.list("watches").some((x) => x.check === "ga4_rev_vs_revenue"), false, "nothing changes before approval");
  await act("decide_proposal", { proposal_id: w.id, approve: true, where: "ask" });
  assert.equal(ws.store.list("watches").some((x) => x.check === "ga4_rev_vs_revenue"), true);
  await assert.rejects(act("decide_proposal", { proposal_id: w.id, approve: true, where: "ask" }), (e) => e.code === "not_pending");
  const a = await publishedAnswer();
  const p = await act("propose_pin", { answer_id: a.id }, agent(turn));
  assert.deepEqual(p.title, { en: "Pin this answer to Shop overview", tr: "Bu cevap Mağaza özeti dashboard’una eklensin" });
  const decided = await act("decide_proposal", { proposal_id: p.id, approve: false, where: "activity" });
  assert.deepEqual([decided.status, decided.decided_in], ["declined", "activity"]);
  const e = await act("propose_event", { date: "2026-10-15", title: { en: "Price test", tr: "Fiyat testi" }, type: "price_change" }, agent(turn));
  await act("decide_proposal", { proposal_id: e.id, approve: true, where: "ask" });
  const ev = (await act("list_events")).find((x) => x.title.en === "Price test");
  assert.equal(ev.source, "agent");
});

test("events: add, edit, delete, each undone; GTM import simulated on demo data, unavailable on own data", async () => {
  const added = await act("save_event", { event: { date: "2026-10-05", title: { en: "Newsletter", tr: "Bülten" }, type: "campaign", note: null } });
  const edited = await act("save_event", { event: { id: added.event.id, date: "2026-10-06", title: { en: "Newsletter", tr: "Bülten" }, type: "campaign" } });
  assert.equal(edited.event.date, "2026-10-06");
  await act("undo", { activity_id: edited.activity_id });
  assert.equal(ws.store.get("events", added.event.id).date, "2026-10-05");
  const del = await act("delete_event", { id: added.event.id });
  await act("undo", { activity_id: del.activity_id });
  assert.ok(ws.store.get("events", added.event.id));
  await act("undo", { activity_id: added.activity_id });
  assert.equal(ws.store.get("events", added.event.id), null);
  const imp = await act("import_gtm_events");
  assert.equal(imp.added, 2, "version 58 is already there");
  await act("undo", { activity_id: imp.activity_id });
  assert.equal(ws.store.get("events", "ev_gtm56"), null);
  const own = { ...ws, warehouse: { ...ws.warehouse, demo: false } };
  await assert.rejects(callAction("import_gtm_events", {}, ctxFor(own)), (e) => e.code === "unavailable" && /Google Tag Manager API/.test(e.message));
});

test("tracking audit: simulated on demo data; on own data a handoff with the MCP steps, then a finding attached back", async () => {
  const demo = await act("start_tracking_audit", { check: "ga4_vs_orders", url: "ornekmoda.example", device: "mobile Safari", platforms: ["ga4"] });
  assert.deepEqual([demo.status, demo.result.ok, demo.steps.length, demo.handoff], ["done", false, 5, null]);
  assert.deepEqual(await act("get_audit", { id: demo.id }), demo);
  const own = { ...ws, warehouse: { ...ws.warehouse, demo: false } };
  const h = await callAction("start_tracking_audit", { check: "ga4_vs_orders", url: "https://shop.example", device: "mobile Safari", platforms: ["ga4", "meta"] }, ctxFor(own));
  assert.equal(h.status, "handoff");
  assert.equal(h.result, null);
  assert.equal(h.handoff.deep_link, null);
  assert.deepEqual(h.handoff.mcp_steps.map((s) => s.split(" ").slice(0, 2).join(" ")), ["ai-tag-debugger start_audit", "ai-tag-debugger browser_action,", "ai-tag-debugger finish_audit", "ai-analyst attach_audit_finding"]);
  assert.match(h.handoff.mcp_steps[0], /"journey":"purchase".*"providers":\["ga4","meta"\].*"device":"mobile Safari"/);
  await assert.rejects(act("attach_audit_finding", { audit_id: h.id, ok: false, title: "x" }), (e) => e.code === "forbidden", "a person does not attach; the chat app does");
  const done = await callAction("attach_audit_finding", { audit_id: h.id, ok: false, title: "purchase missing on mobile Safari", evidence: ["no hit"], fix: "fire on the purchase event" }, ctxFor(own, "chat_app", { client: "Claude Desktop" }));
  assert.deepEqual([done.status, done.result.ok, done.result.title.en], ["done", false, "purchase missing on mobile Safari"]);
  assert.ok(ws.store.findingsFor("ga4_vs_orders").some((f) => f.audit_id === h.id));
  assert.equal(lastActivity().client, "Claude Desktop");
  await assert.rejects(callAction("attach_audit_finding", { audit_id: h.id, ok: true, title: "x" }, ctxFor(own, "chat_app")), (e) => e.code === "not_pending");
});

test("metrics: the data dictionary, a pack metric's page with its history, and a proposed metric accepted into the overlay", async () => {
  const page = await act("get_metric", { metric: "orders" });
  assert.deepEqual(page.history.map((h) => h.version), [3, 2, 1]);
  assert.equal(page.series.rows.length, 90);
  assert.deepEqual(page.checks.map((c) => [c.id, c.role]), [["ga4_vs_orders", "source"], ["gads_vs_orders", "source"], ["meta_vs_orders", "source"]].sort());
  assert.ok(page.used_in.some((u) => u.tile_id === "pin_orders"));
  // A proposal, as an exploratory answer leaves it.
  const answer = ws.store.saveAnswer({ id: "ans_x", question: "Which weekday?", title: { en: "Revenue by weekday", tr: "Hafta gününe göre ciro" }, explore: { unit: "try", sql: "SELECT 1" }, followups: [], sentence: { en: "", tr: "" } });
  const m = await act("propose_metric", { answer_id: answer.id }, agent());
  assert.equal((await act("list_metric_entries")).find((e) => e.id === m.id).status, "proposed");
  const r = await act("decide_metric", { metric: m.id, accept: true });
  assert.equal(r.entry.status, "accepted");
  const file = path.join(ws.config.dataDir, "metrics", `${m.id}.yaml`);
  assert.ok(existsSync(file), "accepted metrics go to the data folder");
  assert.match(readFileSync(file, "utf8"), /sql: SELECT 1/);
  assert.ok(!existsSync(path.join(ws.config.packDir, "metrics", `${m.id}.yaml`)), "never into the shipped pack");
  const accepted = await act("get_metric", { metric: m.id });
  assert.deepEqual([accepted.entry.status, accepted.history[0].version], ["accepted", 1]);
  await assert.rejects(act("decide_metric", { metric: m.id, accept: false }), (e) => e.code === "not_pending");
});

test("conversations, chat-app setup and calls, preferences", async () => {
  assert.ok(Array.isArray(await act("list_conversations")));
  await assert.rejects(act("get_conversation", { conversation_id: "nope" }), (e) => e.code === "not_found");
  const desktop = await act("get_chat_app_setup", { client: "claude-desktop" });
  const cfg = JSON.parse(desktop.snippet);
  assert.equal(cfg.mcpServers["ai-analyst"].command, process.execPath);
  assert.match(cfg.mcpServers["ai-analyst"].args[0], /src\/cli\.js$/);
  assert.equal(cfg.mcpServers["ai-analyst"].env.AI_ANALYST_DATA_DIR, ws.config.dataDir);
  const code = await act("get_chat_app_setup", { client: "claude-code" });
  assert.equal(code.kind, "command");
  assert.match(code.snippet, /^claude mcp add ai-analyst -e /);
  ws.store.put("chat_calls", { id: "call_1", at: new Date().toISOString(), client: "Claude Desktop", tool: "reconcile", check: "ga4_vs_orders" });
  assert.deepEqual((await act("list_chat_app_calls")).map((c) => [c.client, c.tool, c.check]), [["Claude Desktop", "reconcile", "ga4_vs_orders"]]);
  assert.deepEqual(await act("set_preference", { key: "exploratory", value: "off" }), { make_it_yours: "shown", not_now: [], exploratory: "off" });
  assert.deepEqual((await act("set_preference", { key: "not_now", value: "bq" })).not_now, ["bq"]);
});
