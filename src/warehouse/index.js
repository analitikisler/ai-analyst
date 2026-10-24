// Picks the warehouse from config. Both expose the same small surface. Results are cached by SQL text for a
// few minutes, so a dashboard that asks for the same aggregate twice (a tile and the check strip) reads once;
// the cache dies with the warehouse, so switching the data source or rebuilding the demo starts clean.
import { existsSync } from "node:fs";
import path from "node:path";
import { buildDemoWarehouse } from "../demo/seed.js";
import { openBigQuery } from "./bigquery.js";
import { openDuckDB } from "./duckdb.js";

/**
 * @typedef {object} Warehouse
 * @property {"duckdb"|"bigquery"} dialect
 * @property {string} table the mart, as it is written in SQL
 * @property {boolean} demo
 * @property {(sql: string) => Promise<object[]>} query
 * @property {(sql: string, o?: { timeoutMs?: number }) => Promise<{ rows: object[], columns: string[], bytes: number }>} explore
 * @property {() => Promise<{ from: string, to: string, rows: number }>} range
 * @property {() => string|null} refreshedAt
 * @property {() => void} close
 * @property {{ hits: number, misses: number }} [stats]
 */

export const demoFile = (config) => path.join(config.dataDir, "demo.duckdb");

/** Wraps a warehouse with a small result cache keyed by the SQL text. */
export function withCache(wh, { ttlMs = 5 * 60 * 1000, max = 500 } = {}) {
  const cache = new Map();
  const stats = { hits: 0, misses: 0 };
  return {
    ...wh,
    stats,
    async query(sql) {
      const hit = cache.get(sql);
      if (hit && Date.now() - hit.at < ttlMs) {
        stats.hits++;
        return structuredClone(hit.rows);
      }
      stats.misses++;
      const rows = await wh.query(sql);
      if (cache.size >= max) cache.delete(cache.keys().next().value);
      cache.set(sql, { at: Date.now(), rows });
      return structuredClone(rows);
    },
    clearCache: () => cache.clear(),
  };
}

/** @returns {Promise<{ warehouse: Warehouse, seeded: boolean }>} seeded: the demo mart was built just now. */
export async function openWarehouse(config, { seedIfMissing = false, bigQueryClient } = {}) {
  if (config.warehouse === "bigquery") return { warehouse: withCache(await openBigQuery(config.bigquery, { client: bigQueryClient })), seeded: false };
  const file = demoFile(config);
  let seeded = false;
  if (!existsSync(file) && seedIfMissing) {
    await buildDemoWarehouse(file);
    seeded = true;
  }
  return { warehouse: withCache(await openDuckDB(file)), seeded };
}
