// Connectors in the fixtures build (CONNECTORS.md): GA4, the orders file, Shopify and WooCommerce, simulated so the
// demo shows every flow. Nothing is called: the tests are scripted on what was typed, a sync only stamps the range,
// and the figures stay the demo mart's. The orders file is read in the browser (CSV; an XLSX is answered with the
// sample file's rows) and only its daily totals are kept, as on the server.
import type { Channel, ConnectorId, ConnectorState, ConnectorTest, ConnStep, Device, OrdersMapping, OrdersPreview, OrdersUpload, Text, WaitlistItem } from "../types";
import { ApiError } from "../client";
import { newId, RANGE } from "./engine";
import { T } from "./text";

export interface ConnRecord {
  status: "not_connected" | "connected" | "error";
  target: string | null;
  last_sync: ConnectorState["last_sync"];
  error: ConnectorState["error"];
  history_days: number;
}
export type ConnDb = Record<ConnectorId, ConnRecord>;

export const IDS: ConnectorId[] = ["ga4", "orders_file", "shopify", "woocommerce"];
const NAME: Record<ConnectorId, Text> = {
  ga4: T("Google Analytics 4", "Google Analytics 4"),
  orders_file: T("Orders file", "Sipariş dosyası"),
  shopify: T("Shopify", "Shopify"),
  woocommerce: T("WooCommerce", "WooCommerce"),
};
const FILLS: Record<ConnectorId, ConnectorState["fills"]> = {
  ga4: ["sessions", "ga4_purchases", "ga4_revenue"],
  orders_file: ["orders", "revenue"],
  shopify: ["orders", "revenue"],
  woocommerce: ["orders", "revenue"],
};

export const seedConnectors = (): ConnDb => Object.fromEntries(IDS.map((id) => [id, { status: "not_connected", target: null, last_sync: null, error: null, history_days: 90 }])) as ConnDb;

const SIMULATED = T("Simulated in this demo: nothing was fetched, the figures stay the demo’s.", "Bu demoda canlandırma: hiçbir şey çekilmedi, rakamlar demonun rakamları olarak kalır.");

export function connectorStates(c: ConnDb): ConnectorState[] {
  return IDS.map((id) => {
    const r = c[id];
    return { id, name: NAME[id], fills: FILLS[id], status: r.status, target: r.target, last_sync: r.last_sync, error: r.error, warnings: r.status === "connected" ? [SIMULATED] : [], secret: id === "shopify" || id === "woocommerce" ? (r.status === "connected" ? { set: true, source: "saved", locked: false, hint: "…a1f3" } : { set: false, source: null, locked: false }) : null };
  });
}

const WAITLIST: [WaitlistItem["id"], string][] = [
  ["meta_ads", "Meta Ads"],
  ["google_ads", "Google Ads"],
  ["tiktok_ads", "TikTok Ads"],
  ["ikas", "ikas"],
  ["ticimax", "Ticimax"],
  ["search_console", "Search Console"],
  ["gtm", "Google Tag Manager"],
];
export const waitlist = (): WaitlistItem[] =>
  WAITLIST.map(([id, name]) => ({ id, name: T(name, name), mailto: `mailto:hello@analitikisler.com?subject=${encodeURIComponent(`ai cloud waitlist: ${name}`)}` }));

// ---------------------------------------------------------------- tests (scripted on the input)

const tests: Record<string, { connector: ConnectorId; ok: boolean; target: string }> = {};

function finish(connector: ConnectorId, target: string, steps: ConnStep[], ids: string[], warnings: Text[] = []): ConnectorTest {
  const failed = steps.findIndex((s) => s.status === "failed");
  for (const id of ids.slice(steps.length)) steps.push({ id, status: "skipped" });
  const ok = failed < 0;
  const test_id = newId("ct");
  tests[test_id] = { connector, ok, target };
  return { test_id, connector, ok, steps, warnings };
}

const GA4_STEPS = ["credentials", "property", "report", "range", "flags", "quota"];
export function testGa4(input: { property_id: string; auth: { kind: "adc" | "key_file"; path?: string | null; impersonate?: string | null } }): ConnectorTest {
  const id = input.property_id.trim().replace(/^properties\//, "");
  const steps: ConnStep[] = [];
  if (input.auth.kind === "key_file" && !(input.auth.path ?? "").trim()) {
    steps.push({ id: "credentials", status: "failed", error: { code: "keyfile_read", params: { path: "–" } } });
    return finish("ga4", id, steps, GA4_STEPS);
  }
  steps.push({ id: "credentials", status: "ok", detail: { identity: input.auth.impersonate || "analyst@ornekmoda.example", method: input.auth.kind } });
  if (!/^\d{6,12}$/.test(id)) {
    steps.push({ id: "property", status: "failed", error: { code: "property_not_found", params: { property: id || "–" } } });
    return finish("ga4", id, steps, GA4_STEPS);
  }
  steps.push({ id: "property", status: "ok", detail: { property: id, name: "Örnek Moda · GA4" } });
  steps.push({ id: "report", status: "ok", detail: { date: RANGE.to, sessions: 2873 } });
  steps.push({ id: "range", status: "ok", detail: { from: RANGE.from, to: RANGE.to } });
  // A property id ending in 0 shows the thresholding warning, so the demo can show that state too.
  const flagged = id.endsWith("0");
  steps.push(flagged ? { id: "flags", status: "warning", detail: { flag: "thresholding" } } : { id: "flags", status: "ok" });
  steps.push({ id: "quota", status: "ok", detail: { left: 24_850, per_day: 25_000 } });
  return finish("ga4", id, steps, GA4_STEPS, flagged ? [T("GA4 applied thresholding to this report: small rows can be withheld, so totals may be a little low.", "GA4 bu rapora eşik uyguladı: küçük satırlar gizlenebilir, toplamlar biraz düşük olabilir.")] : []);
}

const SHOP_STEPS = ["reach", "scope", "orders", "range"];
export function testShopify(input: { shop: string; token?: string }): ConnectorTest {
  const shop = input.shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const steps: ConnStep[] = [];
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    steps.push({ id: "reach", status: "failed", error: { code: "host_not_allowed", params: { host: shop || "–" } } });
    return finish("shopify", shop, steps, SHOP_STEPS);
  }
  steps.push({ id: "reach", status: "ok", detail: { host: shop } });
  const token = (input.token ?? "").trim();
  if (!token.startsWith("shpat_")) {
    steps.push({ id: "scope", status: "failed", error: { code: "key_rejected", params: {} } });
    return finish("shopify", shop, steps, SHOP_STEPS);
  }
  if (token.includes("write")) {
    steps.push({ id: "scope", status: "failed", error: { code: "scope_write", params: { scope: "write_orders" } } });
    return finish("shopify", shop, steps, SHOP_STEPS);
  }
  steps.push({ id: "scope", status: "ok", detail: { scopes: "read_orders" } });
  steps.push({ id: "orders", status: "ok", detail: { date: RANGE.to, orders: 186 } });
  steps.push({ id: "range", status: "ok", detail: { from: RANGE.from, to: RANGE.to } });
  return finish("shopify", shop, steps, SHOP_STEPS);
}

export function testWoo(input: { url: string; key?: string; secret?: string }): ConnectorTest {
  const url = input.url.trim().replace(/\/+$/, "");
  const steps: ConnStep[] = [];
  const host = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^https:\/\/[^/]+\.[a-z]{2,}/i.test(url) || /^(\d+\.){3}\d+$|^localhost$/i.test(host)) {
    steps.push({ id: "reach", status: "failed", error: { code: "host_not_allowed", params: { host: host || "–" } } });
    return finish("woocommerce", url, steps, SHOP_STEPS);
  }
  steps.push({ id: "reach", status: "ok", detail: { host } });
  if (!(input.key ?? "").startsWith("ck_") || !(input.secret ?? "").startsWith("cs_")) {
    steps.push({ id: "scope", status: "failed", error: { code: "key_rejected", params: {} } });
    return finish("woocommerce", url, steps, SHOP_STEPS);
  }
  steps.push({ id: "scope", status: "ok", detail: { scopes: "read" } });
  steps.push({ id: "orders", status: "ok", detail: { date: RANGE.to, orders: 186 } });
  steps.push({ id: "range", status: "ok", detail: { from: RANGE.from, to: RANGE.to } });
  return finish("woocommerce", url, steps, SHOP_STEPS);
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Connects a tested connector and stamps a sync over its history. */
export function connect(c: ConnDb, connector: ConnectorId, test_id: string, history_days = 90): ConnRecord {
  const t = tests[test_id];
  if (!t || t.connector !== connector || !t.ok) throw new ApiError("test_required", "Test the connection first.", 409);
  c[connector] = { status: "connected", target: t.target, error: null, history_days, last_sync: stamp(history_days) };
  return c[connector];
}

function stamp(days: number): ConnectorState["last_sync"] {
  const from = addDays(RANGE.to, -(Math.min(days, 400) - 1));
  return { at: new Date().toISOString(), from: from < RANGE.from ? RANGE.from : from, to: RANGE.to, days: Math.min(days, 400), ok: true };
}

export function sync(c: ConnDb, connector?: ConnectorId, history_days?: number) {
  const ids = connector ? [connector] : IDS.filter((id) => c[id].status !== "not_connected");
  for (const id of ids) {
    if (c[id].status === "not_connected") throw new ApiError("connector_not_connected", "This source is not connected.", 409);
    if (id === "orders_file") continue; // a file is imported again, not synced
    c[id].last_sync = stamp(history_days ?? c[id].history_days);
    c[id].status = "connected";
    c[id].error = null;
  }
}

// ---------------------------------------------------------------- the orders file

interface Upload { file_name: string; kind: "csv" | "xlsx"; columns: string[]; rows: string[][]; time_zone: string; mapping: OrdersMapping }
const uploads: Record<string, Upload> = {};

const norm = (s: string) =>
  s
    .toLocaleLowerCase("tr")
    .replace(/[ıi̇]/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// English, Turkish, ikas and Ticimax export headers (normalised: lower case, no diacritics, single spaces).
const HEADERS: Record<Exclude<keyof OrdersMapping, "exclude_statuses">, string[]> = {
  order_id: ["order id", "order number", "order no", "name", "id", "siparis no", "siparis numarasi", "siparis id", "siparis kodu"],
  created_at: ["created at", "created", "order date", "date", "siparis tarihi", "tarih", "olusturulma tarihi", "olusturma tarihi"],
  status: ["status", "order status", "financial status", "durum", "siparis durumu", "odeme durumu"],
  total: ["total", "order total", "grand total", "total price", "toplam", "tutar", "siparis tutari", "genel toplam", "toplam tutar"],
  currency: ["currency", "para birimi", "doviz", "kur"],
  channel: ["channel", "source", "kanal", "kaynak", "satis kanali"],
  utm_source: ["utm source", "utm kaynak"],
  utm_medium: ["utm medium", "utm ortam"],
  device: ["device", "device type", "cihaz", "cihaz turu"],
  user_agent: ["user agent", "tarayici"],
};

function guess(columns: string[], statuses: { value: string }[]): OrdersMapping {
  const n = columns.map(norm);
  const pickCol = (k: keyof typeof HEADERS) => {
    for (const h of HEADERS[k]) {
      const i = n.indexOf(h);
      if (i >= 0) return columns[i]!;
    }
    return null;
  };
  return {
    order_id: pickCol("order_id"),
    created_at: pickCol("created_at") ?? columns[0] ?? "",
    status: pickCol("status"),
    total: pickCol("total") ?? "",
    currency: pickCol("currency"),
    channel: pickCol("channel"),
    utm_source: pickCol("utm_source"),
    utm_medium: pickCol("utm_medium"),
    device: pickCol("device"),
    user_agent: pickCol("user_agent"),
    // Test orders only; cancelled orders are counted, as in the Orders metric.
    exclude_statuses: statuses.map((s) => s.value).filter((v) => /test/i.test(norm(v))),
  };
}

/** One CSV line set: comma, semicolon or tab, quotes doubled inside quoted fields. */
function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

/** A date in the chosen zone: ISO with an offset, "YYYY-MM-DD HH:mm", "DD.MM.YYYY HH:mm" or "DD/MM/YYYY". */
function dayOf(raw: string, zone: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s) && !Number.isNaN(Date.parse(s))) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s));
  }
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}

/** 1.234,56 and 1,234.56 and 1234.56 TL. */
function amountOf(raw: string): number | null {
  let s = raw.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function channelOf(raw: string | undefined, src: string | undefined, med: string | undefined): Channel {
  const v = norm([raw, src, med].filter(Boolean).join(" "));
  if (!v) return "unknown";
  if (/organic|seo|organik/.test(v)) return "organic";
  if (/google|cpc|adwords/.test(v)) return "google_ads";
  if (/meta|facebook|instagram|fb/.test(v)) return "meta_ads";
  if (/tiktok/.test(v)) return "tiktok_ads";
  if (/mail|bulten|newsletter/.test(v)) return "email";
  if (/direct|dogrudan/.test(v)) return "direct";
  return "other";
}
function deviceOf(raw: string | undefined, ua: string | undefined): Device {
  const v = norm(raw ?? "");
  if (/mobile|mobil|tablet|phone|telefon/.test(v)) return "mobile";
  if (/desktop|masaustu|bilgisayar/.test(v)) return "desktop";
  if (ua) return /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop";
  return "unknown";
}

function previewOf(u: Upload, currency: string): OrdersPreview {
  const col = (name: string | null) => (name ? u.columns.indexOf(name) : -1);
  const m = u.mapping;
  const [ci, ti, si, cu, ch, us, um, dv, ua] = [m.created_at, m.total, m.status, m.currency, m.channel, m.utm_source, m.utm_medium, m.device, m.user_agent].map(col);
  const excluded = { status: 0, no_date: 0, bad_total: 0 };
  const daily = new Map<string, { orders: number; revenue: number }>();
  const channels = new Map<Channel, number>();
  const devices = new Map<Device, number>();
  let mismatch = false;
  for (const r of u.rows) {
    if (si >= 0 && m.exclude_statuses.includes(r[si] ?? "")) {
      excluded.status++;
      continue;
    }
    const day = ci >= 0 ? dayOf(r[ci] ?? "", u.time_zone) : null;
    if (!day) {
      excluded.no_date++;
      continue;
    }
    const total = ti >= 0 ? amountOf(r[ti] ?? "") : null;
    if (total == null) {
      excluded.bad_total++;
      continue;
    }
    if (cu >= 0 && (r[cu] ?? "").trim() && (r[cu] ?? "").trim().toUpperCase() !== currency && !/^(tl|₺)$/i.test((r[cu] ?? "").trim())) mismatch = true;
    const d = daily.get(day) ?? { orders: 0, revenue: 0 };
    d.orders++;
    d.revenue += total;
    daily.set(day, d);
    const c = channelOf(ch >= 0 ? r[ch] : undefined, us >= 0 ? r[us] : undefined, um >= 0 ? r[um] : undefined);
    channels.set(c, (channels.get(c) ?? 0) + 1);
    const dev = deviceOf(dv >= 0 ? r[dv] : undefined, ua >= 0 ? r[ua] : undefined);
    devices.set(dev, (devices.get(dev) ?? 0) + 1);
  }
  if (mismatch) throw new ApiError("currency_mismatch", `The file has orders in another currency than ${currency}.`, 422, { currency });
  const days = [...daily.keys()].sort();
  const list = days.map((date) => ({ date, orders: daily.get(date)!.orders, revenue: Math.round(daily.get(date)!.revenue * 100) / 100 }));
  // As on the server: one line on cancelled orders, which the Orders metric counts.
  const warnings: Text[] = [T("Cancelled orders are counted, as in the Orders metric. Exclude them here only if GA4 does not record them.", "İptal edilen siparişler Siparişler metriğindeki gibi sayılır. Yalnızca GA4 bunları kaydetmiyorsa burada çıkarılmalı.")];
  if ([...devices.keys()].every((k) => k === "unknown") && list.length) warnings.push(T("No device column: the tracking checks run on totals, without a device split.", "Cihaz sütunu yok: ölçüm kontrolleri cihaz ayrımı olmadan toplamlar üzerinden çalışır."));
  return {
    from: days[0] ?? null,
    to: days[days.length - 1] ?? null,
    days: days.length,
    orders: list.reduce((s, d) => s + d.orders, 0),
    revenue: Math.round(list.reduce((s, d) => s + d.revenue, 0) * 100) / 100,
    currency,
    excluded,
    daily: list,
    channels: [...channels].map(([key, orders]) => ({ key, orders })).sort((a, b) => b.orders - a.orders),
    devices: [...devices].map(([key, orders]) => ({ key, orders })).sort((a, b) => b.orders - a.orders),
    warnings,
  };
}

function statusesOf(u: Pick<Upload, "columns" | "rows">, status: string | null) {
  const i = status ? u.columns.indexOf(status) : -1;
  if (i < 0) return [];
  const counts = new Map<string, number>();
  for (const r of u.rows) counts.set(r[i] ?? "", (counts.get(r[i] ?? "") ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

function view(id: string, u: Upload, currency: string): OrdersUpload {
  return { upload_id: id, file_name: u.file_name, kind: u.kind, columns: u.columns, mapping: structuredClone(u.mapping), statuses: statusesOf(u, u.mapping.status), time_zone: u.time_zone, preview: previewOf(u, currency) };
}

export const MAX_UPLOAD = 25 * 1024 * 1024;

/** Reads an upload (CSV text; an XLSX is answered with the sample's rows in the demo). */
export function upload(file_name: string, kind: "csv" | "xlsx", text: string, size: number, currency: string): OrdersUpload {
  if (size > MAX_UPLOAD) throw new ApiError("upload_too_large", "The file is over 25 MB.", 413, { max: MAX_UPLOAD });
  const table = parseCsv(kind === "xlsx" ? sampleOrdersCsv() : text);
  if (table.length < 2 || table[0]!.length < 2) throw new ApiError("file_unreadable", "No header and rows were found in the file.", 422);
  const [columns, ...rows] = table as [string[], ...string[][]];
  const base = { columns, rows };
  const mapping = guess(columns, statusesOf(base, guess(columns, []).status));
  if (!mapping.total || !mapping.created_at) throw new ApiError("mapping_invalid", "No date or total column could be found.", 422);
  const id = newId("up");
  uploads[id] = { file_name, kind, columns, rows, time_zone: "Europe/Istanbul", mapping };
  return view(id, uploads[id]!, currency);
}

export function preview(input: { upload_id: string; mapping?: OrdersMapping; time_zone?: string }, currency: string): OrdersUpload {
  const u = uploads[input.upload_id];
  if (!u) throw new ApiError("upload_not_found", "The upload is gone. Choose the file again.", 404);
  if (input.mapping) {
    for (const k of ["created_at", "total"] as const) if (!u.columns.includes(input.mapping[k])) throw new ApiError("mapping_invalid", `Choose a column for ${k}.`, 422, { field: k });
    u.mapping = structuredClone(input.mapping);
  }
  if (input.time_zone) u.time_zone = input.time_zone;
  return view(input.upload_id, u, currency);
}

/** Keeps the daily totals (the mock only stamps the range) and forgets the file. */
export function importFile(c: ConnDb, input: { upload_id: string; mapping: OrdersMapping; time_zone: string }, currency: string): OrdersPreview {
  const v = preview(input, currency);
  delete uploads[input.upload_id];
  if (!v.preview.days) throw new ApiError("mapping_invalid", "No orders are left to import with this mapping.", 422);
  c.orders_file = { status: "connected", target: v.file_name, error: null, history_days: v.preview.days, last_sync: { at: new Date().toISOString(), from: v.preview.from, to: v.preview.to, days: v.preview.days, ok: true } };
  return v.preview;
}

/** The demo's sample export (ikas-style Turkish headers): 60 days, some cancelled, a few test orders. */
export function sampleOrdersCsv(): string {
  const lines = ["Sipariş No;Sipariş Tarihi;Sipariş Durumu;Toplam Tutar;Para Birimi;Kaynak;Cihaz"];
  let seq = 10_000;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let d = 59; d >= 0; d--) {
    const day = addDays(RANGE.to, -d);
    const n = 14 + Math.round(rnd() * 10);
    for (let i = 0; i < n; i++) {
      const hour = String(8 + Math.floor(rnd() * 14)).padStart(2, "0");
      const min = String(Math.floor(rnd() * 60)).padStart(2, "0");
      const status = rnd() < 0.04 ? "İptal Edildi" : rnd() < 0.02 ? "Test Siparişi" : "Tamamlandı";
      const total = (450 + rnd() * 2600).toFixed(2).replace(".", ",");
      const source = ["google / cpc", "instagram / paid", "(direct) / (none)", "google / organic", "newsletter / email"][Math.floor(rnd() * 5)];
      const device = rnd() < 0.62 ? "Mobil" : "Masaüstü";
      lines.push(`${++seq};${day.split("-").reverse().join(".")} ${hour}:${min};${status};${total};TRY;${source};${device}`);
    }
  }
  return lines.join("\n");
}
