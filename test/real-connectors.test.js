// What a real run of the connectors turned up (owner's GA4 property, a theLook orders file), each with a stubbed
// test: Google's API-disabled and demo-property errors, the referral and organic social channels, suggestions on
// your shop's data without a device split or ad data, Turkish apostrophes, the model's knowledge of the sources, a
// metric with no data as a number card, and connect answers that always carry a JSON body.
import "./setup.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { callAction } from "../src/actions/index.js";
import { systemPrompt } from "../src/agent/agent.js";
import { ROOT } from "../src/config.js";
import { channelFrom } from "../src/connectors/attribution.js";
import { channelOfGroup, enableLink, fetchGa4Days, ga4Error } from "../src/connectors/ga4.js";
import { replaceLanding } from "../src/connectors/local.js";
import { fetchShopifyDays, shopifyClient } from "../src/connectors/shopify.js";
import { createUpload, uploadsDir } from "../src/connectors/uploads.js";
import { fetchWooDays, wooClient } from "../src/connectors/woocommerce.js";
import { addDays } from "../src/format.js";
import { todayIn } from "../src/connectors/attribution.js";
import { MART, NAMES as MART_NAMES } from "../src/metrics/load.js";
import { json } from "../src/server.js";
import { dimName, trApostrophes, trApostrophesDeep } from "../src/text.js";
import { ctxFor, demoWorkspace } from "./helpers.js";

const open = [];
after(() => open.forEach((w) => w.close()));
const codeIs = (code) => (e) => {
  assert.equal(e.code, code, e.message);
  return true;
};
const TO = addDays(todayIn("Europe/Istanbul"), -1);
const FROM = addDays(TO, -6);
const DAYS = Array.from({ length: 7 }, (_, i) => addDays(FROM, i));
const gaxios = (status, error) => Object.assign(new Error(error.message), { code: status, response: { status, data: { error: { code: status, ...error } } } });

// ---------------------------------------------------------------- 1, 2: Google's errors

test("1: the Data API turned off in the project is api_disabled, with the project and a console link Google's message points to", () => {
  const msg = "Google Analytics Data API has not been used in project 123456789012 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=123456789012 then retry.";
  const withDetails = ga4Error(gaxios(403, { status: "PERMISSION_DENIED", message: msg, details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", metadata: { consumer: "projects/123456789012", service: "analyticsdata.googleapis.com", activationUrl: "https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=123456789012" } }] }));
  assert.equal(withDetails.code, "api_disabled");
  assert.deepEqual(withDetails.params, { service: "Google Analytics Data API", project: "123456789012", link: "https://console.cloud.google.com/apis/api/analyticsdata.googleapis.com/overview?project=123456789012" });
  // From the message alone (no details), and a link anywhere else is never passed on.
  const fromText = ga4Error(gaxios(403, { message: msg }));
  assert.deepEqual([fromText.code, fromText.params.project, new URL(fromText.params.link).hostname], ["api_disabled", "123456789012", "console.cloud.google.com"]);
  const evil = ga4Error(gaxios(403, { message: "Google Analytics Data API has not been used in project 42 before or it is disabled. Enable it by visiting https://evil.test/enable?project=42 then retry." }));
  assert.equal(evil.code, "api_disabled");
  assert.equal(evil.params.link, undefined);
  assert.equal(enableLink("https://console.cloud.google.com/x", "7"), "https://console.cloud.google.com/apis/api/analyticsdata.googleapis.com/overview?project=7");
  assert.equal(enableLink("", "not-a-number"), null);
  // An ordinary permission error stays property_not_found.
  assert.equal(ga4Error(gaxios(403, { status: "PERMISSION_DENIED", message: "User does not have sufficient permissions for this property." })).code, "property_not_found");
});

test("1: test_ga4 reports api_disabled at the property step with the link", async () => {
  const ws = await demoWorkspace({ seed: false });
  open.push(ws);
  const key = path.join(ws.dir, "sa.json");
  writeFileSync(key, JSON.stringify({ type: "service_account", client_email: "r@p.iam.gserviceaccount.com" }));
  ws.ga4Transport = { identity: async () => "r@p.iam.gserviceaccount.com", runReport: async () => { throw gaxios(403, { message: "Google Analytics Data API has not been used in project 55 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=55 then retry." }); } };
  const t = await callAction("test_ga4", { property_id: "123456789", auth: { kind: "key_file", path: key } }, ctxFor(ws));
  const step = t.steps.find((s) => s.id === "property");
  assert.deepEqual([t.ok, step.status, step.error.code, step.error.params.project, step.error.params.link], [false, "failed", "api_disabled", "55", "https://console.cloud.google.com/apis/api/analyticsdata.googleapis.com/overview?project=55"]);
});

test("2: a property denied the API is property_api_denied; rate_limited only for a real quota error", () => {
  assert.equal(ga4Error(gaxios(429, { status: "RESOURCE_EXHAUSTED", message: "This property is denied access to the API." })).code, "property_api_denied");
  assert.equal(ga4Error(gaxios(403, { message: "This property is denied access to the API." })).code, "property_api_denied");
  assert.equal(ga4Error(gaxios(429, { status: "RESOURCE_EXHAUSTED", message: "Exhausted property tokens per day for this property." })).code, "rate_limited");
  assert.equal(ga4Error(gaxios(429, { message: "Too many requests", details: [{ reason: "RATE_LIMIT_EXCEEDED" }] })).code, "rate_limited");
  assert.equal(ga4Error(gaxios(429, { message: "Something else entirely." })).code, "source_unavailable", "a 429 that names no quota is not a quota error");
});

// ---------------------------------------------------------------- 3: channels

test("3: referral and organic social are mart channels with labels; GA4 groups use the session source", async () => {
  assert.deepEqual(MART.dimensions.channel, ["organic", "direct", "google_ads", "meta_ads", "tiktok_ads", "email", "referral", "organic_social", "other", "unknown"]);
  assert.deepEqual([dimName("referral", "en"), dimName("referral", "tr"), dimName("organic_social", "en"), dimName("organic_social", "tr")], ["Referral", "Yönlendirme", "Organic social", "Organik sosyal"]);
  assert.deepEqual(MART_NAMES.channel.organic_social, { en: "Organic social", tr: "Organik sosyal" });
  // The owner's site: Referral and Organic Social were 10 of 47 sessions, all in "other".
  const rows = [
    ["Organic Search", "google", 20], ["Direct", "(direct)", 17], ["Referral", "chatgpt.com", 6], ["Organic Social", "linkedin.com", 4], ["Paid Social", "facebook", 0], ["Paid Social", "linkedin", 0], ["Organic Video", "youtube", 0],
  ];
  const transport = { runReport: async () => ({ rowCount: rows.length, rows: rows.map(([g, src, n]) => ({ dimensionValues: [{ value: "20261020" }, { value: g }, { value: "desktop" }, { value: src }], metricValues: [{ value: String(n) }, { value: "0" }, { value: "0" }] })) }) };
  const r = await fetchGa4Days(transport, "123456789", "2026-10-20", "2026-10-20");
  assert.deepEqual(r.rows.map((x) => [x.channel, x.sessions]), [["organic", 20], ["direct", 17], ["referral", 6], ["organic_social", 4], ["meta_ads", 0], ["other", 0], ["other", 0]]);
  assert.equal(channelOfGroup("Paid Social", "instagram.com"), "meta_ads");
  assert.equal(channelOfGroup("Paid Social", "pinterest"), "other");

  // The mart keeps them (not folded into unknown).
  const ws = await demoWorkspace({ seed: false });
  open.push(ws);
  replaceLanding(ws.store, { table: "ga4", source: "ga4", from: "2026-10-20", to: "2026-10-20", rows: r.rows });
  assert.deepEqual([...new Set(ws.store.list("landing", { limit: 100 }).map((x) => x.channel))].sort(), ["direct", "meta_ads", "organic", "organic_social", "other", "referral"]);
});

test("3: the orders file, Shopify and WooCommerce attribute referral and organic social", async () => {
  const cases = [
    [{ channel: "Referral" }, "referral"], [{ channel: "Yönlendirme" }, "referral"], [{ channel: "Sosyal medya" }, "organic_social"], [{ channel: "Organic Social" }, "organic_social"],
    [{ channel: "blog.example.com / referral" }, "referral"], [{ channel: "facebook / social" }, "organic_social"], [{ channel: "instagram / paid" }, "meta_ads"], [{ channel: "t.co / social" }, "organic_social"],
    [{ source: "l.facebook.com" }, "organic_social"], [{ source: "linkedin.com" }, "organic_social"], [{ source: "blog.example.com" }, "referral"], [{ source: "facebook", medium: "cpc" }, "meta_ads"],
    [{ source: "tiktok", medium: "paid" }, "tiktok_ads"], [{ source: "tiktok" }, "organic_social"], [{ sourceType: "referral" }, "referral"], [{ sourceType: "utm" }, "other"], [{ channel: "Paid Social" }, "other"],
  ];
  for (const [input, id] of cases) assert.equal(channelFrom(input), id, JSON.stringify(input));

  // Shopify: the last visit's referring site and a social source without UTM.
  const order = (source, amount) => ({ createdAt: "2026-10-20T09:00:00Z", test: false, totalPriceSet: { shopMoney: { amount: String(amount), currencyCode: "TRY" } }, totalShippingPriceSet: { shopMoney: { amount: "0" } }, customerJourneySummary: { lastVisit: { source, utmParameters: null } } });
  const shop = shopifyClient({ connectorFetch: async () => new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false }, nodes: [order("blog.example.com", 10), order("instagram", 20)] } } }), { status: 200 }) }, "ornek.myshopify.com", "t");
  const s = await fetchShopifyDays(shop, { from: "2026-10-20", to: "2026-10-20", timeZone: "Europe/Istanbul" });
  assert.deepEqual(s.rows.map((x) => x.channel).sort(), ["organic_social", "referral"]);

  // WooCommerce: the order attribution's source type and UTM.
  const woo = wooClient({ connectorFetch: async () => new Response(JSON.stringify([
    { status: "completed", date_created_gmt: "2026-10-20T09:00:00", total: "10", shipping_total: "0", currency: "TRY", meta_data: [{ key: "_wc_order_attribution_source_type", value: "referral" }, { key: "_wc_order_attribution_utm_source", value: "blog.example.com" }] },
    { status: "completed", date_created_gmt: "2026-10-20T09:00:00", total: "10", shipping_total: "0", currency: "TRY", meta_data: [{ key: "_wc_order_attribution_utm_source", value: "instagram" }, { key: "_wc_order_attribution_utm_medium", value: "social" }] },
  ]), { status: 200 }) }, "https://shop.example.com", "k", "s");
  const w = await fetchWooDays(woo, { from: "2026-10-20", to: "2026-10-20", timeZone: "Europe/Istanbul" });
  assert.deepEqual(w.rows.map((x) => x.channel).sort(), ["organic_social", "referral"]);
});

// ---------------------------------------------------------------- 4: suggestions by what the sources fill

async function importCsv(ws, text) {
  const dir = uploadsDir(ws.config);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `t-${Date.now()}.csv`);
  writeFileSync(file, text);
  const up = await createUpload(ws, { file, size: Buffer.byteLength(text), fileName: "orders.csv" });
  return callAction("import_orders_file", { upload_id: up.upload_id, mapping: up.mapping, time_zone: "Europe/Istanbul" }, ctxFor(ws));
}
const csvOf = ({ device }) => ["Sipariş No;Sipariş Tarihi;Toplam Tutar;Kanal" + (device ? ";Cihaz" : ""), ...DAYS.flatMap((d, i) => [`${i * 2 + 1};${d} 12:00;100,00;Organik${device ? ";Mobil" : ""}`, `${i * 2 + 2};${d} 13:00;200,00;Instagram${device ? ";Masaüstü" : ""}`])].join("\n") + "\n";

test("4: on your shop's data, no exploratory chip needs ad spend, and none splits by device when no source records one", async () => {
  const ws = await demoWorkspace({ seed: true, env: { ANTHROPIC_API_KEY: "sk-ant-test-00000000000000" } });
  open.push(ws);
  const ctx = ctxFor(ws);
  const texts = async () => (await callAction("list_suggestions", {}, ctx)).map((s) => s.text.en);
  const demo = await texts();
  assert.ok(demo.some((t) => /ad spend grew/.test(t)) && demo.some((t) => /by device by week/.test(t)), "the demo offers them all");

  await importCsv(ws, csvOf({ device: false }));
  assert.equal(ws.config.warehouse, "local");
  const noDevice = await texts();
  assert.ok(!noDevice.some((t) => /ad spend|by device|and device/.test(t)), noDevice.join(" | "));
  assert.ok(noDevice.some((t) => /weekday/.test(t)), "a question the orders can answer stays");

  // With a device column the device questions come back; the ad spend one never does.
  await importCsv(ws, csvOf({ device: true }));
  const withDevice = await texts();
  assert.ok(withDevice.some((t) => /by device by week/.test(t)), withDevice.join(" | "));
  assert.ok(!withDevice.some((t) => /ad spend/.test(t)));
});

// ---------------------------------------------------------------- 5: the doc

test("5: the GA4 sign-in that works is documented", () => {
  const doc = readFileSync(path.join(ROOT, "docs", "connecting-your-shop.md"), "utf8");
  for (const s of ["--client-id-file=", "Desktop app", "External", "Testing", "Test users", "Google Analytics Data API", "Viewer", "property_api_denied", "This app is blocked"]) assert.ok(doc.includes(s), s);
});

// ---------------------------------------------------------------- 6, 7: what the model writes and knows

test("6: Turkish suffixes take ’: stored tr text is normalised, en text and code are not touched", async () => {
  assert.equal(trApostrophes("Ciro 3.535 TL'ydi; 12 Eki'de GA4'te düştü, %4,2'lik fark"), "Ciro 3.535 TL’ydi; 12 Eki’de GA4’te düştü, %4,2’lik fark");
  assert.equal(trApostrophes("“ai analyst’te” zaten doğru"), "“ai analyst’te” zaten doğru");
  assert.equal(trApostrophes("'tırnak' içinde"), "'tırnak' içinde", "an opening quote is not a suffix");
  assert.deepEqual(trApostrophesDeep({ en: "don't", tr: "GA4'te" }), { en: "don't", tr: "GA4’te" });
  assert.deepEqual(trApostrophesDeep({ sql: "WHERE x = 'a'", rows: [{ en: "a'b", tr: "Eki'de" }] }), { sql: "WHERE x = 'a'", rows: [{ en: "a'b", tr: "Eki’de" }] });
  const ws = await demoWorkspace({ seed: false });
  open.push(ws);
  const r = await callAction("save_event", { event: { date: "2026-10-12", title: { en: "Sale on 12 Oct", tr: "12 Eki'de indirim" }, type: "campaign", note: { en: "GA4's tag", tr: "GA4'ün etiketi" } } }, ctxFor(ws));
  assert.deepEqual([r.event.title.tr, r.event.note.tr, r.event.note.en], ["12 Eki’de indirim", "GA4’ün etiketi", "GA4's tag"]);
});

test("7: the prompt knows the sources and the ai cloud waitlist, and the apostrophe rule", async () => {
  const ws = await demoWorkspace({ seed: false });
  open.push(ws);
  const p = systemPrompt({ pack: ws.pack, range: await ws.warehouse.range(), workspace: "Örnek Moda", demo: true, lang: "tr" });
  for (const s of ["GA4, an orders file, Shopify, WooCommerce", "There is no Google Ads, Meta Ads or TikTok Ads connector in this app", "ai cloud waitlist", "never suggest connecting an ad platform here", "typographic apostrophe ’"]) assert.ok(p.includes(s), s);
});

// ---------------------------------------------------------------- 8: no data as a number card

test("8: a metric with no data for the whole period is a number card that says no data, never an empty chart", async () => {
  const ws = await demoWorkspace({ seed: true });
  open.push(ws);
  await importCsv(ws, csvOf({ device: true }));
  const { runTurn } = await import("../src/agent/agent.js");
  const turn = await runTurn({ question: "ROAS by channel in the last 28 days", lang: "en", conversationId: "new", app: ws });
  const last = turn.answers.at(-1);
  const a = typeof last === "string" ? ws.store.getAnswer(last) : last;
  assert.equal(a.query.metric, "roas");
  assert.equal(a.query.total, null);
  assert.equal(a.kind, "number");
  assert.match(a.sentence.en, /no data/);
  assert.match(a.sentence.tr, /veri yok/);

  // The model's path: publish_answer on that query gives the same card.
  const agent = ctxFor(ws, "agent", { turn: { id: "t1", conversation_id: "c1", question: "ROAS?", answers: [], approvals: [] }, mode: { model_label: "Test" } });
  const q = await callAction("run_query", { metric: "roas", group_by: "channel", from: FROM, to: TO }, agent);
  const pub = await callAction("publish_answer", { query_id: q.id, sentence: { en: "There is no ad spend data for this period, so ROAS has no data.", tr: "Bu dönemde reklam harcaması verisi yok; ROAS için veri yok." } }, agent);
  assert.equal(pub.kind, "number");
  // Revenue by channel, which has data, stays a split.
  const r = await callAction("run_query", { metric: "revenue", group_by: "channel", from: FROM, to: TO }, agent);
  const pr = await callAction("publish_answer", { query_id: r.id, sentence: { en: "Revenue by channel.", tr: "Kanallara göre ciro." } }, agent);
  assert.equal(pr.kind, "split");
});

// ---------------------------------------------------------------- 9: connect always answers

test("9: an answer JSON cannot hold is a 500 with a JSON body, never a 200 with an empty one", () => {
  const sent = {};
  const res = { destroyed: false, writableEnded: false, writeHead: (status, headers) => Object.assign(sent, { status, headers }), end: (body) => (sent.body = body) };
  json(res, 200, { ok: true, result: { n: 10n } });
  assert.equal(sent.status, 500);
  assert.deepEqual(JSON.parse(sent.body).error.code, "internal");
  const ok = {};
  json({ ...res, writeHead: (status) => (ok.status = status), end: (b) => (ok.body = b) }, 200, { ok: true });
  assert.deepEqual([ok.status, ok.body], [200, '{"ok":true}']);
});

test("9: a connect that meets a running sync waits for it and then syncs, instead of answering with nothing fetched", async () => {
  const ws = await demoWorkspace({ seed: false });
  open.push(ws);
  const key = path.join(ws.dir, "sa.json");
  writeFileSync(key, JSON.stringify({ type: "service_account", client_email: "r@p.iam.gserviceaccount.com" }));
  let slow = 0;
  ws.ga4Transport = {
    identity: async () => "r@p.iam.gserviceaccount.com",
    async runReport(_p, body) {
      if (body.dimensions.length === 4 && slow) await new Promise((r) => setTimeout(r, slow));
      const { startDate, endDate } = body.dateRanges[0];
      if (body.orderBys) return { rows: [{ dimensionValues: [{ value: (body.orderBys[0].desc ? endDate : startDate).replace(/-/g, "") }] }] };
      return { rowCount: 1, rows: [{ dimensionValues: [{ value: endDate.replace(/-/g, "") }, { value: "Direct" }, { value: "mobile" }, { value: "(direct)" }].slice(0, body.dimensions.length), metricValues: body.metrics.map(() => ({ value: "5" })) }], metadata: { currencyCode: "TRY" } };
    },
  };
  const test1 = await callAction("test_ga4", { property_id: "123456789", auth: { kind: "key_file", path: key } }, ctxFor(ws));
  await callAction("connect_ga4", { test_id: test1.test_id, history_days: 2 }, ctxFor(ws));
  // A long sync is running (the daily one, say) when the person connects again.
  slow = 300;
  const running = callAction("sync_sources", { history_days: 2 }, ctxFor(ws));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ws.syncing.size, 1);
  const test2 = await callAction("test_ga4", { property_id: "123456789", auth: { kind: "key_file", path: key } }, ctxFor(ws));
  const t0 = Date.now();
  const state = await callAction("connect_ga4", { test_id: test2.test_id, history_days: 3 }, ctxFor(ws));
  await running;
  assert.ok(Date.now() - t0 >= 250, "the connect waited for the running sync");
  assert.deepEqual([state.status, state.last_sync.ok, state.last_sync.days, state.error], ["connected", true, 3, null]);
});
