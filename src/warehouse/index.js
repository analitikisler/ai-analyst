// Picks the warehouse from config. Both expose the same small surface.
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
 * @property {() => Promise<{ from: string, to: string, rows: number }>} range
 * @property {() => string|null} refreshedAt
 * @property {() => void} close
 */

export const demoFile = (config) => path.join(config.dataDir, "demo.duckdb");

/** @returns {Promise<{ warehouse: Warehouse, seeded: boolean }>} seeded: the demo mart was built just now. */
export async function openWarehouse(config, { seedIfMissing = false } = {}) {
  if (config.warehouse === "bigquery") return { warehouse: await openBigQuery(config.bigquery), seeded: false };
  const file = demoFile(config);
  let seeded = false;
  if (!existsSync(file) && seedIfMissing) {
    await buildDemoWarehouse(file);
    seeded = true;
  }
  return { warehouse: await openDuckDB(file), seeded };
}
