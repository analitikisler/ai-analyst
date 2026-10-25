// The connectors as one thing: their states for the app (AppState.connectors), the sync that fetches daily aggregates
// from each connected source into the landing rows and rebuilds the local warehouse, the switch to the local source,
// and the ai cloud waitlist. One sync at a time per app. A failed fetch stores nothing for that source.
import { AppError } from "../errors.js";
import { addDays } from "../format.js";
import { updateConfigFile } from "../settings.js";
import { ACT, SOURCE_LABEL, T } from "../text.js";
import { todayIn, validTimeZone } from "./attribution.js";
import { fetchGa4Days, ga4Transport, propertyId } from "./ga4.js";
import { buildLocalWarehouse, dropLanding, LANDING, replaceLanding } from "./local.js";
import { fetchShopifyDays, shopifyClient, shopifyInfo } from "./shopify.js";
import { fetchWooDays, shopUrl, wooClient, wooSite } from "./woocommerce.js";

export const CONNECTOR_IDS = ["ga4", "orders_file", "shopify", "woocommerce"];
export const NAME = {
  ga4: T("Google Analytics 4", "Google Analytics 4"),
  orders_file: T("Orders file", "Sipariş dosyası"),
  shopify: T("Shopify", "Shopify"),
  woocommerce: T("WooCommerce", "WooCommerce"),
};
export const TABLE_OF = { ga4: "ga4", orders_file: "orders", shopify: "orders", woocommerce: "orders" };
export const HISTORY_DEFAULT = 90;
export const HISTORY_MAX = 400;
const DAY_MS = 86_400_000;

export const stateOf = (store, id) => store.getMeta(`connector:${id}`) ?? {};
export function setState(store, id, patch) {
  const next = { ...stateOf(store, id), ...patch };
  store.setMeta(`connector:${id}`, next);
  return next;
}

const hint = (v) => (v && v.length >= 8 ? `…${v.slice(-4)}` : v ? "…" : undefined);
const secretView = (...picks) => {
  const set = picks.every((p) => p.value);
  const env = picks.find((p) => p.source === "env");
  return { set, source: set ? (env ? "env" : "saved") : null, locked: Boolean(env), ...(env ? { env: env.env } : {}), ...(set && picks[0].source !== "env" ? { hint: hint(picks[0].value) } : {}) };
};

/** Whether a connector has its settings (and, for the shops, its secrets). */
export function isConnected(config, store, id) {
  const c = config.connectors;
  if (id === "ga4") return Boolean(propertyId(c.ga4.property.value));
  if (id === "shopify") return Boolean(c.shopify.shop.value && c.shopify.token.value);
  if (id === "woocommerce") return Boolean(c.woocommerce.url.value && c.woocommerce.key.value && c.woocommerce.secret.value);
  return Boolean(stateOf(store, "orders_file").last_sync);
}

/**
 * The mart columns the active source can fill: on your shop's data, those of the connected sources (GA4: sessions,
 * GA4 purchases and revenue; an orders source: orders and revenue; never ad spend or platform conversions). Null on
 * the demo and BigQuery, which fill every column.
 */
export function availableColumns(app) {
  if (app.config.warehouse !== "local") return null;
  const cols = new Set();
  for (const id of CONNECTOR_IDS) if (isConnected(app.config, app.store, id)) for (const c of LANDING[TABLE_OF[id]]) cols.add(c);
  return cols;
}
/**
 * Which columns the active source can split by device and by channel: on your shop's data, the columns of the
 * landing rows that carry a device (or a channel) other than "unknown". Null on the demo and BigQuery.
 */
export function availableSplits(app) {
  if (app.config.warehouse !== "local") return null;
  const out = { device: new Set(), channel: new Set() };
  for (const r of app.store.list("landing", { limit: 10_000_000 })) {
    const cols = LANDING[r.table] ?? [];
    if (r.device !== "unknown") for (const c of cols) out.device.add(c);
    if (r.channel !== "unknown") for (const c of cols) out.channel.add(c);
  }
  return out;
}
/** Whether a metric can be answered split by a dimension (day, week, month and none always can). */
export function splitAnswerable(app, metricId, by, splits = availableSplits(app)) {
  if (!splits || !["device", "channel"].includes(by)) return true;
  const m = app.pack.metrics[metricId];
  return Boolean(m) && columnsOf(m).every((c) => splits[by].has(c));
}
const columnsOf = (m) => (m ? (m.sum ? [m.sum] : [m.ratio.numerator, m.ratio.denominator]) : []);
/** Whether the active source can answer a metric (every column it reads is filled). */
export function metricAnswerable(app, metricId, cols = availableColumns(app)) {
  const m = app.pack.metrics[metricId];
  return Boolean(m) && (!cols || columnsOf(m).every((c) => cols.has(c)));
}
/** Whether the active source can run a check (both its sides are answerable). */
export function checkAnswerable(app, checkId, cols = availableColumns(app)) {
  const c = app.pack.checks[checkId];
  return Boolean(c) && metricAnswerable(app, c.expected.metric, cols) && metricAnswerable(app, c.measured.metric, cols);
}

/** AppState.connectors: one state per connector. */
export function connectorStates(app) {
  const { config, store } = app;
  const c = config.connectors;
  return CONNECTOR_IDS.map((id) => {
    const s = stateOf(store, id);
    const connected = isConnected(config, store, id);
    const target = id === "ga4" ? (propertyId(c.ga4.property.value) ? `properties/${propertyId(c.ga4.property.value)}` : null) : id === "shopify" ? c.shopify.shop.value : id === "woocommerce" ? c.woocommerce.url.value : s.target ?? null;
    const status = app.syncing?.has?.(id) ? "syncing" : !connected ? "not_connected" : s.error ? "error" : "connected";
    return {
      id,
      name: NAME[id],
      fills: LANDING[TABLE_OF[id]],
      status,
      target: connected ? target : null,
      last_sync: connected ? s.last_sync ?? null : null,
      error: connected ? s.error ?? null : null,
      warnings: connected ? s.warnings ?? [] : [],
      secret: id === "shopify" ? secretView(c.shopify.token) : id === "woocommerce" ? secretView(c.woocommerce.key, c.woocommerce.secret) : null,
    };
  });
}

/**
 * The states as a viewer from another machine sees them (a token holder through /api/state): no shop domain, GA4
 * property or file name, and errors by code only, since their messages and params name the host.
 */
export const remoteStates = (app) =>
  connectorStates(app).map((s) => ({ ...s, target: null, error: s.error ? { code: s.error.code, message: "The last sync failed. Settings › Sources on this machine has the details." } : null }));

const WAITLIST = [
  ["meta_ads", "Meta Ads"],
  ["google_ads", "Google Ads"],
  ["tiktok_ads", "TikTok Ads"],
  ["ikas", "ikas"],
  ["ticimax", "Ticimax"],
  ["search_console", "Search Console"],
  ["gtm", "Google Tag Manager"],
];
/** AppState.waitlist: the connectors planned for ai cloud, each a mailto. No network call. */
export const waitlist = () => WAITLIST.map(([id, name]) => ({ id, name: T(name, name), mailto: `mailto:hello@analitikisler.com?subject=${encodeURIComponent(`ai cloud waitlist: ${name}`)}` }));

const errorBody = (err) => ({ code: err.code ?? "internal", message: err instanceof AppError ? err.message : "The sync failed. The log has the details.", ...(err.params ? { params: err.params } : {}) });

export const clampHistory = (n) => Math.min(HISTORY_MAX, Math.max(1, Math.round(Number(n) || HISTORY_DEFAULT)));

const mismatch = (service, found, currency) =>
  new AppError("currency_mismatch", `${service} reports money in ${found}, and this workspace writes money in ${currency}. Change the currency in Settings first, or connect a source in ${currency}.`, { params: { currency, found } });

/**
 * Fetches one connected source's daily aggregates for its history, ending yesterday in its time zone.
 * @returns {Promise<{ table: string, from: string, to: string, rows: object[], warnings: object[], timeZone: string }>}
 */
export async function fetchConnector(app, id, { historyDays, now = new Date() } = {}) {
  const c = app.config.connectors;
  const s = stateOf(app.store, id);
  const days = clampHistory(historyDays ?? s.history_days);
  const range = (tz) => {
    const to = addDays(todayIn(tz, now), -1);
    return { from: addDays(to, -(days - 1)), to };
  };
  if (id === "ga4") {
    const property = propertyId(c.ga4.property.value);
    if (!property) throw new AppError("connector_not_connected", "Google Analytics 4 is not connected.");
    const transport = await ga4Transport(app, c.ga4.auth);
    const tz = validTimeZone(s.time_zone) ?? "Europe/Istanbul";
    const { from, to } = range(tz);
    const r = await fetchGa4Days(transport, property, from, to);
    if (r.currency && r.currency !== app.config.currency) throw mismatch("This GA4 property", r.currency, app.config.currency);
    return { table: "ga4", from, to, rows: r.rows, warnings: r.warnings, timeZone: tz };
  }
  if (id === "shopify") {
    if (!c.shopify.shop.value || !c.shopify.token.value) throw new AppError("connector_not_connected", "Shopify is not connected.");
    const client = shopifyClient(app, c.shopify.shop.value, c.shopify.token.value);
    const info = await shopifyInfo(client);
    if (info.currency && info.currency !== app.config.currency) throw mismatch("This Shopify shop", info.currency, app.config.currency);
    const tz = validTimeZone(info.timeZone) ?? "Europe/Istanbul";
    const { from, to } = range(tz);
    const r = await fetchShopifyDays(client, { from, to, timeZone: tz });
    return { table: "orders", from, to, rows: r.rows, warnings: [T("Shopify does not record the device of an order, so the tracking checks run on totals.", "Shopify siparişin cihazını kaydetmez; ölçüm kontrolleri toplamlar üzerinden çalışır.")], timeZone: tz };
  }
  if (id === "woocommerce") {
    const base = shopUrl(c.woocommerce.url.value);
    if (!base || !c.woocommerce.key.value || !c.woocommerce.secret.value) throw new AppError("connector_not_connected", "WooCommerce is not connected.");
    const client = wooClient(app, base, c.woocommerce.key.value, c.woocommerce.secret.value);
    const site = await wooSite(app, base);
    const tz = validTimeZone(site.timeZone) ?? "Europe/Istanbul";
    const { from, to } = range(tz);
    const r = await fetchWooDays(client, { from, to, timeZone: tz });
    if (r.currency && r.currency !== app.config.currency) throw mismatch("This WooCommerce shop", r.currency, app.config.currency);
    return { table: "orders", from, to, rows: r.rows, warnings: [], timeZone: tz };
  }
  throw new AppError("invalid_input", "The orders file is imported again, not synced.");
}

/**
 * The line a connect or import result carries when the data landed but the app still reads another source: from
 * BigQuery, or a source the environment fixes (AI_ANALYST_WAREHOUSE), the person switches by hand. Null otherwise.
 */
export function switchNote(config) {
  if (config.warehouse === "local") return null;
  if (config.warehouseSetting?.locked) {
    const env = config.warehouseSetting.env ?? "AI_ANALYST_WAREHOUSE";
    return T(
      `Your shop's data is ready, but ${env} in the environment fixes the data source, so the app still reads it. Set ${env}=local (or remove it) and restart to use your shop's data.`,
      `Mağazanın verisi hazır, ancak ortamdaki ${env} veri kaynağını sabitliyor; uygulama hâlâ onu okuyor. Mağazanın verisine geçmek için ${env}=local yapılmalı (ya da değişken kaldırılmalı) ve uygulama yeniden başlatılmalı.`,
    );
  }
  if (config.warehouse === "bigquery") {
    return T(
      "Your shop's data is ready. The app still reads your BigQuery data, which is never replaced on its own: switch to Your shop's data in Settings › Sources when you want it.",
      "Mağazanın verisi hazır. Uygulama hâlâ BigQuery verisini okuyor; bu kaynak kendiliğinden değiştirilmez. Mağazanın kendi verisine geçiş Ayarlar › Kaynaklar bölümünden yapılır.",
    );
  }
  return null;
}

/** A connect or import result: the connector's state, with the switch note when the app did not switch. */
export function resultState(app, id) {
  const s = connectorStates(app).find((x) => x.id === id);
  const note = s?.last_sync?.ok ? switchNote(app.config) : null;
  return note ? { ...s, warnings: [...s.warnings, note] } : s;
}

/** Makes the local warehouse the active source when the app is on the demo; reopens it when it already is. */
export async function activateLocal(app, { log } = {}) {
  await buildLocalWarehouse(app.config, app.store);
  if (app.config.warehouse === "local") return app.reloadWarehouse?.();
  // Only from the demo, and only when the environment does not fix the source: own BigQuery data is never replaced.
  if (app.config.warehouse !== "duckdb" || app.config.warehouseSetting.locked) return;
  const next = updateConfigFile(app.config, (file) => (file.warehouse = "local"));
  await app.applyConfig(next);
  log?.(ACT.data_source(SOURCE_LABEL.local));
}

/**
 * Syncs one connector or every connected one (not the file), then rebuilds the local warehouse once.
 * @returns {Promise<object[]>} the connector states
 */
export async function syncSources(app, { connector, historyDays, log, wait = false } = {}) {
  // wait: a connect that meets a running sync (the daily one, say) waits for it, then syncs, instead of answering
  // "connected" with nothing fetched.
  while (wait && app.syncing?.size && app.syncIdle) await app.syncIdle.catch(() => {});
  const ids = connector ? [connector] : CONNECTOR_IDS.filter((id) => id !== "orders_file" && isConnected(app.config, app.store, id));
  if (connector === "orders_file") throw new AppError("invalid_input", "The orders file is imported again, not synced. Choose the file again in Settings › Sources.");
  for (const id of ids) if (!isConnected(app.config, app.store, id)) throw new AppError("connector_not_connected", `${NAME[id].en} is not connected.`, { params: { connector: id } });
  app.syncing ??= new Set();
  if (app.syncing.size) throw new AppError("sync_running", "A sync is running. Wait for it to finish.");
  for (const id of ids) app.syncing.add(id);
  let release;
  app.syncIdle = new Promise((r) => (release = r));
  let stored = 0;
  try {
    for (const id of ids) {
      const at = new Date().toISOString();
      const days = clampHistory(historyDays ?? stateOf(app.store, id).history_days);
      try {
        const r = await fetchConnector(app, id, { historyDays: days });
        replaceLanding(app.store, { table: r.table, source: id, from: r.from, to: r.to, rows: r.rows });
        setState(app.store, id, { history_days: days, time_zone: r.timeZone, error: null, warnings: r.warnings, last_sync: { at, from: r.from, to: r.to, days, ok: true } });
        stored++;
      } catch (err) {
        if (!(err instanceof AppError)) console.error("[ai-analyst] sync:", err?.stack ?? String(err));
        const prev = stateOf(app.store, id).last_sync;
        setState(app.store, id, { error: errorBody(err), last_sync: prev ? { ...prev, at, ok: false } : { at, from: null, to: null, days: 0, ok: false } });
        if (connector) throw err;
      } finally {
        app.syncing.delete(id);
      }
    }
    if (stored) await activateLocal(app, { log });
  } finally {
    for (const id of ids) app.syncing.delete(id);
    release();
  }
  return connectorStates(app);
}

/** Removes a connector's settings, secrets, state and landing rows, then rebuilds the local warehouse. */
export async function disconnect(app, id, { writeSettings }) {
  await writeSettings(id);
  dropLanding(app.store, id);
  app.store.setMeta(`connector:${id}`, null);
  await buildLocalWarehouse(app.config, app.store);
  if (app.config.warehouse === "local") await app.reloadWarehouse?.();
}

/**
 * While serve runs: syncs the connected sources once a day (checked every hour, and once a minute after start).
 * @returns {{ stop: () => void }}
 */
export function startDailySync(app, { every = 60 * 60 * 1000, first = 60 * 1000 } = {}) {
  const due = () => CONNECTOR_IDS.filter((id) => id !== "orders_file" && isConnected(app.config, app.store, id)).some((id) => {
    const last = stateOf(app.store, id).last_sync?.at;
    return !last || Date.now() - Date.parse(last) > DAY_MS - 5 * 60 * 1000;
  });
  const tick = async () => {
    if (!due() || app.syncing?.size) return;
    try {
      await syncSources(app, { log: (detail) => app.store.logActivity({ actor: "system", action: "sync_sources", detail }) });
      app.store.logActivity({ actor: "system", action: "sync_sources", detail: { en: "Synced the connected sources", tr: "Bağlı kaynaklar eşitlendi" } });
    } catch (err) {
      console.error("[ai-analyst] daily sync:", err?.code ?? err?.message);
    }
  };
  const t1 = setTimeout(tick, first);
  const t2 = setInterval(tick, every);
  t1.unref?.();
  t2.unref?.();
  return { stop: () => (clearTimeout(t1), clearInterval(t2)), tick };
}
