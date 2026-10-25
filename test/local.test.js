// Your shop's data end to end, with GA4 stubbed and a sample orders file: connect, import, the switch to the local
// source, the GA4 check, revenue, AOV and conversion rate answered, ROAS and the ad checks saying "no data", the
// environment-fixed source that is not switched, the demo reset that keeps the connectors' data. Then the uploads
// over HTTP: loopback only, the content types, the 25 MB cap (declared and streamed), expiry.
// Everything a test writes goes in a folder from tempDir, removed at exit; the largest thing sent is 26 MB, once.
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { request } from "node:http";
import path from "node:path";
import { callAction } from "../src/actions/index.js";
import { addDays } from "../src/format.js";
import { todayIn } from "../src/connectors/attribution.js";
import { localFile } from "../src/connectors/local.js";
import { createUpload, pruneUploads, uploadsDir } from "../src/connectors/uploads.js";
import { MAX_UPLOAD_BYTES } from "../src/connectors/orders-file.js";
import { startServer } from "../src/server.js";
import { ctxFor, demoWorkspace, tempDir } from "./helpers.js";

const open = [];
after(() => open.forEach((w) => w.close()));
const codeIs = (code) => (e) => {
  assert.equal(e.code, code, e.message);
  return true;
};

// The last 7 full days in Istanbul, as a sync of 7 days fetches them.
const TO = addDays(todayIn("Europe/Istanbul"), -1);
const FROM = addDays(TO, -6);
const DAYS = Array.from({ length: 7 }, (_, i) => addDays(FROM, i));
const compact = (d) => d.replace(/-/g, "");

/** GA4 per day: Organic Search on mobile (100 sessions, 3 purchases) and Paid Social on desktop (50, 2). */
function ga4Stub() {
  const calls = [];
  return {
    calls,
    identity: async () => "reader@ornek.iam.gserviceaccount.com",
    async runReport(property, body) {
      calls.push(body);
      const { startDate, endDate } = body.dateRanges[0];
      const days = DAYS.filter((d) => d >= startDate && d <= endDate);
      if (body.orderBys) return { rows: [{ dimensionValues: [{ value: compact(body.orderBys[0].desc ? TO : FROM) }] }] };
      if (body.dimensions.length === 1) return { rows: days.slice(0, 1).map((d) => ({ dimensionValues: [{ value: compact(d) }], metricValues: [{ value: "150" }] })), rowCount: 1 };
      const rows = days.flatMap((d) => [
        { dimensionValues: [{ value: compact(d) }, { value: "Organic Search" }, { value: "mobile" }], metricValues: [{ value: "100" }, { value: "3" }, { value: "300" }] },
        { dimensionValues: [{ value: compact(d) }, { value: "Paid Social" }, { value: "desktop" }], metricValues: [{ value: "50" }, { value: "2" }, { value: "400" }] },
      ]);
      return { rows, rowCount: rows.length, metadata: { currencyCode: "TRY" }, propertyQuota: { tokensPerDay: { remaining: 199000 } } };
    },
  };
}

/** An ikas-like export: per day 3 organic mobile orders of 100 TL and 2 Instagram desktop orders of 200 TL, one test order, emails. */
function ordersCsv() {
  const lines = ["Sipariş No;Sipariş Tarihi;Sipariş Durumu;Toplam Tutar (TL);Kanal;Cihaz;Müşteri E-posta"];
  let n = 1000;
  const tr = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)} 12:00`;
  for (const d of DAYS) {
    for (let i = 0; i < 3; i++) lines.push(`${++n};${tr(d)};Tamamlandı;100,00;Organik;Mobil;musteri${n}@example.com`);
    for (let i = 0; i < 2; i++) lines.push(`${++n};${tr(d)};Kargoda;200,00;Instagram;Masaüstü;musteri${n}@example.com`);
  }
  lines.push(`${++n};${tr(DAYS[0])};Test;5.000,00;Organik;Mobil;test@example.com`);
  return lines.join("\r\n") + "\r\n";
}

async function uploadFile(ws, text, name = "siparisler.csv") {
  const dir = uploadsDir(ws.config);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  writeFileSync(file, text);
  return createUpload(ws, { file, size: Buffer.byteLength(text), fileName: name });
}

async function connectGa4(ws) {
  ws.ga4Transport = ga4Stub();
  const key = path.join(ws.dir, "sa.json");
  writeFileSync(key, JSON.stringify({ type: "service_account", client_email: "reader@ornek.iam.gserviceaccount.com" }));
  const t = await callAction("test_ga4", { property_id: "properties/123456789", auth: { kind: "key_file", path: key } }, ctxFor(ws));
  assert.equal(t.ok, true, JSON.stringify(t.steps));
  return callAction("connect_ga4", { test_id: t.test_id, history_days: 7 }, ctxFor(ws));
}

async function importOrders(ws) {
  const up = await uploadFile(ws, ordersCsv());
  assert.deepEqual(up.mapping.exclude_statuses, ["Test"]);
  const p = await callAction("preview_orders_file", { upload_id: up.upload_id, time_zone: "Europe/Istanbul" }, ctxFor(ws));
  assert.deepEqual(Object.keys(p).sort(), ["columns", "file_name", "kind", "mapping", "preview", "statuses", "time_zone", "upload_id"], "preview_orders_file returns OrdersUpload");
  assert.deepEqual([p.preview.from, p.preview.to, p.preview.days, p.preview.orders, p.preview.revenue], [FROM, TO, 7, 35, 4900]);
  assert.equal(p.preview.excluded.status, 1);
  return { up, state: await callAction("import_orders_file", { upload_id: up.upload_id, mapping: p.mapping, time_zone: "Europe/Istanbul" }, ctxFor(ws)) };
}

test("end to end on your shop's data: GA4 and an orders file; the check, revenue, AOV and conversion answer; ROAS and the ad checks say no data", async () => {
  const ws = await demoWorkspace({ seed: true });
  open.push(ws);
  assert.equal(ws.config.warehouse, "duckdb");

  const ga4 = await connectGa4(ws);
  assert.deepEqual([ga4.id, ga4.status, ga4.target, ga4.last_sync.ok, ga4.last_sync.from, ga4.last_sync.to], ["ga4", "connected", "properties/123456789", true, FROM, TO]);
  assert.deepEqual(ga4.warnings, [], "from the demo the app switches, so no switch note");
  assert.equal(ws.config.warehouse, "local", "the first connect switched from the demo");
  assert.ok(existsSync(localFile(ws.config)));
  assert.ok(ws.ga4Transport.calls.filter((b) => b.dimensions.length === 3).every((b) => b.dateRanges[0].endDate <= TO), "the sync ends yesterday");

  const { up, state } = await importOrders(ws);
  assert.deepEqual([state.id, state.status, state.target, state.last_sync.from, state.last_sync.to], ["orders_file", "connected", "siparisler.csv", FROM, TO]);
  // The file is gone, and nothing personal is kept: not in the app database, not in the warehouse.
  assert.equal(ws.store.get("uploads", up.upload_id), null);
  assert.deepEqual(readdirSync(uploadsDir(ws.config)), []);
  for (const f of [path.join(ws.config.dataDir, "app.db"), localFile(ws.config)]) assert.doesNotMatch(readFileSync(f).toString("latin1"), /@example\.com|musteri10/, f);

  const ctx = ctxFor(ws);
  const q = async (metric) => (await callAction("run_query", { metric, from: FROM, to: TO }, ctx)).total;
  assert.equal(await q("orders"), 35);
  assert.equal(await q("revenue"), 4900);
  assert.equal(await q("aov"), 140);
  assert.equal(await q("sessions"), 1050);
  assert.ok(Math.abs((await q("conversion_rate")) - 35 / 1050) < 1e-9);
  assert.equal(await q("roas"), null);
  assert.equal(await q("ad_spend"), null);
  assert.equal(await q("cpa"), null);
  const byChannel = await callAction("run_query", { metric: "orders", group_by: "channel", from: FROM, to: TO }, ctx);
  assert.deepEqual(byChannel.rows.map((r) => [r.key, r.value]), [["organic", 21], ["meta_ads", 14]]);

  const check = await callAction("reconcile", { check: "ga4_vs_orders", from: FROM, to: TO }, ctx);
  assert.deepEqual([check.expected.value, check.measured.value, check.verdict], [35, 35, "adds_up"]);
  assert.deepEqual(check.breakdown.map((b) => [b.key ?? b.segment, b.verdict]).sort(), [["desktop", "adds_up"], ["mobile", "adds_up"]]);
  const rev = await callAction("reconcile", { check: "ga4_rev_vs_revenue", from: FROM, to: TO }, ctx);
  assert.deepEqual([rev.expected.value, rev.measured.value, rev.verdict], [4900, 4900, "adds_up"]);
  for (const id of ["meta_vs_orders", "gads_vs_orders"]) {
    const c = await callAction("reconcile", { check: id, from: FROM, to: TO }, ctx);
    assert.equal(c.verdict, "insufficient_data", id);
    assert.equal(c.measured.value, null, id);
  }

  // A second import of the same days replaces them, not adds to them.
  await importOrders(ws);
  assert.equal(await q("orders"), 35);

  // Back to the demo and a demo reset: the connectors' data stays, and switching back finds it.
  await callAction("save_data_source", { kind: "demo" }, ctx);
  await callAction("rebuild_demo", {}, ctx);
  assert.equal(ws.config.warehouse, "duckdb");
  assert.ok(ws.store.list("landing", { limit: 1000 }).length > 0, "landing rows kept");
  const kept = await callAction("list_connectors", {}, ctx);
  assert.deepEqual(kept.filter((s) => s.status === "connected").map((s) => s.id), ["ga4", "orders_file"]);
  await callAction("save_data_source", { kind: "local" }, ctx);
  assert.equal(await q("revenue"), 4900);

  // Disconnect returns that connector's own state, now not connected, and its rows are gone.
  const off = await callAction("disconnect_source", { connector: "orders_file" }, ctx);
  assert.deepEqual([off.id, off.status], ["orders_file", "not_connected"]);
  assert.equal(ws.store.list("landing", { limit: 1000 }).filter((r) => r.source === "orders_file").length, 0);
  assert.equal(await q("orders"), null, "no orders source: no data, not 0");
  assert.equal(await q("sessions"), 1050);
});

test("an environment-fixed source is not switched: the data lands, the result says to switch by hand", async () => {
  const ws = await demoWorkspace({ seed: false, env: { AI_ANALYST_WAREHOUSE: "duckdb" } });
  open.push(ws);
  const { state } = await importOrders(ws);
  assert.equal(ws.config.warehouse, "duckdb", "still the demo");
  assert.equal(state.status, "connected");
  assert.equal(state.warnings.length > 0, true);
  assert.match(state.warnings.at(-1).en, /AI_ANALYST_WAREHOUSE=local/);
  assert.ok(existsSync(localFile(ws.config)), "the local file is built all the same");
  // The note is in the result only, not in the stored state.
  const listed = (await callAction("list_connectors", {}, ctxFor(ws))).find((s) => s.id === "orders_file");
  assert.ok(!listed.warnings.some((w) => /AI_ANALYST_WAREHOUSE/.test(w.en)));
  await assert.rejects(callAction("save_data_source", { kind: "local" }, ctxFor(ws)), codeIs("locked"));
});

test("uploads expire after an hour; stray files are pruned; a new upload replaces the one before", async () => {
  const ws = await demoWorkspace({ seed: false });
  open.push(ws);
  const a = await uploadFile(ws, ordersCsv());
  const b = await uploadFile(ws, ordersCsv());
  assert.equal(ws.store.get("uploads", a.upload_id), null, "one upload at a time");
  assert.deepEqual(ws.store.list("uploads", { limit: 10 }).map((u) => u.id), [b.upload_id]);
  assert.equal(readdirSync(uploadsDir(ws.config)).length, 1);

  const rec = ws.store.get("uploads", b.upload_id);
  ws.store.put("uploads", { ...rec, created_at: new Date(Date.now() - 61 * 60 * 1000).toISOString() });
  await assert.rejects(callAction("preview_orders_file", { upload_id: b.upload_id }, ctxFor(ws)), codeIs("upload_not_found"));
  assert.equal(existsSync(rec.file), false, "the expired file is deleted");
  await assert.rejects(callAction("import_orders_file", { upload_id: b.upload_id, mapping: b.mapping, time_zone: "Europe/Istanbul" }, ctxFor(ws)), codeIs("upload_not_found"));

  const stray = path.join(uploadsDir(ws.config), "up_stray.csv");
  writeFileSync(stray, "a,b\n1,2\n");
  const old = new Date(Date.now() - 5 * 60 * 1000);
  utimesSync(stray, old, old);
  const fresh = path.join(uploadsDir(ws.config), "up_fresh.csv");
  writeFileSync(fresh, "a,b\n1,2\n");
  pruneUploads(ws);
  assert.equal(existsSync(stray), false);
  assert.equal(existsSync(fresh), true, "a file being written right now is left alone");

  await assert.rejects(callAction("preview_orders_file", { upload_id: "up_nope" }, ctxFor(ws)), codeIs("upload_not_found"));
  const c = await uploadFile(ws, ordersCsv());
  await assert.rejects(callAction("preview_orders_file", { upload_id: c.upload_id, time_zone: "Mars/Olympus" }, ctxFor(ws)), codeIs("invalid_input"));
  await assert.rejects(callAction("preview_orders_file", { upload_id: c.upload_id, mapping: { ...c.mapping, total: "Yok" } }, ctxFor(ws)), codeIs("mapping_invalid"));
  // The connector actions are a person's, from this machine only.
  await assert.rejects(callAction("import_orders_file", { upload_id: c.upload_id, mapping: c.mapping, time_zone: "Europe/Istanbul" }, ctxFor(ws, "agent", { turn: { id: "t", conversation_id: "c", question: "q", answers: [], approvals: [] } })), codeIs("forbidden"));
  await assert.rejects(callAction("list_connectors", {}, ctxFor(ws, "person", { loopback: false })), codeIs("loopback_only"));
});

// ---------------------------------------------------------------- uploads over HTTP

let ws, server, port, base;
before(async () => {
  ws = await demoWorkspace({ seed: false });
  open.push(ws);
  const webDir = tempDir("web-");
  writeFileSync(path.join(webDir, "index.html"), "<!doctype html><title>t</title>");
  ws.config = { ...ws.config, port: 0 };
  server = await startServer(ws, { webDir });
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});
after(() => server?.close());

/** One upload; resolved when the answer has arrived and the request is closed, so no stream outlives the test. */
function send(body, headers = {}) {
  return new Promise((resolve, reject) => {
    let answer = null;
    let closed = false;
    const settle = () => answer?.json !== undefined && closed && resolve(answer);
    const req = request({ host: "127.0.0.1", port, method: "POST", path: "/api/uploads/orders", headers: { Host: `127.0.0.1:${port}`, Origin: base, ...headers } }, (res) => {
      const chunks = [];
      answer = { status: res.statusCode };
      res.on("data", (c) => chunks.push(c));
      res.on("error", () => {});
      res.on("end", () => {
        answer.json = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
        settle();
      });
    });
    // A refused upload is answered and its connection closed while the body may still be going out.
    req.on("error", (e) => (answer || ["EPIPE", "ECONNRESET", "ERR_STREAM_DESTROYED"].includes(e.code) ? null : reject(e)));
    req.on("close", () => {
      closed = true;
      settle();
    });
    req.end(body);
  });
}
const files = () => (existsSync(uploadsDir(ws.config)) ? readdirSync(uploadsDir(ws.config)) : []);

test("POST /api/uploads/orders: CSV (text/csv and application/vnd.ms-excel) and XLSX types; others refused", async () => {
  const csv = ordersCsv();
  for (const type of ["text/csv", "text/csv; charset=utf-8", "application/vnd.ms-excel", "application/octet-stream"]) {
    const r = await send(csv, { "Content-Type": type, "X-File-Name": encodeURIComponent("Sipariş Raporu.csv") });
    assert.equal(r.status, 200, `${type}: ${JSON.stringify(r.json)}`);
    assert.deepEqual([r.json.result.kind, r.json.result.file_name, r.json.result.preview.orders], ["csv", "Sipariş Raporu.csv", 35], type);
  }
  // A real .xls (binary) sent as application/vnd.ms-excel is refused, not read as text.
  const xls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
  const bad = await send(xls, { "Content-Type": "application/vnd.ms-excel", "X-File-Name": "orders.xls" });
  assert.deepEqual([bad.status, bad.json.error.code], [415, "upload_kind"]);
  for (const type of ["text/plain", "application/json", "multipart/form-data; boundary=x", "application/x-www-form-urlencoded"]) {
    const r = await send(csv, { "Content-Type": type });
    assert.equal(r.status, 415, type);
  }
  const empty = await send("", { "Content-Type": "text/csv" });
  assert.deepEqual([empty.status, empty.json.error.code], [422, "file_unreadable"]);
  // Another site's page cannot upload.
  const cross = await send(csv, { "Content-Type": "text/csv", Origin: "https://evil.test" });
  assert.equal(cross.status, 403);
  const site = await send(csv, { "Content-Type": "text/csv", "Sec-Fetch-Site": "cross-site" });
  assert.equal(site.status, 403);
  assert.ok(files().length <= 1, `at most the one live upload is on disk: ${files()}`);
});

test("uploads are loopback only: a request through a proxy is refused before anything is written", async () => {
  const before = files();
  for (const h of ["X-Forwarded-For", "Forwarded", "X-Real-IP", "Via"]) {
    const r = await send(ordersCsv(), { "Content-Type": "text/csv", [h]: "203.0.113.9" });
    assert.deepEqual([r.status, r.json.error.code], [403, "loopback_only"], h);
  }
  assert.deepEqual(files(), before);
});

test("the 25 MB cap: a declared length is refused unread; a streamed body is cut off and its file removed", async () => {
  const before = files();
  // Declared: headers only, the body is never sent. Resolved once the socket is closed, so nothing outlives the test.
  const declared = await new Promise((resolve, reject) => {
    const sock = connect(port, "127.0.0.1");
    let text = "";
    let answered = false;
    sock.setTimeout(10_000, () => (sock.destroy(), reject(new Error("no answer to a declared oversize upload"))));
    sock.on("data", (c) => {
      text += c.toString("utf8");
      if (!answered && /\r\n\r\n[\s\S]*\}/.test(text)) (answered = true), sock.destroy();
    });
    sock.on("error", (e) => (answered ? null : reject(e)));
    sock.on("close", () => (answered ? resolve(text) : reject(new Error(`closed without an answer: ${text}`))));
    sock.write(`POST /api/uploads/orders HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${base}\r\nContent-Type: text/csv\r\nContent-Length: ${MAX_UPLOAD_BYTES + 1}\r\n\r\n`);
  });
  assert.match(declared, /^HTTP\/1\.1 413/);
  assert.match(declared, /upload_too_large/);

  // Streamed without a length: 1 MB chunks until the server answers, 26 MB at most. Writing stops at the answer (or
  // when the stream is gone), and the result waits for the request and its socket to close.
  const streamed = await new Promise((resolve, reject) => {
    let answer = null;
    let closed = false;
    const settle = () => answer?.done && closed && resolve(answer);
    const req = request({ host: "127.0.0.1", port, method: "POST", path: "/api/uploads/orders", headers: { Host: `127.0.0.1:${port}`, Origin: base, "Content-Type": "text/csv", "Transfer-Encoding": "chunked" } }, (res) => {
      const chunks = [];
      answer = { status: res.statusCode, done: false };
      res.on("data", (c) => chunks.push(c));
      res.on("error", () => {});
      res.on("end", () => {
        answer.body = Buffer.concat(chunks).toString("utf8");
        answer.done = true;
        req.destroy();
        settle();
      });
    });
    // After the server's answer the connection is closed under the writer: EPIPE, ECONNRESET or a write after destroy.
    req.on("error", (e) => (answer || ["EPIPE", "ECONNRESET", "ERR_STREAM_DESTROYED"].includes(e.code) ? null : reject(e)));
    req.on("close", () => {
      closed = true;
      if (!answer) return reject(new Error("closed without an answer"));
      settle();
    });
    const chunk = Buffer.alloc(1024 * 1024, "a,b\n");
    let sent = 0;
    const pump = () => {
      while (sent < 26) {
        if (answer || req.destroyed || req.writableEnded) return;
        sent++;
        if (!req.write(chunk)) return req.once("drain", pump);
      }
      if (!answer && !req.destroyed) req.end();
    };
    pump();
  });
  assert.equal(streamed.status, 413);
  assert.match(streamed.body, /upload_too_large/);
  assert.deepEqual(files(), before, "the partial file is removed");
});

// ---------------------------------------------------------------- what your shop's data offers

test("on your shop's data: suggestions and follow-ups only for what the sources can answer; events per source; the last disconnect goes back to the demo", async () => {
  const ws = await demoWorkspace({ seed: true });
  open.push(ws);
  const ctx = ctxFor(ws);
  const texts = async () => (await callAction("list_suggestions", {}, ctx)).map((s) => s.text.en);
  const demo = await texts();
  assert.ok(demo.some((t) => /Meta/.test(t)) && demo.some((t) => /ROAS/.test(t)), "the demo offers the ad questions");
  const demoEvents = (await callAction("list_events", {}, ctx)).map((e) => e.id).sort();
  assert.deepEqual(demoEvents, ["ev_gtm58", "ev_sale", "ev_ship", "ev_v412"]);

  // Orders only: no GA4 check, no ad checks, no ROAS; four questions the orders can answer.
  await importOrders(ws);
  assert.equal(ws.config.warehouse, "local");
  let local = await callAction("list_suggestions", {}, ctx);
  assert.equal(local.length, 4);
  for (const t of local.map((s) => s.text.en)) assert.doesNotMatch(t, /Meta|Google Ads|ROAS|GA4|spend|Conversion rate/, t);
  assert.ok(local.every((s) => ["check", "chart", "by_channel", "comparison", "exploratory"].includes(s.tag)));

  // With GA4 too: the GA4 check and conversion rate come back; the ad questions stay out.
  await connectGa4(ws);
  local = await callAction("list_suggestions", {}, ctx);
  const lt = local.map((s) => s.text.en);
  assert.ok(lt.some((t) => /GA4 purchases match orders/.test(t)), lt.join(" | "));
  assert.ok(!lt.some((t) => /Meta|Google Ads|ROAS|spend/.test(t)), lt.join(" | "));

  // Follow-ups from the planner: none for a check or metric without data.
  const { runTurn } = await import("../src/agent/agent.js");
  for (const q of ["Do GA4 purchases match orders in the last 14 days?", "Revenue last week against the week before", "Orders by device in the last 28 days"]) {
    const turn = await runTurn({ question: q, lang: "en", conversationId: "new", app: ws });
    const last = turn.answers.at(-1);
    const a = typeof last === "string" ? ws.store.getAnswer(last) : last;
    assert.ok(a, q);
    for (const f of a.followups ?? []) assert.doesNotMatch(f.en, /Meta|Google Ads|ROAS|spend/, `${q} → ${f.en}`);
  }

  // The insufficient-data reason names the metric by its label.
  const meta = await callAction("reconcile", { check: "meta_vs_orders", from: FROM, to: TO }, ctx);
  assert.equal(meta.verdict, "insufficient_data");
  assert.match(meta.reason.en, /No data for platform-reported conversions in this period/);
  const empty = await callAction("reconcile", { check: "ga4_vs_orders", from: addDays(FROM, -400), to: addDays(FROM, -390) }, ctx);
  if (empty.reason) assert.doesNotMatch(empty.reason.en, /ga4 purchases/);

  // Events: the demo's stay with the demo; one added here stays here.
  assert.deepEqual(await callAction("list_events", {}, ctx), []);
  const added = await callAction("save_event", { event: { date: FROM, title: { en: "Shop launch", tr: "Mağaza açılışı" }, type: "other" } }, ctx);
  assert.equal(added.event.data_source, "local");
  assert.deepEqual((await callAction("list_events", {}, ctx)).map((e) => e.id), [added.event.id]);
  await assert.rejects(callAction("save_event", { event: { id: "ev_v412", date: FROM, title: { en: "x", tr: "x" }, type: "other" } }, ctx), codeIs("not_found"));
  const { buildState } = await import("../src/state.js");
  assert.deepEqual((await buildState(ws)).events.map((e) => e.id), [added.event.id]);
  await callAction("save_data_source", { kind: "demo" }, ctx);
  assert.deepEqual((await callAction("list_events", {}, ctx)).map((e) => e.id).sort(), demoEvents);
  await callAction("save_data_source", { kind: "local" }, ctx);

  // Disconnecting one of two keeps the shop's data; disconnecting the last goes back to the demo, and says so.
  const first = await callAction("disconnect_source", { connector: "orders_file" }, ctx);
  assert.equal(ws.config.warehouse, "local");
  assert.ok(!first.warnings.some((w) => /demo/.test(w.en)));
  const last = await callAction("disconnect_source", { connector: "ga4" }, ctx);
  assert.deepEqual([last.id, last.status], ["ga4", "not_connected"]);
  assert.equal(ws.config.warehouse, "duckdb");
  assert.match(last.warnings.at(-1).en, /switched back to the demo/);
  assert.equal(ws.store.listActivity(5).some((a) => a.action === "save_data_source"), true);
});

test("the last disconnect on an environment-fixed local source stays, and says why", async () => {
  const ws = await demoWorkspace({ seed: false, env: { AI_ANALYST_WAREHOUSE: "local" } });
  open.push(ws);
  const { state } = await importOrders(ws);
  assert.deepEqual(state.warnings.filter((w) => /AI_ANALYST_WAREHOUSE/.test(w.en)), [], "already on local: no switch note");
  const off = await callAction("disconnect_source", { connector: "orders_file" }, ctxFor(ws));
  assert.equal(ws.config.warehouse, "local");
  assert.match(off.warnings.at(-1).en, /AI_ANALYST_WAREHOUSE in the environment fixes the data source/);
});
