// The HTTP API and the security baseline, against a seeded demo workspace on a random port.
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { request } from "node:http";
import path from "node:path";
import { startServer } from "../src/server.js";
import { demoWorkspace, tempDir } from "./helpers.js";

const THEME = "\n(function () { document.documentElement.dataset.t = 'x'; })();\n";
let ws, server, base, port, webDir;
before(async () => {
  ws = await demoWorkspace({ seed: true });
  webDir = tempDir("web-");
  await mkdir(path.join(webDir, "assets"));
  await writeFile(path.join(webDir, "index.html"), `<!doctype html><title>AI Analyst</title><script>${THEME}</script><script type="module" src="/assets/index-AbCdEf12.js"></script>`);
  await writeFile(path.join(webDir, "assets", "index-AbCdEf12.js"), "export {};");
  await writeFile(path.join(webDir, "favicon.svg"), "<svg/>");
  ws.config = { ...ws.config, port: 0 };
  server = await startServer(ws, { webDir });
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});
after(() => {
  server.close();
  ws.close();
});

/** A raw request, so Host, Origin and the body can be anything. */
function raw(method, p, { headers = {}, body, srv = port } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: srv, method, path: p, headers: { Host: `127.0.0.1:${srv}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const post = (p, body, headers = {}) => raw("POST", p, { headers: { "Content-Type": "application/json", Origin: base, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const events = (text) =>
  text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => [block.match(/^event: (.+)$/m)[1], JSON.parse(block.match(/^data: (.+)$/m)[1])]);

test("GET /api/state: the AppState of the contract", async () => {
  const res = await raw("GET", "/api/state");
  assert.equal(res.status, 200);
  const s = res.json;
  assert.deepEqual(Object.keys(s).sort(), ["activity", "agent", "audit_fixed", "audits", "badges", "check_run", "checks", "connectors", "conversations", "currency", "dashboards", "events", "host_is_loopback", "metric_proposals", "offer", "pins", "preferences", "proposals", "source", "waitlist", "watches", "workspace"]);
  assert.deepEqual(s.connectors.map((c) => [c.id, c.status]), [["ga4", "not_connected"], ["orders_file", "not_connected"], ["shopify", "not_connected"], ["woocommerce", "not_connected"]]);
  assert.deepEqual(s.waitlist.map((w) => w.id), ["meta_ads", "google_ads", "tiktok_ads", "ikas", "ticimax", "search_console", "gtm"]);
  assert.deepEqual(s.workspace, { name: "Örnek Moda", demo: true, data_from: "2026-07-25", data_to: "2026-10-22", refreshed_at: s.workspace.refreshed_at, rows: 1080 });
  assert.deepEqual(s.source, { kind: "demo", label: { en: "Demo data", tr: "Demo veri" }, project: null, table: null, error: null });
  assert.equal(s.agent.mode, "planner");
  assert.equal(s.checks.length, 4);
  assert.equal(s.host_is_loopback, true);
  assert.equal(s.offer.help_email, null, "no find-the-cause email on the demo's planted gap");
  assert.deepEqual(s.dashboards, [{ id: "db_example", name: { en: "Shop overview", tr: "Mağaza özeti" }, example: true, tiles: 6 }]);
});

test("actions over HTTP: { ok, result } or { ok: false, error: { code, message } }", async () => {
  const ok = await post("/api/actions/run_query", { metric: "orders", from: "2026-10-09", to: "2026-10-22" });
  assert.deepEqual([ok.status, ok.json.ok, ok.json.result.total], [200, true, 2753]);
  const unknown = await post("/api/actions/nope", {});
  assert.deepEqual([unknown.status, unknown.json.error.code], [404, "unknown_action"]);
  const bad = await post("/api/actions/run_query", { metric: "weather" });
  assert.deepEqual([bad.status, bad.json.ok, bad.json.error.code], [400, false, "invalid_input"]);
  const notJson = await post("/api/actions/run_query", "{nope");
  assert.equal(notJson.status, 400);
  const locked = await post("/api/actions/delete_dashboard", { dashboard_id: "db_example" });
  assert.deepEqual([locked.status, locked.json.error.code], [409, "only_one"]);
});

test("POST /api/ask streams a turn as server-sent events, in the contract's order", async () => {
  const res = await post("/api/ask", { question: "Do GA4 purchases match orders in the last 14 days?", lang: "en", conversation_id: "new" });
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /^text\/event-stream/);
  const ev = events(res.text);
  assert.deepEqual(ev.map(([t]) => t), ["turn", "step", "step", "step", "answer", "text", "done"]);
  assert.match(ev[0][1].turn_id, /^turn_/);
  assert.equal(ev[4][1].answer.check.expected.value, 2753);
  const conv = await post("/api/actions/get_conversation", { conversation_id: ev[0][1].conversation_id });
  assert.equal(conv.json.result.turn_list[0].status, "done");
  const missing = await post("/api/ask", { question: "Orders?", conversation_id: "conv_nope" });
  assert.deepEqual([missing.status, missing.json.error.code], [404, "not_found"]);
  const empty = await post("/api/ask", { question: "" });
  assert.equal(empty.status, 400);
  const stop = await raw("POST", "/api/turns/turn_unknown/stop", { headers: { Origin: base } });
  assert.deepEqual(stop.json, { ok: true, result: { stopped: false } });
});

test("Host header allowlist: another name or port is refused (DNS rebinding)", async () => {
  assert.equal((await raw("GET", "/api/state", { headers: { Host: `localhost:${port}` } })).status, 200);
  assert.equal((await raw("GET", "/api/state", { headers: { Host: `[::1]:${port}` } })).status, 200);
  const evil = await raw("GET", "/api/state", { headers: { Host: `evil.example:${port}` } });
  assert.deepEqual([evil.status, evil.json.error.code], [403, "forbidden"]);
  assert.equal((await raw("GET", "/", { headers: { Host: "127.0.0.1:1" } })).status, 403);
  assert.equal((await raw("GET", "/", { headers: { Host: "localhost" } })).status, 403, "the port is part of the name");
});

test("Origin must be this server on every API call and every non-GET; Sec-Fetch-Site cross-site is refused", async () => {
  assert.equal((await post("/api/actions/list_metrics", {}, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await post("/api/actions/list_metrics", {}, { Origin: "null" })).status, 403);
  assert.equal((await raw("GET", "/api/state", { headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await raw("GET", "/api/state", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await raw("GET", "/api/state", { headers: { Origin: base, "Sec-Fetch-Site": "same-origin" } })).status, 200);
  // A form post cannot carry JSON; anything that is not JSON is refused.
  const form = await raw("POST", "/api/actions/create_dashboard", { headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base }, body: "name=x" });
  assert.equal(form.status, 415);
  const noType = await raw("POST", "/api/actions/create_dashboard", { body: '{"name":"x"}' });
  assert.equal(noType.status, 415);
});

test("no CORS: no Access-Control headers, and a preflight is not answered", async () => {
  const res = await post("/api/actions/list_metrics", {});
  assert.ok(!Object.keys(res.headers).some((h) => h.startsWith("access-control-")));
  const pre = await raw("OPTIONS", "/api/actions/list_metrics", { headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
  assert.notEqual(pre.status, 204);
  assert.ok(!Object.keys(pre.headers).some((h) => h.startsWith("access-control-")));
});

test("a body over 1 MB is refused", async () => {
  const res = await post("/api/actions/list_metrics", JSON.stringify({ pad: "x".repeat(1024 * 1024 + 10) }));
  assert.equal(res.status, 413);
});

test("the page: CSP with default-src 'self' and the theme script by hash, nosniff, no referrer, no framing", async () => {
  const res = await raw("GET", "/");
  assert.equal(res.status, 200);
  const csp = res.headers["content-security-policy"];
  const hash = createHash("sha256").update(THEME).digest("base64");
  assert.match(csp, /default-src 'self'/);
  assert.ok(csp.includes(`script-src 'self' 'sha256-${hash}'`));
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["referrer-policy"], "no-referrer");
  assert.equal(res.headers["cache-control"], "no-cache");
});

test("static files: hashed assets cached for a year, app routes get index.html, missing files and traversal 404", async () => {
  const asset = await raw("GET", "/assets/index-AbCdEf12.js");
  assert.deepEqual([asset.status, asset.headers["content-type"], asset.headers["cache-control"]], [200, "text/javascript; charset=utf-8", "public, max-age=31536000, immutable"]);
  assert.equal((await raw("GET", "/favicon.svg")).headers["content-type"], "image/svg+xml");
  const route = await raw("GET", "/dashboards/db_example");
  assert.deepEqual([route.status, route.headers["content-type"]], [200, "text/html; charset=utf-8"]);
  assert.equal((await raw("GET", "/assets/missing-AbCdEf12.js")).status, 404);
  assert.equal((await raw("GET", "/%2e%2e/%2e%2e/package.json")).status, 404);
  assert.equal((await raw("GET", "/api/nothing")).status, 404);
});

test("without a built web app the page says how to build it", async () => {
  const empty = tempDir("web-empty-");
  const s = await startServer({ ...ws, config: { ...ws.config, port: 0 } }, { webDir: empty });
  const res = await raw("GET", "/", { srv: s.address().port, headers: { Host: `127.0.0.1:${s.address().port}` } });
  s.close();
  assert.equal(res.status, 503);
  assert.match(res.text, /bun run build/);
});

test("errors carry no stack trace or path", async () => {
  const broken = { ...ws, warehouse: { ...ws.warehouse, range: async () => { throw new Error(`boom at ${ws.config.dataDir}/secret.js:12`); } }, config: { ...ws.config, port: 0 } };
  const s = await startServer(broken, { webDir });
  const p = s.address().port;
  const res = await raw("GET", "/api/state", { srv: p, headers: { Host: `127.0.0.1:${p}` } });
  s.close();
  assert.equal(res.status, 500);
  assert.deepEqual(res.json, { ok: false, error: { code: "internal", message: "Something went wrong on the server. The log has the details." } });
});

test("a non-loopback address needs AI_ANALYST_TOKEN; with a token every request needs it (bearer or the cookie)", async () => {
  await assert.rejects(startServer({ ...ws, config: { ...ws.config, host: "0.0.0.0", port: 0, token: null } }, { webDir }), /AI_ANALYST_TOKEN/);
  await assert.rejects(startServer({ ...ws, config: { ...ws.config, port: 0, token: "short" } }, { webDir }), /at least 24/);
  const token = "t0ken-for-tests-0123456789abcdef";
  const s = await startServer({ ...ws, config: { ...ws.config, port: 0, token } }, { webDir });
  const p = s.address().port;
  const h = { Host: `127.0.0.1:${p}` };
  try {
    assert.equal((await raw("GET", "/api/state", { srv: p, headers: h })).status, 401);
    assert.equal((await raw("GET", "/", { srv: p, headers: h })).status, 401);
    assert.equal((await raw("GET", "/api/state", { srv: p, headers: { ...h, Authorization: "Bearer wrong-token-0123456789abcdef" } })).status, 401);
    assert.equal((await raw("GET", "/api/state", { srv: p, headers: { ...h, Authorization: `Bearer ${token}` } })).status, 200);
    const visit = await raw("GET", `/?token=${token}`, { srv: p, headers: h });
    assert.equal(visit.status, 303);
    assert.equal(visit.headers.location, "/");
    const cookie = visit.headers["set-cookie"][0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal((await raw("GET", "/api/state", { srv: p, headers: { ...h, Cookie: cookie.split(";")[0] } })).status, 200);
    assert.equal((await raw("GET", `/api/state?token=${token}`, { srv: p, headers: h })).status, 401, "the query token only works on the page, once");
  } finally {
    s.close();
  }
});

test("through a reverse proxy nothing is local: any forwarding header makes settings refused, whatever its value", async () => {
  for (const h of [{ "X-Forwarded-For": "127.0.0.1" }, { Forwarded: "for=127.0.0.1" }, { "X-Real-IP": "127.0.0.1" }, { Via: "1.1 caddy" }]) {
    const res = await post("/api/actions/set_model_provider", { provider: "planner" }, h);
    assert.deepEqual([res.status, res.json.error.code], [403, "loopback_only"], JSON.stringify(h));
    assert.equal((await raw("GET", "/api/state", { headers: h })).json.host_is_loopback, false);
  }
  assert.equal((await post("/api/actions/set_model_provider", { provider: "planner" })).status, 200, "the same request from this machine works");
  assert.equal((await post("/api/actions/get_chat_app_setup", { client: "cursor" }, { "X-Forwarded-For": "10.0.0.2" })).status, 403, "this machine's paths stay on this machine");
  const remote = await post("/api/actions/get_settings", {}, { "X-Forwarded-For": "10.0.0.2" });
  assert.deepEqual([remote.json.result.server.data_dir, remote.json.result.server.config_file], ["", ""]);
});

test("the Origin check compares the scheme too", async () => {
  assert.equal((await post("/api/actions/list_metrics", {}, { Origin: `https://127.0.0.1:${port}` })).status, 403);
  assert.equal((await post("/api/actions/list_metrics", {}, { Origin: `http://127.0.0.1:${port}` })).status, 200);
});

test("the token visit redirects only to /, never to another site", async () => {
  const token = "t0ken-for-tests-0123456789abcdef";
  const s = await startServer({ ...ws, config: { ...ws.config, port: 0, token } }, { webDir });
  const p = s.address().port;
  try {
    for (const path of [`/a/..//evil.example/?token=${token}`, `//evil.example/?token=${token}`, `/x?token=${token}`]) {
      const res = await raw("GET", path, { srv: p, headers: { Host: `127.0.0.1:${p}` } });
      if (res.status === 303) assert.equal(res.headers.location, "/", path);
    }
  } finally {
    s.close();
  }
});

test("the data dir is the person's own: 0700, with app.db, demo.duckdb and secrets.json 0600", async () => {
  const { statSync } = await import("node:fs");
  const mode = (f) => statSync(path.join(ws.config.dataDir, f)).mode & 0o777;
  assert.equal(statSync(ws.config.dataDir).mode & 0o777, 0o700);
  assert.equal(mode("app.db"), 0o600);
  assert.equal(mode("demo.duckdb"), 0o600);
});
