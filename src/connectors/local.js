// The local source: <data_dir>/warehouse.duckdb, fed by the connectors. Connectors hand over daily aggregates
// only; they are kept in the app database (table landing) and, after every sync or import, written into a fresh
// DuckDB file with the landing tables and daily_channel_device built from them, which replaces the old file in one
// rename. Readers (this server, the MCP server) never see a half-written file.
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { addDays } from "../format.js";
import { MART } from "../metrics/load.js";

export const localFile = (config) => path.join(config.dataDir, "warehouse.duckdb");

/** Which mart columns each landing table fills. */
export const LANDING = {
  ga4: ["sessions", "ga4_purchases", "ga4_revenue"],
  orders: ["orders", "revenue"],
};
const CHANNELS = new Set(MART.dimensions.channel);
const DEVICES = new Set(MART.dimensions.device);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Replaces one source's aggregates for the days it covered: rows outside [from, to] stay, rows inside are replaced.
 * @param {object} store
 * @param {{ table: "ga4"|"orders", source: string, from: string, to: string, rows: { date, channel, device, ...values }[] }} batch
 */
export function replaceLanding(store, { table, source, from, to, rows }) {
  const cols = LANDING[table];
  const clean = [];
  for (const r of rows) {
    if (!ISO.test(r.date) || r.date < from || r.date > to) continue;
    const channel = CHANNELS.has(r.channel) ? r.channel : "unknown";
    const device = DEVICES.has(r.device) ? r.device : "unknown";
    clean.push({ date: r.date, channel, device, ...Object.fromEntries(cols.map((c) => [c, Number.isFinite(Number(r[c])) ? Number(r[c]) : 0])) });
  }
  // Sum rows that land on the same key (two GA4 groups mapped to "other", say).
  const byKey = new Map();
  for (const r of clean) {
    const id = `${table}|${source}|${r.date}|${r.channel}|${r.device}`;
    const acc = byKey.get(id) ?? { id, table, source, date: r.date, channel: r.channel, device: r.device, ...Object.fromEntries(cols.map((c) => [c, 0])) };
    for (const c of cols) acc[c] += r[c];
    byKey.set(id, acc);
  }
  store.transaction(() => {
    store.db.prepare("DELETE FROM landing WHERE source = ? AND json_extract(body, '$.table') = ? AND json_extract(body, '$.date') BETWEEN ? AND ?").run(source, table, from, to);
    for (const r of byKey.values()) store.put("landing", r, { source });
    // The days this source covered, so a day with no orders reads 0, not "no data".
    const days = new Set(store.getMeta(`landing_days:${table}:${source}`) ?? []);
    for (let d = from; d <= to; d = addDays(d, 1)) days.add(d);
    store.setMeta(`landing_days:${table}:${source}`, [...days].sort());
  });
  return byKey.size;
}

/** Removes everything one source stored. */
export function dropLanding(store, source) {
  store.db.prepare("DELETE FROM landing WHERE source = ?").run(source);
  for (const t of Object.keys(LANDING)) store.setMeta(`landing_days:${t}:${source}`, []);
}

export const landingSources = (store) => store.db.prepare("SELECT DISTINCT source FROM landing").all().map((r) => r.source);

/**
 * Writes warehouse.duckdb from the landing rows: landing_ga4, landing_orders, landing_days and the mart. Columns no
 * connector fills stay NULL (ad spend, platform conversions); a measure is 0 on a day its source covered and NULL on
 * a day it did not.
 * @param {object} config
 * @param {object|null} store the app database; null writes an empty mart
 * @returns {Promise<{ file: string, rows: number }>}
 */
export async function buildLocalWarehouse(config, store) {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const file = localFile(config);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  for (const f of [tmp, `${tmp}.wal`]) if (existsSync(f)) rmSync(f);
  // Without a store (no app database yet), an empty mart: the source opens and says it has no data.
  const rows = store ? store.list("landing", { order: "ASC", limit: 10_000_000 }) : [];
  const days = [];
  for (const t of Object.keys(LANDING)) {
    for (const r of store ? store.db.prepare("SELECT id, body FROM meta WHERE id LIKE ?").all(`landing_days:${t}:%`) : []) {
      const source = r.id.split(":").slice(2).join(":");
      for (const d of JSON.parse(r.body).value ?? []) days.push([t, source, d]);
    }
  }
  const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const instance = await DuckDBInstance.create(tmp, { enable_external_access: "false" });
  const conn = await instance.connect();
  let n = 0;
  try {
    await conn.run("CREATE TABLE landing_ga4 (source VARCHAR, date DATE, channel VARCHAR, device VARCHAR, sessions BIGINT, ga4_purchases BIGINT, ga4_revenue DECIMAL(18, 2))");
    await conn.run("CREATE TABLE landing_orders (source VARCHAR, date DATE, channel VARCHAR, device VARCHAR, orders BIGINT, revenue DECIMAL(18, 2))");
    await conn.run("CREATE TABLE landing_days (landing VARCHAR, source VARCHAR, date DATE)");
    const insert = async (table, cols, list) => {
      for (let i = 0; i < list.length; i += 500) {
        const values = list.slice(i, i + 500).map((r) => `(${cols.map((c) => (c === "date" ? `DATE ${lit(r[c])}` : typeof r[c] === "number" ? String(r[c]) : lit(r[c]))).join(", ")})`).join(",\n");
        await conn.run(`INSERT INTO ${table} (${cols.join(", ")}) VALUES ${values}`);
      }
    };
    await insert("landing_ga4", ["source", "date", "channel", "device", ...LANDING.ga4], rows.filter((r) => r.table === "ga4"));
    await insert("landing_orders", ["source", "date", "channel", "device", ...LANDING.orders], rows.filter((r) => r.table === "orders"));
    await insert("landing_days", ["landing", "source", "date"], days.map(([landing, source, date]) => ({ landing, source, date })));
    // The mart: one row per date x channel x device that any source holds. A measure is the sum over its sources on
    // a day one of them covered (0 when none had a row), and NULL on a day none covered.
    await conn.run(`CREATE TABLE ${MART.model} AS
      WITH g AS (SELECT date, channel, device, SUM(sessions) AS sessions, SUM(ga4_purchases) AS ga4_purchases, SUM(ga4_revenue) AS ga4_revenue FROM landing_ga4 GROUP BY date, channel, device),
      o AS (SELECT date, channel, device, SUM(orders) AS orders, SUM(revenue) AS revenue FROM landing_orders GROUP BY date, channel, device),
      gd AS (SELECT DISTINCT date FROM landing_days WHERE landing = 'ga4'),
      od AS (SELECT DISTINCT date FROM landing_days WHERE landing = 'orders'),
      k AS (SELECT date, channel, device FROM g UNION SELECT date, channel, device FROM o)
      SELECT k.date, k.channel, k.device,
        CASE WHEN k.date IN (SELECT date FROM gd) THEN COALESCE(g.sessions, 0) END AS sessions,
        CASE WHEN k.date IN (SELECT date FROM od) THEN COALESCE(o.orders, 0) END AS orders,
        CASE WHEN k.date IN (SELECT date FROM od) THEN COALESCE(o.revenue, 0) END AS revenue,
        CASE WHEN k.date IN (SELECT date FROM gd) THEN COALESCE(g.ga4_purchases, 0) END AS ga4_purchases,
        CASE WHEN k.date IN (SELECT date FROM gd) THEN COALESCE(g.ga4_revenue, 0) END AS ga4_revenue,
        CAST(NULL AS BIGINT) AS platform_conversions,
        CAST(NULL AS DECIMAL(18, 2)) AS ad_spend
      FROM k
      LEFT JOIN g ON g.date = k.date AND g.channel = k.channel AND g.device = k.device
      LEFT JOIN o ON o.date = k.date AND o.channel = k.channel AND o.device = k.device
      ORDER BY k.date, k.channel, k.device`);
    n = Number((await conn.runAndReadAll(`SELECT COUNT(*) AS n FROM ${MART.model}`)).getRowObjectsJson()[0].n);
    await conn.run("CHECKPOINT");
  } finally {
    conn.closeSync?.();
    instance.closeSync?.();
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  if (existsSync(`${tmp}.wal`)) rmSync(`${tmp}.wal`);
  return { file, rows: n };
}
