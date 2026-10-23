// The HTTP API against a seeded demo workspace, on a random port.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "../src/server.js";
import { demoWorkspace } from "./helpers.js";

let ws, server, base, webDir;
before(async () => {
  ws = await demoWorkspace({ seed: true });
  webDir = await mkdtemp(path.join(tmpdir(), "web-"));
  await mkdir(path.join(webDir, "vendor"));
  await writeFile(path.join(webDir, "index.html"), "<!doctype html><title>ai analyst</title>");
  await writeFile(path.join(webDir, "app.js"), "export {};");
  await writeFile(path.join(webDir, "vendor", "ds.css"), "body{}");
  server = await startServer({ ...ws, config: { ...ws.config, port: 0 }, webDir });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  ws.close();
});

const post = (p, body, headers = {}) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

/** Reads an SSE response into [event, data] pairs. */
async function events(res) {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const ev = block.match(/^event: (.+)$/m)[1];
      return [ev, JSON.parse(block.match(/^data: (.+)$/m)[1])];
    });
}

test("GET /api/state: the seeded workspace", async () => {
  const res = await fetch(`${base}/api/state`);
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.deepEqual(Object.keys(s).sort(), ["activity", "agent", "alerts", "check_run", "checks", "conversations", "pins", "workspace"]);
  assert.equal(s.workspace.name, "Örnek Moda");
  assert.equal(s.workspace.demo, true);
  assert.equal(s.workspace.data_from, "2026-07-25");
  assert.equal(s.workspace.data_to, "2026-10-22");
  assert.deepEqual(s.agent, { mode: "planner", model: null });
  assert.equal(s.checks.length, 4);
  // Newest first: the GA4 check answer, ROAS by channel (both by the agent), weekly revenue (by a person).
  assert.deepEqual(s.pins.map((p) => [p.title, p.created_by]), [
    ["GA4 check · last 14 days", "agent"],
    ["ROAS by channel · last 28 days", "agent"],
    ["Weekly revenue · complete weeks", "person"],
  ]);
  assert.equal(s.pins[2].answer.query.group_by, "week");
  assert.equal(s.pins[2].answer.check.check, "ga4_rev_vs_revenue");
  assert.equal(s.pins[1].answer.query.metric, "roas");
  const [conv] = s.conversations;
  assert.equal(conv.turns.length, 1);
  assert.equal(conv.turns[0].question, "Do GA4 purchases match our orders in the last 14 days?");
  assert.equal(conv.turns[0].answers[0].check.expected.value, 2753);
  assert.equal(conv.turns[0].answers[0].check.findings[0].source, "AI Tag Debugger");
  assert.ok(s.activity.length >= 4);
});

test("POST /api/actions/run_query as a person", async () => {
  const res = await post("/api/actions/run_query", { metric: "orders", from: "2026-10-09", to: "2026-10-22" });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.result.total, 2753);
  assert.equal(body.result.dialect, "duckdb");
});

test("POST /api/actions errors: bad input, unknown action, agent-only action", async () => {
  let res = await post("/api/actions/run_query", { metric: "profit" });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, "invalid_input");
  res = await post("/api/actions/nope", {});
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, "unknown_action");
  res = await post("/api/actions/publish_answer", { sentence: "x", query_id: "q" });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, "forbidden");
  res = await post("/api/actions/run_query", "{not json");
  assert.equal((await res.json()).error.code, "bad_request");
});

test("a person's alert is active, and undo works over HTTP", async () => {
  const created = (await (await post("/api/actions/create_alert", { check: "ga4_vs_orders", title: "GA4" })).json()).result;
  assert.equal(created.status, "active");
  const s = await (await fetch(`${base}/api/state`)).json();
  const entry = s.activity.find((e) => e.undo?.id === created.id);
  const undone = await (await post("/api/actions/undo", { activity_id: entry.id })).json();
  assert.equal(undone.ok, true);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).alerts.find((a) => a.id === created.id), undefined);
});

test("POST /api/ask streams a planner turn as server-sent events", async () => {
  const res = await post("/api/ask", { question: "Do Meta conversions match our orders this month?", lang: "en", context: { view: "ask" } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/event-stream/);
  const ev = await events(res);
  assert.deepEqual(ev.map(([t]) => t), ["turn", "step", "step", "step", "answer", "text", "done"]);
  const { answer } = ev.find(([t]) => t === "answer")[1];
  assert.equal(answer.check.expected.value, 483);
  assert.equal(answer.check.measured.value, 658);
  assert.equal(answer.created_by, "planner");
  assert.match(answer.sentence, /\+36\.2%/);
  const { turn_id, conversation_id } = ev[0][1];
  const s = await (await fetch(`${base}/api/state`)).json();
  assert.equal(s.conversations[0].id, conversation_id);
  assert.equal(s.conversations[0].turns.at(-1).id, turn_id);
  // Without an id the question joins the thread the app shows, after the seeded turn.
  assert.equal(s.conversations[0].turns[0].question, "Do GA4 purchases match our orders in the last 14 days?");
  const fresh = await events(await post("/api/ask", { question: "Revenue by week for the last 90 days", conversation_id: "new" }));
  assert.notEqual(fresh[0][1].conversation_id, conversation_id);
  const latest = (await (await fetch(`${base}/api/state`)).json()).conversations[0];
  assert.equal(latest.turns.length, 1);
  const back = await events(await post("/api/ask", { question: "Revenue by week", conversation_id }));
  assert.equal(back[0][1].conversation_id, conversation_id);

  // A follow-up in the same conversation.
  const more = await events(await post("/api/ask", { question: "Son 28 günde en yüksek ROAS hangi kanalda?", lang: "tr", conversation_id }));
  assert.equal(more[0][1].conversation_id, conversation_id);
  assert.match(more.find(([t]) => t === "answer")[1].answer.sentence, /En yüksek kanal Google Ads/);
});

test("POST /api/ask refuses an empty question; stop on an unknown turn is a no-op", async () => {
  const res = await post("/api/ask", { question: "  " });
  assert.equal(res.status, 400);
  const stop = await (await post("/api/turns/turn_nope/stop", {})).json();
  assert.deepEqual(stop, { ok: true, result: { stopped: false } });
});

test("bodies over 1 MB are refused", async () => {
  const res = await post("/api/actions/run_query", JSON.stringify({ metric: "orders", pad: "x".repeat(1024 * 1024 + 10) }));
  assert.equal(res.status, 413);
});

test("cross-origin POSTs and foreign Host headers are refused", async () => {
  let res = await post("/api/actions/run_all_checks", {}, { Origin: "https://evil.example" });
  assert.equal(res.status, 403);
  // fetch will not send a custom Host header, so this one goes through node:http (a DNS-rebinding page would).
  const status = await new Promise((resolve, reject) => get(`${base}/api/state`, { headers: { Host: "evil.example" } }, (r) => resolve(r.resume().statusCode)).on("error", reject));
  assert.equal(status, 403);
  res = await post("/api/actions/run_query", { metric: "orders" }, { Origin: base });
  assert.equal(res.status, 200);
});

test("static files from web/ with their content types; no way out of web/", async () => {
  let res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/html/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  res = await fetch(`${base}/app.js`);
  assert.match(res.headers.get("content-type"), /^text\/javascript/);
  res = await fetch(`${base}/vendor/ds.css`);
  assert.match(res.headers.get("content-type"), /^text\/css/);
  res = await fetch(`${base}/%2e%2e/%2e%2e/package.json`);
  assert.equal(res.status, 404);
  res = await fetch(`${base}/missing.js`);
  assert.equal(res.status, 404);
  res = await fetch(`${base}/api/nothing`);
  assert.equal(res.status, 404);
});
