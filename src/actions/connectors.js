// Sources: GA4, Shopify, WooCommerce and the orders file, feeding the local source (<data_dir>/warehouse.duckdb).
// Every action here is a person's, from this machine only (settings: true), and never a chat app's or the model's.
// Testing reaches the outside service only when the person presses Test; tests stub every call.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { AppError } from "../errors.js";
import { ACT, SOURCE_LABEL } from "../text.js";
import { addDays } from "../format.js";
import { assertUnlocked, updateConfigFile, writeConnectorSecret } from "../settings.js";
import { newId } from "../store/store.js";
import { todayIn } from "../connectors/attribution.js";
import { fetchGa4Days, ga4Error, ga4Range, ga4Transport, propertyId } from "../connectors/ga4.js";
import { activateLocal, clampHistory, connectorStates, disconnect, NAME, resultState, setState, stateOf, syncSources } from "../connectors/index.js";
import { replaceLanding } from "../connectors/local.js";
import { fetchShopifyDays, shopDomain, shopifyClient, shopifyInfo, shopifyRange } from "../connectors/shopify.js";
import { dropUpload, previewUpload, uploadAggregates } from "../connectors/uploads.js";
import { fetchWooDays, shopUrl, wooCheckScope, wooClient, wooProbe, wooRange, wooSite } from "../connectors/woocommerce.js";
import { localCredentials } from "./settings.js";
import { defineAction } from "./registry.js";

const TEST_TTL_MS = 60 * 60 * 1000;
const history = z.number().int().min(1).max(400).optional();
const person = { kind: "write", settings: true, mcp: false, agent: false };
const stateFor = (app, id) => connectorStates(app).find((s) => s.id === id);

/** Secrets typed for a test live in memory until connect (never in the app database), for an hour at most. */
const pending = (app) => (app.pendingSecrets ??= new Map());
function remember(app, testId, values) {
  const now = Date.now();
  for (const [k, v] of pending(app)) if (now - v.at > TEST_TTL_MS) pending(app).delete(k);
  if (values) pending(app).set(testId, { ...values, at: now });
}

function finish(ctx, connector, steps, ids, values, warnings = [], secrets = null) {
  for (const id of ids.slice(steps.length)) steps.push({ id, status: "skipped" });
  const ok = steps.every((s) => s.status === "ok" || s.status === "warning");
  const test_id = newId("ct");
  ctx.store.put("connector_tests", { id: test_id, connector, ok, values, created_at: new Date().toISOString() });
  remember(ctx.app, test_id, ok ? secrets : null);
  return { test_id, connector, ok, steps, warnings };
}

const errOf = (err) => ({ code: err.code ?? "source_unavailable", params: Object.fromEntries(Object.entries(err.params ?? {}).filter(([, v]) => typeof v === "string" || typeof v === "number")) });
const rethrowCloud = (err) => {
  if (err?.code === "no_cloud") throw err;
};

function passedTest(ctx, connector, testId) {
  const t = ctx.store.get("connector_tests", testId);
  if (!t || t.connector !== connector || !t.ok || Date.now() - Date.parse(t.created_at) > TEST_TTL_MS) throw new AppError("test_required", "Test the connection first.");
  return t;
}

/** Connects, then syncs; a failed first sync leaves the source connected with its error shown. */
async function connectAndSync(ctx, id, historyDays) {
  setState(ctx.store, id, { history_days: clampHistory(historyDays), error: null });
  ctx.log({ en: `Connected ${NAME[id].en}`, tr: `${NAME[id].tr} bağlandı` });
  try {
    await syncSources(ctx.app, { connector: id, historyDays, wait: true, log: (d) => ctx.log(d, null, { action: "save_data_source" }) });
  } catch (err) {
    rethrowCloud(err);
    if (!(err instanceof AppError)) throw err;
  }
  return resultState(ctx.app, id);
}

defineAction({
  name: "list_connectors",
  description: "The sources that feed your shop's own data: GA4, the orders file, Shopify and WooCommerce, with their state.",
  kind: "read",
  settings: true,
  mcp: false,
  input: z.object({}).strict(),
  run: (ctx) => connectorStates(ctx.app),
});

// ---------------------------------------------------------------- GA4

const GA4_STEPS = ["credentials", "property", "report", "range", "flags", "quota"];
const auth = z.object({ kind: z.enum(["adc", "key_file"]), path: z.string().max(1000).nullable().optional(), impersonate: z.string().max(200).nullable().optional() }).strict();

defineAction({
  name: "test_ga4",
  description: "Tests a GA4 property in six steps: credentials, the property, a one-day report, the range of data, report flags and the quota.",
  kind: "read",
  settings: true,
  mcp: false,
  input: z.object({ property_id: z.string().trim().min(1).max(40), auth }).strict(),
  async run(ctx, input) {
    const steps = [];
    const property = propertyId(input.property_id);
    const a = { kind: input.auth.kind, path: input.auth.path?.trim() || null, impersonate: input.auth.impersonate?.trim() || null };
    const values = { property: property ?? input.property_id, auth: a };
    const done = (warnings = []) => finish(ctx, "ga4", steps, GA4_STEPS, values, warnings);
    if (a.kind === "key_file") {
      try {
        if (!a.path) throw Object.assign(new Error("path"), { kind: "read" });
        const j = JSON.parse(readFileSync(a.path, "utf8"));
        if (j.type !== "service_account") throw Object.assign(new Error("type"), { kind: "type" });
      } catch (err) {
        steps.push({ id: "credentials", status: "failed", error: { code: err.kind === "type" || err instanceof SyntaxError ? "keyfile_type" : "keyfile_read", params: { path: a.path || "–" } } });
        return done();
      }
    } else if (!localCredentials(ctx.config.env).adc_found) {
      steps.push({ id: "credentials", status: "failed", error: { code: "no_credentials", params: {} } });
      return done();
    }
    const transport = await ga4Transport(ctx.app, a);
    try {
      const identity = a.impersonate || (await transport.identity()) || localCredentials(ctx.config.env).identity || "";
      steps.push({ id: "credentials", status: "ok", detail: { identity, method: a.kind } });
    } catch (err) {
      rethrowCloud(err);
      steps.push({ id: "credentials", status: "failed", error: { code: "no_credentials", params: {} } });
      return done();
    }
    if (!property) {
      steps.push({ id: "property", status: "failed", error: { code: "property_not_found", params: { property: input.property_id.slice(0, 40) } } });
      return done();
    }
    const today = todayIn("Europe/Istanbul");
    const yesterday = addDays(today, -1);
    try {
      await transport.runReport(property, { dateRanges: [{ startDate: addDays(today, -7), endDate: yesterday }], dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }], limit: 1 });
      steps.push({ id: "property", status: "ok", detail: { property } });
    } catch (err) {
      rethrowCloud(err);
      steps.push({ id: "property", status: "failed", error: errOf(ga4Error(err)) });
      return done();
    }
    let report;
    try {
      report = await fetchGa4Days(transport, property, yesterday, yesterday);
    } catch (err) {
      rethrowCloud(err);
      steps.push({ id: "report", status: "failed", error: errOf(err) });
      return done();
    }
    if (report.currency && report.currency !== ctx.config.currency) {
      steps.push({ id: "report", status: "failed", error: { code: "currency_mismatch", params: { currency: ctx.config.currency, found: report.currency } } });
      return done();
    }
    steps.push({ id: "report", status: "ok", detail: { date: yesterday, sessions: report.rows.reduce((s, r) => s + r.sessions, 0) } });
    try {
      const r = await ga4Range(transport, property, today);
      steps.push({ id: "range", status: "ok", detail: { from: r.from ?? "–", to: r.to ?? "–" } });
    } catch (err) {
      rethrowCloud(err);
      steps.push({ id: "range", status: "failed", error: errOf(err) });
      return done();
    }
    steps.push(report.warnings.length ? { id: "flags", status: "warning", detail: { n: report.warnings.length } } : { id: "flags", status: "ok" });
    steps.push({ id: "quota", status: "ok", ...(report.quota != null ? { detail: { left: report.quota } } : {}) });
    return done(report.warnings);
  },
});

defineAction({
  name: "connect_ga4",
  description: "Connects a GA4 property that passed its test, and syncs its history (90 days by default).",
  ...person,
  input: z.object({ test_id: z.string().min(1).max(64), history_days: history }).strict(),
  async run(ctx, { test_id, history_days }) {
    const t = passedTest(ctx, "ga4", test_id);
    const c = ctx.config.connectors.ga4;
    if (c.property.locked && propertyId(c.property.value) !== t.values.property) assertUnlocked(true, "AI_ANALYST_GA4_PROPERTY");
    const next = updateConfigFile(ctx.config, (file) => {
      file.connectors ??= {};
      file.connectors.ga4 = { propertyId: t.values.property, auth: t.values.auth };
    });
    await ctx.app.applyConfig(next);
    return connectAndSync(ctx, "ga4", history_days);
  },
});

// ---------------------------------------------------------------- Shopify and WooCommerce

const SHOP_STEPS = ["reach", "scope", "orders", "range"];
const reachFailure = (err) => ["shop_unreachable", "host_not_allowed"].includes(err?.code);

defineAction({
  name: "test_shopify",
  description: "Tests a Shopify shop in four steps: reaching it, the token's scopes (read only), one day of orders and the range of orders.",
  kind: "read",
  settings: true,
  mcp: false,
  input: z.object({ shop: z.string().trim().min(1).max(200), token: z.string().trim().min(1).max(200).optional() }).strict(),
  async run(ctx, input) {
    const steps = [];
    const shop = shopDomain(input.shop);
    const saved = ctx.config.connectors.shopify;
    // A saved token is only ever sent to the saved shop.
    const token = input.token ?? (shop && shop === saved.shop.value ? saved.token.value : null);
    const values = { shop: shop ?? input.shop.slice(0, 200) };
    const done = () => finish(ctx, "shopify", steps, SHOP_STEPS, values, [], input.token ? { token: input.token } : null);
    if (!shop) {
      steps.push({ id: "reach", status: "failed", error: { code: "host_not_allowed", params: { host: input.shop.slice(0, 80) } } });
      return done();
    }
    if (!token) {
      steps.push({ id: "reach", status: "skipped" });
      steps.push({ id: "scope", status: "failed", error: { code: "key_rejected", params: {} } });
      return done();
    }
    const client = shopifyClient(ctx.app, shop, token);
    let info;
    try {
      info = await shopifyInfo(client);
      steps.push({ id: "reach", status: "ok", detail: { host: shop } });
      steps.push({ id: "scope", status: "ok", detail: { scopes: info.scopes.join(", ") } });
    } catch (err) {
      rethrowCloud(err);
      if (reachFailure(err)) steps.push({ id: "reach", status: "failed", error: errOf(err) });
      else {
        steps.push({ id: "reach", status: "ok", detail: { host: shop } });
        steps.push({ id: "scope", status: "failed", error: errOf(err) });
      }
      return done();
    }
    if (info.currency && info.currency !== ctx.config.currency) {
      steps.push({ id: "orders", status: "failed", error: { code: "currency_mismatch", params: { currency: ctx.config.currency, found: info.currency } } });
      return done();
    }
    const day = addDays(todayIn(info.timeZone), -1);
    try {
      const r = await fetchShopifyDays(client, { from: day, to: day, timeZone: info.timeZone });
      steps.push({ id: "orders", status: "ok", detail: { date: day, orders: r.orders } });
      const range = await shopifyRange(client, info.timeZone);
      steps.push({ id: "range", status: "ok", detail: { from: range.from ?? "–", to: range.to ?? "–" } });
    } catch (err) {
      rethrowCloud(err);
      steps.push({ id: steps.at(-1).id === "orders" ? "range" : "orders", status: "failed", error: errOf(err) });
    }
    return done();
  },
});

defineAction({
  name: "connect_shopify",
  description: "Connects a Shopify shop that passed its test (the token goes to secrets.json), and syncs its history.",
  ...person,
  input: z.object({ test_id: z.string().min(1).max(64), history_days: history }).strict(),
  async run(ctx, { test_id, history_days }) {
    const t = passedTest(ctx, "shopify", test_id);
    const c = ctx.config.connectors.shopify;
    if (c.shop.locked && c.shop.value !== t.values.shop) assertUnlocked(true, "AI_ANALYST_SHOPIFY_SHOP");
    const secret = pending(ctx.app).get(test_id);
    if (secret?.token) assertUnlocked(c.token.locked, "AI_ANALYST_SHOPIFY_TOKEN");
    if (!secret?.token && !(c.token.value && c.shop.value === t.values.shop)) throw new AppError("test_required", "Test the connection with the access token first.");
    let next = secret?.token ? writeConnectorSecret(ctx.config, "shopify", { token: secret.token }) : ctx.config;
    next = updateConfigFile(next, (file) => {
      file.connectors ??= {};
      file.connectors.shopify = { shop: t.values.shop };
    });
    pending(ctx.app).delete(test_id);
    await ctx.app.applyConfig(next);
    return connectAndSync(ctx, "shopify", history_days);
  },
});

defineAction({
  name: "test_woocommerce",
  description: "Tests a WooCommerce shop in four steps: reaching it over HTTPS, the key's permission (read only), one day of orders and the range of orders.",
  kind: "read",
  settings: true,
  mcp: false,
  input: z.object({ url: z.string().trim().min(1).max(300), key: z.string().trim().min(1).max(200).optional(), secret: z.string().trim().min(1).max(200).optional() }).strict(),
  async run(ctx, input) {
    const steps = [];
    const base = /^http:\/\//i.test(input.url) ? null : shopUrl(input.url);
    const saved = ctx.config.connectors.woocommerce;
    const same = base && base === shopUrl(saved.url.value);
    // The saved key and secret are only ever sent to the saved address.
    const key = input.key ?? (same ? saved.key.value : null);
    const secret = input.secret ?? (same ? saved.secret.value : null);
    const values = { url: base ?? input.url.slice(0, 300) };
    const typed = input.key || input.secret ? { key, secret } : null;
    const done = () => finish(ctx, "woocommerce", steps, SHOP_STEPS, values, [], typed);
    if (!base) {
      steps.push({ id: "reach", status: "failed", error: { code: "host_not_allowed", params: { host: input.url.replace(/^\w+:\/\//, "").split("/")[0].slice(0, 80) } } });
      return done();
    }
    const host = new URL(base).hostname;
    let site;
    try {
      site = await wooSite(ctx.app, base);
      steps.push({ id: "reach", status: "ok", detail: { host, ...(site.timeZone ? { time_zone: site.timeZone } : {}) } });
    } catch (err) {
      rethrowCloud(err);
      steps.push({ id: "reach", status: "failed", error: errOf(err) });
      return done();
    }
    if (!key || !secret) {
      steps.push({ id: "scope", status: "failed", error: { code: "key_rejected", params: {} } });
      return done();
    }
    const client = wooClient(ctx.app, base, key, secret);
    const tz = site.timeZone ?? "Europe/Istanbul";
    try {
      await wooProbe(client);
      await wooCheckScope(client);
      steps.push({ id: "scope", status: "ok", detail: { scopes: "read" } });
    } catch (err) {
      rethrowCloud(err);
      steps.push({ id: "scope", status: "failed", error: errOf(err) });
      return done();
    }
    const day = addDays(todayIn(tz), -1);
    try {
      const r = await fetchWooDays(client, { from: day, to: day, timeZone: tz });
      if (r.currency && r.currency !== ctx.config.currency) {
        steps.push({ id: "orders", status: "failed", error: { code: "currency_mismatch", params: { currency: ctx.config.currency, found: r.currency } } });
        return done();
      }
      steps.push({ id: "orders", status: "ok", detail: { date: day, orders: r.orders } });
      const range = await wooRange(client, tz);
      steps.push({ id: "range", status: "ok", detail: { from: range.from ?? "–", to: range.to ?? "–" } });
    } catch (err) {
      rethrowCloud(err);
      steps.push({ id: steps.at(-1).id === "orders" ? "range" : "orders", status: "failed", error: errOf(err) });
    }
    return done();
  },
});

defineAction({
  name: "connect_woocommerce",
  description: "Connects a WooCommerce shop that passed its test (the key and secret go to secrets.json), and syncs its history.",
  ...person,
  input: z.object({ test_id: z.string().min(1).max(64), history_days: history }).strict(),
  async run(ctx, { test_id, history_days }) {
    const t = passedTest(ctx, "woocommerce", test_id);
    const c = ctx.config.connectors.woocommerce;
    if (c.url.locked && shopUrl(c.url.value) !== t.values.url) assertUnlocked(true, "AI_ANALYST_WOOCOMMERCE_URL");
    const secret = pending(ctx.app).get(test_id);
    if (secret) {
      assertUnlocked(c.key.locked, "AI_ANALYST_WOOCOMMERCE_KEY");
      assertUnlocked(c.secret.locked, "AI_ANALYST_WOOCOMMERCE_SECRET");
    }
    if (!secret && !(c.key.value && c.secret.value && shopUrl(c.url.value) === t.values.url)) throw new AppError("test_required", "Test the connection with the key and secret first.");
    let next = secret ? writeConnectorSecret(ctx.config, "woocommerce", { key: secret.key, secret: secret.secret }) : ctx.config;
    next = updateConfigFile(next, (file) => {
      file.connectors ??= {};
      file.connectors.woocommerce = { url: t.values.url };
    });
    pending(ctx.app).delete(test_id);
    await ctx.app.applyConfig(next);
    return connectAndSync(ctx, "woocommerce", history_days);
  },
});

// ---------------------------------------------------------------- the orders file

const mapping = z
  .object({
    order_id: z.string().max(200).nullable(),
    created_at: z.string().max(200),
    status: z.string().max(200).nullable(),
    total: z.string().max(200),
    currency: z.string().max(200).nullable(),
    channel: z.string().max(200).nullable(),
    utm_source: z.string().max(200).nullable(),
    utm_medium: z.string().max(200).nullable(),
    device: z.string().max(200).nullable(),
    user_agent: z.string().max(200).nullable(),
    exclude_statuses: z.array(z.string().max(200)).max(200),
  })
  .strict();
const zone = z.string().trim().min(1).max(60);

defineAction({
  name: "preview_orders_file",
  description: "The daily aggregates of an uploaded orders file under a mapping and time zone. Nothing is stored.",
  kind: "read",
  settings: true,
  mcp: false,
  input: z.object({ upload_id: z.string().min(1).max(64), mapping: mapping.optional(), time_zone: zone.optional() }).strict(),
  run: (ctx, input) => previewUpload(ctx.app, input),
});

defineAction({
  name: "import_orders_file",
  description: "Imports an uploaded orders file as daily aggregates (orders and revenue by day, channel and device), replacing the days it covers, and deletes the file.",
  ...person,
  input: z.object({ upload_id: z.string().min(1).max(64), mapping, time_zone: zone }).strict(),
  async run(ctx, input) {
    const { upload, rows, preview } = await uploadAggregates(ctx.app, input);
    replaceLanding(ctx.store, { table: "orders", source: "orders_file", from: preview.from, to: preview.to, rows });
    const days = Math.round((Date.parse(preview.to) - Date.parse(preview.from)) / 86_400_000) + 1;
    const prev = stateOf(ctx.store, "orders_file");
    const allFrom = prev.last_sync?.from && prev.last_sync.from < preview.from ? prev.last_sync.from : preview.from;
    const allTo = prev.last_sync?.to && prev.last_sync.to > preview.to ? prev.last_sync.to : preview.to;
    setState(ctx.store, "orders_file", { target: upload.file_name, time_zone: input.time_zone, error: null, warnings: preview.warnings, last_sync: { at: new Date().toISOString(), from: allFrom, to: allTo, days, ok: true } });
    dropUpload(ctx.app, upload.id);
    ctx.log({ en: `Imported the orders file ${upload.file_name}: ${preview.orders} orders, ${preview.from} to ${preview.to}`, tr: `${upload.file_name} sipariş dosyası içe aktarıldı: ${preview.orders} sipariş, ${preview.from} – ${preview.to}` });
    await activateLocal(ctx.app, { log: (d) => ctx.log(d, null, { action: "save_data_source" }) });
    return resultState(ctx.app, "orders_file");
  },
});

// ---------------------------------------------------------------- sync and disconnect

const CONNECTOR = z.enum(["ga4", "orders_file", "shopify", "woocommerce"]);

defineAction({
  name: "sync_sources",
  description: "Fetches the connected sources again for their history (or history_days) and rebuilds your shop's data. One sync at a time.",
  ...person,
  input: z.object({ connector: CONNECTOR.optional(), history_days: history }).strict(),
  async run(ctx, { connector, history_days }) {
    const states = await syncSources(ctx.app, { connector, historyDays: history_days, log: (d) => ctx.log(d, null, { action: "save_data_source" }) });
    ctx.log({ en: connector ? `Synced ${NAME[connector].en}` : "Synced the connected sources", tr: connector ? `${NAME[connector].tr} eşitlendi` : "Bağlı kaynaklar eşitlendi" });
    return states;
  },
});

const ENV_OF = {
  ga4: ["AI_ANALYST_GA4_PROPERTY"],
  shopify: ["AI_ANALYST_SHOPIFY_SHOP", "AI_ANALYST_SHOPIFY_TOKEN"],
  woocommerce: ["AI_ANALYST_WOOCOMMERCE_URL", "AI_ANALYST_WOOCOMMERCE_KEY", "AI_ANALYST_WOOCOMMERCE_SECRET"],
  orders_file: [],
};

defineAction({
  name: "disconnect_source",
  description: "Disconnects a source: removes its settings, its saved secrets and the data it brought in.",
  ...person,
  input: z.object({ connector: CONNECTOR }).strict(),
  async run(ctx, { connector }) {
    const env = ctx.config.env ?? {};
    const set = ENV_OF[connector].find((n) => env[n] !== undefined && env[n] !== "");
    if (set) assertUnlocked(true, set);
    if (ctx.app.syncing?.size) throw new AppError("sync_running", "A sync is running. Wait for it to finish.");
    await disconnect(ctx.app, connector, {
      writeSettings: async (id) => {
        if (id === "orders_file") return;
        let next = id === "ga4" ? ctx.config : writeConnectorSecret(ctx.config, id, null);
        next = updateConfigFile(next, (file) => {
          if (file.connectors) delete file.connectors[id];
        });
        await ctx.app.applyConfig(next);
      },
    });
    ctx.log({ en: `Disconnected ${NAME[connector].en} and removed its data`, tr: `${NAME[connector].tr} bağlantısı kaldırıldı ve verisi silindi` });
    const state = stateFor(ctx.app, connector);
    // The last source gone: back to the demo, unless the environment fixes the source.
    const left = connectorStates(ctx.app).some((s) => s.status !== "not_connected");
    if (left || ctx.app.config.warehouse !== "local") return state;
    if (ctx.app.config.warehouseSetting.locked) {
      const env = ctx.app.config.warehouseSetting.env ?? "AI_ANALYST_WAREHOUSE";
      return { ...state, warnings: [...state.warnings, { en: `Nothing is connected now, so your shop's data is empty. ${env} in the environment fixes the data source, so the app stays on it: connect a source, or change ${env} and restart.`, tr: `Artık bağlı kaynak yok; mağazanın verisi boş. Ortamdaki ${env} veri kaynağını sabitlediği için uygulama bu kaynakta kalıyor: yeni bir kaynak bağlanabilir ya da ${env} değiştirilip uygulama yeniden başlatılabilir.` }] };
    }
    const next = updateConfigFile(ctx.app.config, (file) => (file.warehouse = "duckdb"));
    await ctx.app.applyConfig(next);
    ctx.log(ACT.data_source(SOURCE_LABEL.demo), null, { action: "save_data_source" });
    return { ...state, warnings: [...state.warnings, { en: "Nothing is connected now, so the app switched back to the demo data. Connecting a source switches to your shop's data again.", tr: "Artık bağlı kaynak yok; uygulama demo veriye geri döndü. Bir kaynak bağlamak yeniden mağazanın verisine geçirir." }] };
  },
});
