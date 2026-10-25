// The local demo warehouse: one DuckDB file holding daily_channel_device and the demo shop's tables (orders,
// order_items, products, returns). It is opened read-only, with external access (files, URLs, extensions)
// switched off and the configuration locked, so no statement can read or write anything but this file, and SET
// cannot undo that. Exploratory SQL runs in a second database built from the allowed tables alone
// (demo.explore-<list>.duckdb next to it, opened the same way), so whatever the file holds, a model's query
// cannot name any other table.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { DEMO_DATASET } from "../explore/allow.js";
import { AppError } from "../errors.js";
import { MART } from "../metrics/load.js";

/** What each demo table holds, one line, for describe_tables (the person can write their own in Settings). */
export const DEMO_DESCRIPTIONS = {
  daily_channel_device: "The mart: one row per day, channel and device, with sessions, orders, revenue, GA4 and ad platform figures. The checked layer.",
  orders: "Orders from the back office, one row per order. order_total in TRY; is_first_order is the customer's first order. Totals match the mart by day, channel and device.",
  order_items: "Order lines, one row per product in an order. line_total sums to the order's order_total. Join to orders on order_id, to products on product_id.",
  products: "The product catalogue, one row per product, with category and list price in TRY.",
  returns: "Returned order lines, one row per return, with the refund in TRY and a reason. Join to order_items on order_id and line_no.",
};

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

const DUCK_ERRORS = [
  [/^Parser Error/i, "syntax", "The query has a syntax error. Check the SQL and try again."],
  [/^(Binder|Catalog) Error/i, "names", "The query names a column or table that is not there, or compares values of different types. Check the names with describe_tables."],
  [/^(Conversion|Invalid Input|Out of Range|Overflow)/i, "values", "A value in the data could not be read the way the query asks (a type conversion or a value out of range). Cast or filter differently."],
];
/** DuckDB's error as a code and a fixed sentence; only its kind is logged (its text can hold a value). */
export function duckExploreError(err) {
  const first = String(err?.message ?? "").split("\n")[0];
  const hit = DUCK_ERRORS.find(([re]) => re.test(first));
  console.error(`[ai-analyst] exploratory query failed on DuckDB: ${hit ? hit[1] : "other"}`);
  return new AppError("explore_sql_error", hit ? hit[2] : "The warehouse refused the query. Check the SQL and try again.", { params: { kind: hit ? hit[1] : "other" } });
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
export async function openDuckDB(file, { local = false } = {}) {
  if (!existsSync(file)) throw new Error(local ? `No synced data at ${file} yet. Connect a source in Settings › Sources.` : `No demo warehouse at ${file}. Run: ai-analyst seed-demo`);
  const { DuckDBInstance } = await import("@duckdb/node-api");
  // Read-only, so a second process (the MCP server next to the web server) can open it too.
  const instance = await DuckDBInstance.create(file, { access_mode: "READ_ONLY", enable_external_access: "false", lock_configuration: "true" });
  const conn = await instance.connect();
  let range = null;
  const query = async (sql) => (await conn.runAndReadAll(sql)).getRowObjectsJson().map(normalizeRow);
  const present = (await conn.runAndReadAll("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name")).getRowObjectsJson().map((r) => String(r.table_name));

  // The database for exploratory SQL: copies of the allowed tables and nothing else, one file per list, rebuilt
  // when the demo file changes.
  const base = file.replace(/\.duckdb$/, "");
  let built = null;
  async function exploreDb(allowed) {
    const tables = [...new Set(allowed.map((t) => String(t).toLowerCase()))].filter((t) => present.includes(t)).sort();
    const mtime = statSync(file).mtimeMs;
    const sig = createHash("sha256").update(tables.join(",")).digest("hex").slice(0, 10);
    if (built?.mtime === mtime && built.sig === sig) return built.instance;
    built?.instance.closeSync?.();
    built = null;
    const target = `${base}.explore-${sig}.duckdb`;
    const tmp = `${target}.${process.pid}.tmp`;
    for (const f of [tmp, `${tmp}.wal`]) if (existsSync(f)) rmSync(f);
    const w = await DuckDBInstance.create(tmp, { enable_external_access: "false" });
    const wc = await w.connect();
    const lit = (v) => (v == null ? "NULL" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : `'${String(v).replace(/'/g, "''")}'`);
    const ident = (x) => `"${String(x).replace(/"/g, '""')}"`;
    try {
      for (const t of tables) {
        const cols = (await conn.runAndReadAll(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' AND table_name = ${lit(t)} ORDER BY ordinal_position`)).getRowObjectsJson();
        await wc.run(`CREATE TABLE ${ident(t)} (${cols.map((c) => `${ident(c.column_name)} ${c.data_type}`).join(", ")})`);
        const rows = (await conn.runAndReadAll(`SELECT * FROM ${ident(t)}`)).getRowObjectsJson();
        // Every value goes in as a literal; DuckDB casts it to the column's type.
        for (let i = 0; i < rows.length; i += 1000) {
          const values = rows.slice(i, i + 1000).map((r) => `(${cols.map((c) => lit(r[c.column_name])).join(", ")})`).join(",\n");
          await wc.run(`INSERT INTO ${ident(t)} VALUES ${values}`);
        }
      }
      await wc.run("CHECKPOINT");
    } finally {
      wc.closeSync?.();
      w.closeSync?.();
    }
    renameSync(tmp, target);
    // Copies built for other lists (or by older versions) are not needed any more.
    const dir = path.dirname(file);
    const stem = path.basename(base);
    for (const f of readdirSync(dir)) {
      if (f.startsWith(`${stem}.explore`) && f.endsWith(".duckdb") && path.join(dir, f) !== target) rmSync(path.join(dir, f), { force: true });
    }
    const ro = await DuckDBInstance.create(target, { access_mode: "READ_ONLY", enable_external_access: "false", lock_configuration: "true" });
    built = { mtime, sig, instance: ro };
    return ro;
  }
  return {
    dialect: "duckdb",
    table: MART.model,
    // local: the person's own shop, fed by the connectors (warehouse.duckdb); else the demo.
    demo: !local,
    local,
    query,
    /** The tables the demo file holds. */
    tables: () => [...present],
    /**
     * One exploratory statement, already through the SQL guard, on its own connection with a timeout, in the
     * database that holds only the allowed tables (policy.allowed; the mart alone without a policy).
     * @returns {Promise<{ rows: object[], columns: string[], bytes: number, tables: string[] }>}
     */
    async explore(sql, { timeoutMs = 10000, policy } = {}) {
      const allowed = policy?.allowed ?? [MART.model];
      const c = await (await exploreDb(allowed)).connect();
      const timer = setTimeout(() => c.interrupt(), timeoutMs);
      try {
        const reader = await c.runAndReadAll(sql);
        const rows = reader.getRowObjectsJson().map(normalizeAny);
        // DuckDB has no dry run; the scan is the demo file at most.
        return { rows, columns: reader.columnNames(), bytes: statSync(file).size, tables: [] };
      } catch (err) {
        if (/interrupt/i.test(err.message)) throw new AppError("explore_timeout", `The query ran longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.`);
        // DuckDB's own text can quote a value from the data (a conversion error names the value it could not read),
        // so neither the model, the UI nor the log ever sees it: a fixed sentence per kind of error.
        throw duckExploreError(err);
      } finally {
        clearTimeout(timer);
        c.closeSync?.();
      }
    },
    /** The structure of the given demo tables (no table data beyond row counts). */
    async describe(entries) {
      const names = [...new Set(entries.flatMap((e) => (e.table ? [e.table] : present)))].filter((t) => present.includes(t));
      const out = [];
      for (const t of names) {
        const cols = (await conn.runAndReadAll(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' AND table_name = '${t.replace(/'/g, "''")}' ORDER BY ordinal_position`)).getRowObjectsJson();
        const [n] = (await conn.runAndReadAll(`SELECT COUNT(*) AS n FROM "${t.replace(/"/g, '""')}"`)).getRowObjectsJson();
        out.push({ key: t, project: null, dataset: DEMO_DATASET, table: t, type: "table", columns: cols.map((c) => ({ name: c.column_name, type: c.data_type, partitioning: false })), rows: Number(n.n), bytes: null, modified: statSync(file).mtime.toISOString(), builtin_description: DEMO_DESCRIPTIONS[t] ?? null });
      }
      return out;
    },
    /** The demo's one "dataset": its shop tables (the mart is always on the list). */
    async listTables() {
      const shop = present.filter((t) => t !== MART.model);
      const tables = [];
      for (const t of shop) {
        const [n] = (await conn.runAndReadAll(`SELECT COUNT(*) AS n FROM "${t.replace(/"/g, '""')}"`)).getRowObjectsJson();
        tables.push({ table: t, rows: Number(n.n), bytes: null, modified: statSync(file).mtime.toISOString() });
      }
      return { location: null, datasets: [{ project: null, dataset: DEMO_DATASET, location: null, same_location: true, tables }] };
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
      built?.instance.closeSync?.();
      conn.closeSync?.();
      instance.closeSync?.();
    },
  };
}
