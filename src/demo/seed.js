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

/** Writes the demo mart to a fresh DuckDB file. Returns the row count. */
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
