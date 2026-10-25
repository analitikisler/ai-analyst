// The Örnek Moda demo: an invented Turkish online fashion shop. generateFacts() is the
// prototype's generator, ported call for call (same seed, same order of rnd() calls), so
// the demo shows the same numbers as the prototype. Planted bug: from release v4.12 on
// 9 Oct 2026, GA4 captures far fewer purchases on mobile.
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { addDays, parseISO } from "../format.js";

export const DEMO = { first: "2026-07-25", last: "2026-10-22", release: "2026-10-09", seed: 20261023 };

const CHANNELS = [
  { id: "organic", share: 0.34, cr: 1.0, spend: 0 },
  { id: "direct", share: 0.18, cr: 1.3, spend: 0 },
  { id: "google_ads", share: 0.2, cr: 1.15, spend: 21000 },
  { id: "meta_ads", share: 0.16, cr: 0.75, spend: 17500 },
  { id: "tiktok_ads", share: 0.05, cr: 0.5, spend: 6200 },
  { id: "email", share: 0.07, cr: 1.6, spend: 0 },
];
const DEVICES = [
  { id: "mobile", share: 0.71, cr: 0.0135, aov: 1.0 },
  { id: "desktop", share: 0.29, cr: 0.021, aov: 1.12 },
];

/** mulberry32, exactly as the prototype writes it. */
function prng(start) {
  let seed = start;
  return function rnd() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** One row per date × channel × device, in the mart's column names. */
export function generateFacts({ first = DEMO.first, last = DEMO.last, release = DEMO.release, seed = DEMO.seed } = {}) {
  const rnd = prng(seed);
  const noise = (a) => 1 + (rnd() * 2 - 1) * a;
  const DOW = [1.12, 0.95, 0.93, 0.94, 0.98, 1.06, 1.18]; // Sun..Sat
  const rows = [];
  for (let i = 0, d = first; d <= last; i++, d = addDays(d, 1)) {
    const dow = parseISO(d).getUTCDay();
    const promo = d >= "2026-10-10" && d <= "2026-10-13" ? 1.38 : d >= "2026-09-05" && d <= "2026-09-07" ? 1.2 : 1;
    const total = 8200 * (1 + 0.0022 * i) * DOW[dow] * promo * noise(0.05);
    for (const c of CHANNELS) {
      const chSessions = total * c.share * (c.id === "meta_ads" || c.id === "tiktok_ads" ? (promo > 1 ? 1.25 : 1) : 1) * noise(0.08);
      for (const v of DEVICES) {
        const sessions = Math.round(chSessions * v.share * noise(0.04));
        const orders = Math.round(sessions * v.cr * c.cr * (promo > 1 ? 1.12 : 1) * noise(0.12));
        const revenue = Math.round(orders * 1480 * v.aov * (promo > 1 ? 0.9 : 1) * noise(0.07));
        const cap = v.id === "mobile" ? (d >= release ? 0.842 : 0.973) : 0.976;
        const ga4Purchases = Math.round(orders * cap * noise(0.015));
        const ga4Revenue = Math.round(revenue * cap * noise(0.02));
        let conversions = 0;
        let spend = 0;
        if (c.spend) {
          spend = Math.round(c.spend * v.share * (promo > 1 ? 1.35 : 1) * noise(0.1));
          const over = c.id === "google_ads" ? 1.035 : c.id === "meta_ads" ? 1.37 : 1.62;
          conversions = Math.round(orders * over * noise(0.05));
        }
        rows.push({
          date: d,
          channel: c.id,
          device: v.id,
          sessions,
          orders,
          revenue,
          ga4_purchases: ga4Purchases,
          ga4_revenue: ga4Revenue,
          platform_conversions: conversions,
          ad_spend: spend,
        });
      }
    }
  }
  return rows;
}

const COLUMNS = ["date", "channel", "device", "sessions", "orders", "revenue", "ga4_purchases", "ga4_revenue", "platform_conversions", "ad_spend"];

// ---------------------------------------------------------------- the demo shop's own tables

/** Categories: how many products, a price band in TRY, how often a line comes back, and the mobile lean. */
const CATEGORIES = [
  { id: "dresses", n: 20, price: [890, 2490], ret: 0.19, mobile: 1.15, names: ["Linen midi dress", "Wrap dress", "Shirt dress", "Knit dress", "Slip dress"] },
  { id: "tops", n: 22, price: [290, 990], ret: 0.08, mobile: 1.2, names: ["Cotton T-shirt", "Ribbed top", "Poplin blouse", "Tank top", "Oversized tee"] },
  { id: "trousers", n: 16, price: [690, 1790], ret: 0.13, mobile: 0.95, names: ["Wide-leg trousers", "Straight jeans", "Cargo trousers", "Pleated trousers"] },
  { id: "knitwear", n: 14, price: [790, 1990], ret: 0.07, mobile: 0.9, names: ["Merino jumper", "Cardigan", "Cable knit", "Knit vest"] },
  { id: "outerwear", n: 12, price: [1690, 4990], ret: 0.11, mobile: 0.75, names: ["Trench coat", "Denim jacket", "Puffer jacket", "Wool coat"] },
  { id: "shoes", n: 16, price: [990, 3290], ret: 0.22, mobile: 0.85, names: ["Leather loafers", "Trainers", "Ankle boots", "Sandals"] },
  { id: "bags", n: 10, price: [590, 2690], ret: 0.05, mobile: 1.0, names: ["Tote bag", "Crossbody bag", "Shoulder bag", "Backpack"] },
  { id: "accessories", n: 10, price: [190, 790], ret: 0.03, mobile: 1.25, names: ["Silk scarf", "Leather belt", "Sunglasses", "Hair clip set"] },
];
const RETURN_REASONS = ["size_or_fit", "not_as_pictured", "damaged", "changed_mind", "late_delivery"];
const COLOURS = ["black", "ecru", "navy", "sand", "olive", "rust", "grey", "white"];

/** The product catalogue: about 120 invented products. */
export function generateProducts(seed = DEMO.seed) {
  const rnd = prng(seed + 1);
  const out = [];
  let n = 0;
  for (const c of CATEGORIES) {
    for (let i = 0; i < c.n; i++) {
      n++;
      const name = `${c.names[i % c.names.length]}, ${COLOURS[Math.floor(rnd() * COLOURS.length)]}`;
      const price = Math.round((c.price[0] + rnd() * (c.price[1] - c.price[0])) / 10) * 10 - 10 + 9.9;
      out.push({ product_id: `p_${String(n).padStart(3, "0")}`, name, category: c.id, list_price: Math.round(price * 100) / 100 });
    }
  }
  return out;
}

/** Splits a whole amount into n positive whole parts by weight; the parts sum to the amount exactly. */
function split(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.max(1, Math.floor((total * w) / sum)));
  let rest = total - parts.reduce((a, b) => a + b, 0);
  for (let i = parts.length - 1; rest !== 0 && i >= 0; i = i === 0 ? parts.length - 1 : i - 1) {
    if (rest > 0) {
      parts[i] += rest;
      rest = 0;
    } else if (parts[i] > 1) {
      const take = Math.min(parts[i] - 1, -rest);
      parts[i] -= take;
      rest += take;
    }
  }
  return parts;
}

/**
 * The shop behind the mart: orders, order lines and returns, generated from the mart's own rows (same seed), so
 * COUNT(orders) and SUM(order_total) by day, channel and device are the mart's orders and revenue exactly, and the
 * order lines add up to the orders. Customers are invented ids only: no names, no contact data.
 */
export function generateShop(facts = generateFacts(), { seed = DEMO.seed, last = DEMO.last } = {}) {
  const rnd = prng(seed + 2);
  const products = generateProducts(seed);
  const byCat = Object.fromEntries(CATEGORIES.map((c) => [c.id, products.filter((p) => p.category === c.id)]));
  const orders = [];
  const items = [];
  const returns = [];
  const seen = new Set();
  let customers = 0;
  for (const f of facts) {
    if (!f.orders) continue;
    const amounts = split(Math.round(f.revenue), Array.from({ length: f.orders }, () => 0.4 + rnd() * 1.2));
    for (const total of amounts) {
      const order_id = `o_${String(orders.length + 1).padStart(6, "0")}`;
      // About a third of orders come from returning customers.
      let customer;
      if (customers > 0 && rnd() < 0.34) customer = 1 + Math.floor(Math.pow(rnd(), 1.6) * customers);
      else customer = ++customers;
      const customer_id = `c_${String(customer).padStart(6, "0")}`;
      const first = !seen.has(customer_id);
      seen.add(customer_id);
      const k = Math.min(1 + (rnd() < 0.45 ? 1 : 0) + (rnd() < 0.15 ? 1 : 0), total);
      const lines = [];
      for (let l = 0; l < k; l++) {
        const weights = CATEGORIES.map((c) => c.n * (f.device === "mobile" ? c.mobile : 2 - c.mobile));
        let r = rnd() * weights.reduce((a, b) => a + b, 0);
        let ci = 0;
        while (r > weights[ci] && ci < weights.length - 1) r -= weights[ci++];
        const cat = CATEGORIES[ci];
        const p = byCat[cat.id][Math.floor(rnd() * byCat[cat.id].length)];
        lines.push({ p, cat, quantity: rnd() < 0.1 ? 2 : 1 });
      }
      const parts = split(total, lines.map((x) => x.p.list_price * x.quantity));
      lines.forEach((x, i) => {
        items.push({ order_id, line_no: i + 1, product_id: x.p.product_id, quantity: x.quantity, line_total: parts[i] });
        if (rnd() < x.cat.ret * (f.device === "mobile" ? 1.1 : 0.9)) {
          const date = addDays(f.date, 3 + Math.floor(rnd() * 18));
          const reason = RETURN_REASONS[x.cat.id === "shoes" || x.cat.id === "dresses" || x.cat.id === "trousers" ? (rnd() < 0.6 ? 0 : 1 + Math.floor(rnd() * 4)) : Math.floor(rnd() * RETURN_REASONS.length)];
          if (date <= last) returns.push({ return_id: `r_${String(returns.length + 1).padStart(5, "0")}`, order_id, line_no: i + 1, product_id: x.p.product_id, return_date: date, reason, refund_amount: parts[i] });
        }
      });
      orders.push({ order_id, order_date: f.date, channel: f.channel, device: f.device, customer_id, is_first_order: first, items: k, order_total: total });
    }
  }
  return { products, orders, order_items: items, returns };
}

const SHOP_DDL = {
  products: "product_id VARCHAR NOT NULL, name VARCHAR NOT NULL, category VARCHAR NOT NULL, list_price DECIMAL(18, 2) NOT NULL",
  orders: "order_id VARCHAR NOT NULL, order_date DATE NOT NULL, channel VARCHAR NOT NULL, device VARCHAR NOT NULL, customer_id VARCHAR NOT NULL, is_first_order BOOLEAN NOT NULL, items INTEGER NOT NULL, order_total DECIMAL(18, 2) NOT NULL",
  order_items: "order_id VARCHAR NOT NULL, line_no INTEGER NOT NULL, product_id VARCHAR NOT NULL, quantity INTEGER NOT NULL, line_total DECIMAL(18, 2) NOT NULL",
  returns: "return_id VARCHAR NOT NULL, order_id VARCHAR NOT NULL, line_no INTEGER NOT NULL, product_id VARCHAR NOT NULL, return_date DATE NOT NULL, reason VARCHAR NOT NULL, refund_amount DECIMAL(18, 2) NOT NULL",
};

/** Writes the demo mart and the shop tables to a fresh DuckDB file. Returns the mart's row count. */
export async function buildDemoWarehouse(file, rows = generateFacts()) {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  for (const f of [file, `${file}.wal`]) if (existsSync(f)) rmSync(f);
  const instance = await DuckDBInstance.create(file);
  const conn = await instance.connect();
  try {
    await conn.run(`CREATE TABLE daily_channel_device (
      date DATE NOT NULL, channel VARCHAR NOT NULL, device VARCHAR NOT NULL,
      sessions INTEGER NOT NULL, orders INTEGER NOT NULL, revenue DECIMAL(18, 2) NOT NULL,
      ga4_purchases INTEGER NOT NULL, ga4_revenue DECIMAL(18, 2) NOT NULL,
      platform_conversions INTEGER NOT NULL, ad_spend DECIMAL(18, 2) NOT NULL)`);
    // Every value is a generated number or a fixed id, so plain literals are safe here.
    for (let i = 0; i < rows.length; i += 500) {
      const values = rows
        .slice(i, i + 500)
        .map((r) => `(DATE '${r.date}', '${r.channel}', '${r.device}', ${COLUMNS.slice(3).map((c) => Number(r[c])).join(", ")})`)
        .join(",\n");
      await conn.run(`INSERT INTO daily_channel_device (${COLUMNS.join(", ")}) VALUES ${values}`);
    }
    const shop = generateShop(rows);
    const lit = (v) => (typeof v === "number" ? String(v) : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : `'${String(v).replace(/'/g, "''")}'`);
    for (const [table, ddl] of Object.entries(SHOP_DDL)) {
      await conn.run(`CREATE TABLE ${table} (${ddl})`);
      const list = shop[table];
      for (let i = 0; i < list.length; i += 1000) {
        const values = list.slice(i, i + 1000).map((r) => `(${Object.values(r).map(lit).join(", ")})`).join(",\n");
        await conn.run(`INSERT INTO ${table} VALUES ${values}`);
      }
    }
    await conn.run("CHECKPOINT");
  } finally {
    conn.closeSync?.();
    instance.closeSync?.();
  }
  chmodSync(file, 0o600);
  return rows.length;
}

/** Findings from AI Tag Debugger audits of the demo shop, linked to the checks they explain. */
export const DEMO_FINDINGS = [
  {
    id: "f_ga4_mobile_safari",
    source: "AI Tag Debugger",
    since: DEMO.release,
    release: "v4.12",
    checks: ["ga4_vs_orders", "ga4_rev_vs_revenue"],
    text: {
      en: "purchase is not sent on mobile Safari since release v4.12 (9 Oct): the thank-you page loads the tag before dataLayer is ready.",
      tr: "v4.12 sürümünden (9 Ekim) beri mobil Safari’de purchase gitmiyor: teşekkür sayfası tag’i dataLayer hazır olmadan yüklüyor.",
    },
  },
  {
    id: "f_meta_view_through",
    source: "AI Tag Debugger",
    since: null,
    release: null,
    checks: ["meta_vs_orders"],
    text: {
      en: "Meta counts view-through purchases (1-day view) that the back office attributes to other channels.",
      tr: "Meta, sipariş panelinin başka kanallara atadığı görüntüleme sonrası satın almaları da sayıyor (1 günlük görüntüleme).",
    },
  },
];

export function seedFindings(store) {
  for (const f of DEMO_FINDINGS) store.saveFinding(f);
}
