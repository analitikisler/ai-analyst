// WooCommerce through the REST API v3, with a consumer key and secret that have Read permission, over HTTPS only.
// Orders are fetched with _fields limited to id, status, created time, total, shipping, currency and meta_data, so no
// names, emails, addresses or phone numbers are requested. The REST API cannot pick meta entries by key, so it sends
// every meta entry of each order (plugins may keep personal data there: a tax id, a phone, the visitor's user agent).
// Each order is reduced on arrival to the fields above plus four attribution values (_wc_order_attribution_
// utm_source, utm_medium, source_type and device_type); the rest of its meta is dropped there, never kept, logged or
// passed on. Stored as daily aggregates only.
// Never-placed orders (failed, draft, trash) are left out; cancelled and refunded count, as in Orders v3.
import { AppError } from "../errors.js";
import { channelFrom, dateIn, deviceFrom } from "./attribution.js";
import { checkUrl, connectorFetch, jsonOf } from "./net.js";

const SKIP = new Set(["failed", "trash", "checkout-draft", "auto-draft"]);
const FIELDS = "id,status,date_created_gmt,total,shipping_total,currency,meta_data";

/** "shop.example" or "https://shop.example/" → "https://shop.example"; null when it is not an https address. */
export function shopUrl(v) {
  let s = String(v ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = checkUrl(s, () => true);
    return `https://${u.host}${u.pathname.replace(/\/+$/, "").replace(/\/wp-json.*$/, "")}`;
  } catch {
    return null;
  }
}

export function wooClient(app, base, key, secret) {
  const host = new URL(base).hostname.toLowerCase();
  const call = connectorFetch(app, { service: "WooCommerce", hosts: [host] });
  const auth = `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
  return async (path, { method = "GET", body } = {}) => {
    const res = await call(`${base}/wp-json/wc/v3${path}`, { method, headers: { Authorization: auth, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return res;
  };
}

const fail = async (res) => {
  if (res.status === 401) throw new AppError("key_rejected", "WooCommerce did not accept the key and secret. Check them in WooCommerce › Settings › Advanced › REST API.", { params: { status: 401 } });
  if (res.status === 404) throw new AppError("shop_unreachable", "This address has no WooCommerce REST API (wp-json/wc/v3). Check the address and that permalinks are on.", { params: { status: 404 } });
  if (res.status === 429) throw new AppError("rate_limited", "The shop is limiting requests. The sync stopped and stored nothing; it tries again later.", { params: { status: 429 } });
  throw new AppError("shop_unreachable", `The shop answered ${res.status}.`, { params: { status: res.status } });
};

/**
 * Refuses a key that can write. An empty batch changes nothing: a read-only key is refused there (401 or 403); a key
 * that is accepted can write, so it is refused here.
 */
export async function wooCheckScope(client) {
  const res = await client("/orders/batch", { method: "POST", body: {} });
  if (res.ok) throw new AppError("scope_write", "This key has Write permission. Create a key with Read permission only, and use it.", { params: { permission: "write" } });
  // Only WordPress's own clear "not allowed" counts as read only: 401 or 403 with a REST error code. A security
  // plugin's or a firewall's page, a 400 or a 500 says nothing about the key, so the check fails closed.
  const body = res.status === 401 || res.status === 403 ? await jsonOf(res) : null;
  if (typeof body?.code === "string" && /^(woocommerce_rest_|rest_)/.test(body.code)) return "read";
  throw new AppError("scope_unchecked", `The shop did not answer the permission check clearly (it answered ${res.status}), so the key's permission is unknown. Make sure the key has Read permission only, and that no security plugin blocks the REST API, then test again.`, { params: { status: res.status } });
}

const ATTRIBUTION = {
  _wc_order_attribution_utm_source: "source",
  _wc_order_attribution_utm_medium: "medium",
  _wc_order_attribution_source_type: "sourceType",
  _wc_order_attribution_device_type: "device",
};
const short = (v) => (typeof v === "string" ? v.slice(0, 200) : v == null ? null : String(v).slice(0, 200));

/**
 * An order as the app keeps it in memory while it counts: the plain fields and the four attribution values. Every
 * other meta entry is dropped here. The raw order's meta_data is removed too, so nothing holds it after this call.
 */
export function slimOrder(o) {
  const a = { source: null, medium: null, sourceType: null, device: null };
  if (Array.isArray(o?.meta_data)) for (const m of o.meta_data) if (m && Object.hasOwn(ATTRIBUTION, m.key)) a[ATTRIBUTION[m.key]] = short(m.value);
  if (o && typeof o === "object") delete o.meta_data;
  return { status: short(o?.status), date_created_gmt: short(o?.date_created_gmt), total: short(o?.total), shipping_total: short(o?.shipping_total), currency: short(o?.currency), ...a };
}

/**
 * Daily aggregates for [from, to] in the given time zone, all pages.
 * @returns {Promise<{ rows, currency: string|null, orders: number }>}
 */
export async function fetchWooDays(client, { from, to, timeZone, maxPages = 500 }) {
  const byKey = new Map();
  let currency = null;
  let n = 0;
  // GMT bounds a day wider than [from, to], so no order near midnight is lost; the day filter keeps [from, to].
  const after = `${from}T00:00:00`;
  const before = `${to}T23:59:59`;
  for (let page = 1; page <= maxPages; page++) {
    const res = await client(`/orders?per_page=100&page=${page}&after=${encodeURIComponent(after)}&before=${encodeURIComponent(before)}&dates_are_gmt=false&orderby=date&order=asc&_fields=${FIELDS}`);
    if (!res.ok) await fail(res);
    const list = (await jsonOf(res)) ?? [];
    if (!Array.isArray(list)) throw new AppError("shop_unreachable", "The shop sent something other than a list of orders.");
    const count = list.length;
    // Each order is reduced on arrival; the raw list (with every meta entry) is let go here.
    const orders = list.map(slimOrder);
    list.length = 0;
    for (const o of orders) {
      if (SKIP.has(String(o.status))) continue;
      const date = dateIn(o.date_created_gmt ? `${o.date_created_gmt}Z` : null, timeZone);
      if (!date || date < from || date > to) continue;
      const total = Number(o.total);
      if (!Number.isFinite(total)) continue;
      currency ??= o.currency ?? null;
      const channel = channelFrom({ source: o.source, medium: o.medium, sourceType: o.sourceType });
      const device = deviceFrom({ device: o.device });
      const key = `${date}|${channel}|${device}`;
      const acc = byKey.get(key) ?? { date, channel, device, orders: 0, revenue: 0 };
      acc.orders += 1;
      acc.revenue += total - (Number(o.shipping_total) || 0);
      byKey.set(key, acc);
      n++;
    }
    const pages = Number(res.headers?.get?.("x-wp-totalpages") ?? 0);
    if (count < 100 || (pages && page >= pages)) break;
  }
  return { rows: [...byKey.values()], currency, orders: n };
}

/** Reads one order to see the key works; returns only how many came back (nothing of the order). */
export async function wooProbe(client) {
  const res = await client("/orders?per_page=1&_fields=id");
  if (!res.ok) await fail(res);
  const list = await jsonOf(res);
  return Array.isArray(list) ? list.length : 0;
}

/** The site's time zone from the WordPress REST index (no key needed); null when it does not say. */
export async function wooSite(app, base) {
  const host = new URL(base).hostname.toLowerCase();
  const res = await connectorFetch(app, { service: "WooCommerce", hosts: [host] })(`${base}/wp-json/`, { headers: { Accept: "application/json" } });
  if (res.status === 404) throw new AppError("shop_unreachable", "This address has no WordPress REST API (wp-json). Check the address.", { params: { host, status: 404 } });
  if (!res.ok && res.status !== 401) throw new AppError("shop_unreachable", `The shop answered ${res.status}.`, { params: { host, status: res.status } });
  const body = res.ok ? await jsonOf(res) : null;
  const tz = typeof body?.timezone_string === "string" && body.timezone_string ? body.timezone_string : null;
  return { timeZone: tz, name: typeof body?.name === "string" ? body.name.slice(0, 120) : null };
}

/** The first and last day with an order, in the given time zone. */
export async function wooRange(client, timeZone) {
  const one = async (order) => {
    const res = await client(`/orders?per_page=1&orderby=date&order=${order}&_fields=date_created_gmt`);
    if (!res.ok) await fail(res);
    const list = (await jsonOf(res)) ?? [];
    return Array.isArray(list) && list[0]?.date_created_gmt ? dateIn(`${list[0].date_created_gmt}Z`, timeZone) : null;
  };
  return { from: await one("asc"), to: await one("desc") };
}
