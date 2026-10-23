// The local demo warehouse: one DuckDB file holding daily_channel_device.
import { existsSync, statSync } from "node:fs";
import { MART } from "../metrics/load.js";

/** DuckDB returns HUGEINT and DECIMAL sums as strings, DATE_TRUNC as timestamps; the app wants numbers and dates. */
export function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (["value", "numerator", "denominator"].includes(k)) out[k] = v == null ? null : Number(v);
    else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}( 00:00:00)?$/.test(v)) out[k] = v.slice(0, 10);
    else out[k] = v;
  }
  return out;
}

/**
 * @param {string} file path to the .duckdb file
 * @returns {Promise<import("./index.js").Warehouse>}
 */
export async function openDuckDB(file) {
  if (!existsSync(file)) throw new Error(`No demo warehouse at ${file}. Run: ai-analyst seed-demo`);
  const { DuckDBInstance } = await import("@duckdb/node-api");
  // Read-only, so a second process (the MCP server next to the web server) can open it too.
  const instance = await DuckDBInstance.create(file, { access_mode: "READ_ONLY" });
  const conn = await instance.connect();
  let range = null;
  const query = async (sql) => (await conn.runAndReadAll(sql)).getRowObjectsJson().map(normalizeRow);
  return {
    dialect: "duckdb",
    table: MART.model,
    demo: true,
    query,
    async range() {
      if (!range) {
        const [r] = await query(`SELECT CAST(MIN(date) AS VARCHAR) AS data_from, CAST(MAX(date) AS VARCHAR) AS data_to, COUNT(*) AS n FROM ${MART.model}`);
        range = { from: r.data_from, to: r.data_to, rows: Number(r.n) };
      }
      return range;
    },
    refreshedAt: () => statSync(file).mtime.toISOString(),
    close() {
      conn.closeSync?.();
      instance.closeSync?.();
    },
  };
}
