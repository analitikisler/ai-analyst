// Shopify through the Admin GraphQL API, with a custom app's Admin API access token (read_orders), on the shop's
// own *.myshopify.com domain. Per order only: created time, the test flag, the total, shipping and currency, and the
// last visit's source and UTM (customerJourneySummary). No names, emails, addresses or phone numbers are requested.
// Stored as daily aggregates only. Test orders are left out; cancelled orders count, as in the Orders metric (v3).
import { AppError } from "../errors.js";
import { channelFrom, dateIn } from "./attribution.js";
import { connectorFetch, jsonOf } from "./net.js";

export const SHOPIFY_API_VERSION = "2025-07";
const SHOP = /^[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com$/;

/** "ornek" or "https://ornek.myshopify.com/admin" → "ornek.myshopify.com"; null when it is not a myshopify domain. */
export function shopDomain(v) {
  let s = String(v ?? "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (/^[a-z0-9][a-z0-9-]{0,59}$/.test(s)) s = `${s}.myshopify.com`;
  return SHOP.test(s) ? s : null;
}

const ORDERS = `query Orders($cursor: String, $q: String) {
  orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt
      test
      totalPriceSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount } }
      customerJourneySummary { lastVisit { source utmParameters { source medium } } }
    }
  }
}`;
const SHOP_INFO = `query { shop { ianaTimezone currencyCode } currentAppInstallation { accessScopes { handle } } }`;

export function shopifyClient(app, shop, token) {
  const call = connectorFetch(app, { service: "Shopify", hosts: [shop] });
  return async (query, variables = {}) => {
    const res = await call(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query, variables }) });
    if (res.status === 401 || res.status === 403) throw new AppError("key_rejected", "Shopify did not accept the access token. Check it in the custom app's API credentials.", { params: { status: res.status } });
    if (res.status === 404) throw new AppError("shop_unreachable", `No Shopify shop answers at ${shop}.`, { params: { host: shop } });
    if (res.status === 429) throw new AppError("rate_limited", "Shopify is limiting requests. The sync stopped and stored nothing; it tries again later.", { params: { status: 429 } });
    if (!res.ok) throw new AppError("shop_unreachable", `Shopify answered ${res.status}.`, { params: { host: shop, status: res.status } });
    const body = await jsonOf(res);
    if (body?.errors?.some?.((e) => e?.extensions?.code === "THROTTLED")) throw new AppError("rate_limited", "Shopify is limiting requests. The sync stopped and stored nothing; it tries again later.", { params: { status: 429 } });
    if (body?.errors?.length) throw new AppError("shop_unreachable", "Shopify refused the query.", { params: { host: shop } });
    return body?.data ?? {};
  };
}

/** The scopes a token may hold: what the connector needs, and a few read-only scopes with no personal data. */
export const ALLOWED_SCOPES = new Set(["read_orders", "read_all_orders", "read_products", "read_analytics", "read_reports", "read_locations"]);
// Scopes that read people: customers and their contact data, staff, carts and checkouts, gift cards, payments.
const PERSONAL = /customer|users|checkouts|draft_orders|gift_cards|fulfillments|shipping|returns|payment|marketing_events|order_edits|own_subscription|purchase_options|merchant_managed_fulfillment|assigned_fulfillment|third_party_fulfillment/;

/** The shop's time zone and currency, and the token's scopes; a write scope or a scope beyond the allowlist is refused. */
export async function shopifyInfo(client) {
  const d = await client(SHOP_INFO);
  const scopes = (d.currentAppInstallation?.accessScopes ?? []).map((s) => String(s.handle));
  const write = scopes.filter((s) => s.startsWith("write_") || s.startsWith("unauthenticated_write_"));
  if (write.length) throw new AppError("scope_write", `This token can change the shop (${write.join(", ")}). Create a custom app with read_orders only, and use its token.`, { params: { scopes: write.join(", ") } });
  const extra = scopes.filter((s) => !ALLOWED_SCOPES.has(s));
  if (extra.length) {
    const personal = extra.filter((s) => PERSONAL.test(s));
    const why = personal.length ? `${personal.join(", ")} can read customers' personal data, which this app never needs` : `${extra.join(", ")} ${extra.length === 1 ? "is" : "are"} more than this app needs`;
    throw new AppError("scope_extra", `This token has more access than reading orders: ${why}. Give the custom app read_orders only (read_all_orders for a longer history), and use its new token.`, { params: { scopes: extra.join(", "), personal: personal.join(", ") } });
  }
  if (!scopes.includes("read_orders") && !scopes.includes("read_all_orders")) throw new AppError("key_rejected", "This token cannot read orders. Give the custom app the read_orders scope.", { params: { scopes: scopes.join(", ") || "none" } });
  return { timeZone: d.shop?.ianaTimezone || "Europe/Istanbul", currency: d.shop?.currencyCode ?? null, scopes };
}

/**
 * Daily aggregates for [from, to] in the shop's time zone, all pages.
 * @returns {Promise<{ rows, currency: string|null, orders: number }>}
 */
export async function fetchShopifyDays(client, { from, to, timeZone, maxPages = 400 }) {
  const byKey = new Map();
  let cursor = null;
  let currency = null;
  let n = 0;
  // Shopify reads these dates in the shop's time zone; the day filter below keeps [from, to] in that zone too.
  const q = `created_at:>=${from} created_at:<=${to}T23:59:59 status:any`;
  for (let page = 0; page < maxPages; page++) {
    const d = await client(ORDERS, { cursor, q });
    const conn = d.orders ?? { nodes: [], pageInfo: {} };
    for (const o of conn.nodes ?? []) {
      if (o.test) continue;
      const date = dateIn(o.createdAt, timeZone);
      if (!date || date < from || date > to) continue;
      const total = Number(o.totalPriceSet?.shopMoney?.amount);
      if (!Number.isFinite(total)) continue;
      const shipping = Number(o.totalShippingPriceSet?.shopMoney?.amount) || 0;
      currency ??= o.totalPriceSet?.shopMoney?.currencyCode ?? null;
      const v = o.customerJourneySummary?.lastVisit;
      const channel = v ? channelFrom({ source: v.utmParameters?.source ?? v.source, medium: v.utmParameters?.medium }) : "unknown";
      const key = `${date}|${channel}`;
      const acc = byKey.get(key) ?? { date, channel, device: "unknown", orders: 0, revenue: 0 };
      acc.orders += 1;
      acc.revenue += total - shipping;
      byKey.set(key, acc);
      n++;
    }
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return { rows: [...byKey.values()], currency, orders: n };
}

const RANGE = `query { first: orders(first: 1, sortKey: CREATED_AT, query: "status:any") { nodes { createdAt } } last: orders(first: 1, sortKey: CREATED_AT, reverse: true, query: "status:any") { nodes { createdAt } } }`;

/** The first and last day with an order, in the shop's time zone. */
export async function shopifyRange(client, timeZone) {
  const d = await client(RANGE);
  return { from: dateIn(d.first?.nodes?.[0]?.createdAt, timeZone), to: dateIn(d.last?.nodes?.[0]?.createdAt, timeZone) };
}
