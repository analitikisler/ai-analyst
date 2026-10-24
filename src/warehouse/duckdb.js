// The local demo warehouse: one DuckDB file holding daily_channel_device. It is opened read-only, with
// external access (files, URLs, extensions) switched off and the configuration locked, so no statement can
// read or write anything but this file, and SET cannot undo that. Exploratory SQL runs in a second database
// built from the mart alone (explore-mart.duckdb next to it, opened the same way), so whatever the file holds,
// a model's query cannot name any other table.
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { AppError } from "../errors.js";
import { MART } from "../metrics/load.js";

const COLUMNS = ["date", "channel", "device", "sessions", "orders", "revenue", "ga4_purchases", "ga4_revenue", "platform_conversions", "ad_spend"];

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

/** An exploratory result row: numbers as numbers, dates as dates, the rest as text. */
function normalizeAny(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}( 00:00:00)?$/.test(v)) out[k] = v.slice(0, 10);
    else if (typeof v === "string" && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(v)) out[k] = Number(v);
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
  const instance = await DuckDBInstance.create(file, { access_mode: "READ_ONLY", enable_external_access: "false", lock_configuration: "true" });
  const conn = await instance.connect();
  let range = null;
  const query = async (sql) => (await conn.runAndReadAll(sql)).getRowObjectsJson().map(normalizeRow);

  // The mart-only database for exploratory SQL, rebuilt when the demo file changes.
  const martFile = file.replace(/\.duckdb$/, "") + ".explore-mart.duckdb";
  let mart = null;
  async function martOnly() {
    const mtime = statSync(file).mtimeMs;
    if (mart?.mtime === mtime) return mart.instance;
    mart?.instance.closeSync?.();
    const rows = (await conn.runAndReadAll(`SELECT ${COLUMNS.join(", ")} FROM ${MART.model} ORDER BY date, channel, device`)).getRowObjectsJson();
    const tmp = `${martFile}.${process.pid}.tmp`;
    for (const f of [tmp, `${tmp}.wal`]) if (existsSync(f)) rmSync(f);
    const w = await DuckDBInstance.create(tmp, { enable_external_access: "false" });
    const wc = await w.connect();
    try {
      await wc.run(`CREATE TABLE ${MART.model} (date DATE, channel VARCHAR, device VARCHAR, sessions BIGINT, orders BIGINT, revenue DECIMAL(18, 2), ga4_purchases BIGINT, ga4_revenue DECIMAL(18, 2), platform_conversions BIGINT, ad_spend DECIMAL(18, 2))`);
      const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
      for (let i = 0; i < rows.length; i += 500) {
        const values = rows.slice(i, i + 500).map((r) => `(DATE ${lit(String(r.date).slice(0, 10))}, ${lit(r.channel)}, ${lit(r.device)}, ${COLUMNS.slice(3).map((col) => Number(r[col]) || 0).join(", ")})`).join(",\n");
        await wc.run(`INSERT INTO ${MART.model} VALUES ${values}`);
      }
      await wc.run("CHECKPOINT");
    } finally {
      wc.closeSync?.();
      w.closeSync?.();
    }
    renameSync(tmp, martFile);
    const instanceRo = await DuckDBInstance.create(martFile, { access_mode: "READ_ONLY", enable_external_access: "false", lock_configuration: "true" });
    mart = { mtime, instance: instanceRo };
    return instanceRo;
  }
  return {
    dialect: "duckdb",
    table: MART.model,
    demo: true,
    query,
    /**
     * One exploratory statement, already through the SQL guard, on its own connection with a timeout.
     * @returns {Promise<{ rows: object[], columns: string[], bytes: number }>}
     */
    async explore(sql, { timeoutMs = 10000 } = {}) {
      const c = await (await martOnly()).connect();
      const timer = setTimeout(() => c.interrupt(), timeoutMs);
      try {
        const reader = await c.runAndReadAll(sql);
        const rows = reader.getRowObjectsJson().map(normalizeAny);
        // DuckDB has no dry run; the scan is the whole mart file at most.
        return { rows, columns: reader.columnNames(), bytes: statSync(file).size };
      } catch (err) {
        if (/interrupt/i.test(err.message)) throw new AppError("explore_timeout", `The query ran longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.`);
        // DuckDB's message is useful to the model (a misspelt column) but may name paths: keep the first line,
        // without anything that looks like a path.
        throw new AppError("explore_sql_error", `The warehouse refused the query: ${err.message.split("\n")[0].replace(/(\/|[A-Za-z]:\\)[^\s'"]+/g, "<path>")}`);
      } finally {
        clearTimeout(timer);
        c.closeSync?.();
      }
    },
    async range() {
      if (!range) {
        const [r] = await query(`SELECT CAST(MIN(date) AS VARCHAR) AS data_from, CAST(MAX(date) AS VARCHAR) AS data_to, COUNT(*) AS n FROM ${MART.model}`);
        range = { from: r.data_from, to: r.data_to, rows: Number(r.n) };
      }
      return range;
    },
    refreshedAt: () => statSync(file).mtime.toISOString(),
    close() {
      mart?.instance.closeSync?.();
      conn.closeSync?.();
      instance.closeSync?.();
    },
  };
}
