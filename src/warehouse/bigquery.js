// The real warehouse: the person's own BigQuery project, with their own credentials (gcloud application
// default credentials, a key file path, optionally impersonating a service account). Every query is dry-run
// first and refused when it would scan more than the cap; the real run carries maximumBytesBilled as a second
// guard and a job timeout. Queries run (and are billed) in the job project; the mart lives in the data project.
import { assertCloudAllowed } from "../cloud.js";
import { AppError } from "../errors.js";
import { sourceUnavailable } from "./google-errors.js";
import { refAllowed } from "../explore/allow.js";
import { MART } from "../metrics/load.js";

// Project ids are 6-30 chars (optionally domain-scoped, "example.com:project"); datasets are letters, digits, _.
const PROJECT = /^([a-z0-9.-]+:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATASET = /^[A-Za-z_][A-Za-z0-9_]{0,1023}$/;
export const isProject = (p) => typeof p === "string" && PROJECT.test(p);
export const isDataset = (d) => typeof d === "string" && DATASET.test(d);

export function tableName({ project, dataset }) {
  if (!project || !PROJECT.test(project)) throw new Error(`BIGQUERY_PROJECT "${project ?? ""}" is not a valid project id.`);
  if (!dataset || !DATASET.test(dataset)) throw new Error(`BIGQUERY_DATASET "${dataset ?? ""}" is not a valid dataset name.`);
  return `\`${project}.${dataset}.${MART.model}\``;
}

/** The job options for one query. maximumBytesBilled is a string because the API takes int64 as text. */
export function queryOptions(cfg, sql, { dryRun = false, maxBytes = cfg.maxBytes } = {}) {
  return {
    query: sql,
    location: cfg.location,
    useLegacySql: false,
    maximumBytesBilled: String(Math.floor(maxBytes)),
    ...(cfg.jobTimeoutMs ? { jobTimeoutMs: cfg.jobTimeoutMs } : {}),
    ...(dryRun ? { dryRun: true } : {}),
  };
}

/** BigQuery returns DATE as { value }, NUMERIC as Big; the app wants strings and numbers. */
export function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const plain = v && typeof v === "object" && "value" in v ? v.value : v;
    out[k] = ["value", "numerator", "denominator", "n"].includes(k) ? (plain == null ? null : Number(plain)) : plain;
  }
  return out;
}

function normalizeAny(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const plain = v && typeof v === "object" && "value" in v ? v.value : v;
    out[k] = plain != null && typeof plain === "object" && typeof plain.toString === "function" && /^-?\d/.test(String(plain)) ? Number(String(plain)) : plain;
  }
  return out;
}

/** A BigQuery client for these settings. Never constructed in tests (they pass a fake). */
export async function bigQueryClient(cfg) {
  assertCloudAllowed("BigQuery");
  const { BigQuery } = await import("@google-cloud/bigquery");
  const projectId = (cfg.jobProject || cfg.project).replace(/^.*:/, "");
  const opts = { projectId, location: cfg.location ?? undefined };
  if (cfg.auth?.kind === "key_file" && cfg.auth.path) opts.keyFilename = cfg.auth.path;
  if (cfg.auth?.impersonate) {
    // google-auth-library ships with @google-cloud/bigquery; impersonation needs no key file.
    const { GoogleAuth, Impersonated } = await import("google-auth-library");
    const source = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"], ...(opts.keyFilename ? { keyFilename: opts.keyFilename } : {}) }).getClient();
    opts.authClient = new Impersonated({ sourceClient: source, targetPrincipal: cfg.auth.impersonate, targetScopes: ["https://www.googleapis.com/auth/bigquery"], lifetime: 3600 });
  }
  return new BigQuery(opts);
}

/** The region qualifier for INFORMATION_SCHEMA views that span a project: EU → region-eu. */
export const regionOf = (location) => `region-${String(location || "EU").toLowerCase()}`;
const BQ_TABLES_LIMIT = 50; // a dry run lists at most 50 referenced tables; a longer list may be incomplete
const msOrNull = (v) => (v == null || v === "" ? null : new Date(Number(v)).toISOString());

/**
 * @param {{ project: string, jobProject?: string, dataset: string, location: string, maxBytes: number, auth?: object, jobTimeoutMs?: number }} cfg
 * @param {{ client?: any }} [opts] client: a BigQuery client (tests pass a fake)
 */
export async function openBigQuery(cfg, opts = {}) {
  const table = tableName(cfg);
  const mart = `${cfg.project}.${cfg.dataset}.${MART.model}`.toLowerCase();
  const client = opts.client ?? (await bigQueryClient(cfg));
  let range = null;
  let lastRun = null;

  const capError = (bytes, maxBytes, question) => {
    const gb = (n) => (n / 1024 ** 3).toFixed(2);
    const what = question ? `the ${gb(maxBytes)} GB left of this question's cap` : `the ${gb(maxBytes)} GB cap (BIGQUERY_MAX_BYTES)`;
    return new AppError("bytes_cap", `This query would scan ${gb(bytes)} GB, more than ${what}. Narrow the dates; on a partitioned table, filter by its date column.`, { bytes, params: { bytes, cap: maxBytes, ...(question ? { question: 1 } : {}) } });
  };

  /**
   * The dry run is authoritative about what a query reads. Compiled metric SQL must read the mart alone when the dry
   * run reports tables. Exploratory SQL (policy given) must report its tables, every one of them (and every view it
   * goes through) on the allowlist, as a SELECT.
   */
  async function dryRun(sql, maxBytes, { policy = null, question = false } = {}) {
    let dry;
    try {
      [dry] = await client.createQueryJob(queryOptions(cfg, sql, { dryRun: true, maxBytes }));
    } catch (err) {
      if (!policy) throw sourceUnavailable(err);
      const first = String(err?.message ?? "").split("\n")[0];
      console.error("[ai-analyst] exploratory dry run failed on BigQuery:", first);
      if (/location/i.test(first)) throw new AppError("sql_location_mismatch", "The query reads a dataset in another location than the mart. A BigQuery query runs in one location.", { params: { location: cfg.location ?? "" } });
      throw new AppError("explore_sql_error", "BigQuery refused the query. Check the columns and the SQL, then try again.");
    }
    const stats = dry?.metadata?.statistics ?? {};
    const bytes = Number(stats.totalBytesProcessed ?? 0);
    const refs = stats.query?.referencedTables;
    const views = stats.query?.referencedViews ?? [];
    const type = stats.query?.statementType;
    const name = (r) => `${r.projectId}.${r.datasetId}.${r.tableId}`;
    const notAllowed = (detail, table) => new AppError("sql_table_not_allowed", "The query reads a table that is not on the list of tables the agent may read (Settings › Sources).", { params: { detail, ...(table ? { table } : {}) } });
    if (policy) {
      if (!refs || !refs.length) throw notAllowed("referenced tables");
      if (refs.length >= BQ_TABLES_LIMIT) throw notAllowed("too many tables to check");
      const bad = [...refs, ...views].find((r) => !refAllowed(policy, r));
      if (bad) throw notAllowed("referenced tables", name(bad));
      // Protection is by column name, and a view can rename a column: a view is read only when the person added
      // it by name, never because its dataset is allowed (security review 2, M3).
      const looseView = views.find((v) => !(policy.allowed ?? []).includes(`${String(v.projectId).toLowerCase()}.${v.datasetId}.${v.tableId}`));
      if (looseView) throw notAllowed("a view allowed only through its dataset; add the view by name in Settings › Sources", name(looseView));
      if (type !== "SELECT") throw new AppError("sql_not_select", "Only a read-only query can run: it must start with SELECT or WITH.", { params: { detail: String(type ?? "unknown statement") } });
    } else if (refs || type) {
      const names = (refs ?? []).map((r) => name(r).toLowerCase());
      if (!refs || !names.length || names.some((x) => x !== mart)) throw notAllowed("referenced tables");
      if (type !== "SELECT") throw new AppError("sql_not_select", "Only a read-only query can run: it must start with SELECT or WITH.", { params: { detail: String(type ?? "unknown statement") } });
    }
    if (bytes > maxBytes) throw capError(bytes, maxBytes, question);
    return { bytes, tables: [...new Set((refs ?? []).map(name))] };
  }

  /** Server-written SQL over INFORMATION_SCHEMA (never the model's): names are validated before they get here. */
  async function meta(sql) {
    const [rows] = await client.query({ query: sql, location: cfg.location, useLegacySql: false, maximumBytesBilled: String(Math.floor(cfg.maxBytes)) });
    return rows.map(normalizeAny);
  }

  async function query(sql) {
    await dryRun(sql, cfg.maxBytes);
    let rows;
    try {
      [rows] = await client.query(queryOptions(cfg, sql));
    } catch (err) {
      throw sourceUnavailable(err);
    }
    lastRun = new Date().toISOString();
    return rows.map(normalizeRow);
  }

  return {
    dialect: "bigquery",
    table,
    demo: false,
    query,
    bytesCap: cfg.maxBytes,
    /**
     * One exploratory statement, already through the SQL guard: the dry run against the allowlist, then the run with
     * the cap and a timeout. maxBytes: what is left of the per-question cap, when lower than the per-query cap.
     */
    async explore(sql, { timeoutMs = 30000, policy, maxBytes, onBytes } = {}) {
      if (!policy) throw new AppError("sql_table_not_allowed", "The query reads a table that is not on the list of tables the agent may read (Settings › Sources).", { params: { detail: "no allowlist" } });
      const question = maxBytes != null && maxBytes < cfg.maxBytes;
      const cap = question ? Math.max(0, Math.floor(maxBytes)) : cfg.maxBytes;
      const dry = await dryRun(sql, cap, { policy, question });
      // Counted against the question before the run, so a run that fails after it was billed still counts.
      onBytes?.(dry.bytes ?? 0);
      try {
        const [rows] = await client.query({ ...queryOptions(cfg, sql, { maxBytes: cap }), jobTimeoutMs: timeoutMs });
        lastRun = new Date().toISOString();
        const out = rows.map(normalizeAny);
        return { rows: out, columns: out[0] ? Object.keys(out[0]) : [], bytes: dry.bytes, tables: dry.tables };
      } catch (err) {
        // The raw error can name other projects or tables; the person gets a code, the log gets the detail.
        console.error("[ai-analyst] exploratory query failed on BigQuery:", String(err.message).split("\n")[0]);
        throw new AppError("explore_sql_error", "BigQuery refused the query. Check the columns and the SQL, then try again.");
      }
    },
    /**
     * The structure of the allowed tables, from INFORMATION_SCHEMA and __TABLES__ (no table data). Server-side only.
     * @param {{ project: string, dataset: string, table: string|null }[]} entries the mart and the allowlist
     */
    async describe(entries) {
      const byDataset = new Map();
      for (const e of entries) {
        const k = `${e.project}.${e.dataset}`;
        const cur = byDataset.get(k) ?? { project: e.project, dataset: e.dataset, tables: new Set(), all: false };
        if (e.table) cur.tables.add(e.table);
        else cur.all = true;
        byDataset.set(k, cur);
      }
      const out = [];
      for (const d of byDataset.values()) {
        if (!isProject(d.project) || !isDataset(d.dataset)) continue;
        const q = `\`${d.project}.${d.dataset}\``;
        const [cols, sizes, types] = await Promise.all([
          meta(`SELECT c.table_name, c.column_name, c.data_type, c.is_partitioning_column, p.description FROM ${q}.INFORMATION_SCHEMA.COLUMNS c LEFT JOIN ${q}.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS p ON p.table_name = c.table_name AND p.column_name = c.column_name AND p.field_path = c.column_name ORDER BY c.table_name, c.ordinal_position`),
          meta(`SELECT table_id, row_count, size_bytes, last_modified_time FROM ${q}.__TABLES__`),
          meta(`SELECT table_name, table_type FROM ${q}.INFORMATION_SCHEMA.TABLES`),
        ]);
        const names = d.all ? [...new Set(types.map((t) => t.table_name))] : [...d.tables];
        for (const table of names) {
          const columns = cols.filter((c) => c.table_name === table).map((c) => ({ name: c.column_name, type: c.data_type, partitioning: c.is_partitioning_column === "YES", ...(c.description ? { description: String(c.description).slice(0, 200) } : {}) }));
          if (!columns.length) continue;
          const size = sizes.find((x) => x.table_id === table);
          const type = types.find((x) => x.table_name === table)?.table_type ?? "BASE TABLE";
          out.push({ key: `${d.project}.${d.dataset}.${table}`, project: d.project, dataset: d.dataset, table, type: type === "VIEW" ? "view" : "table", columns, rows: size ? Number(size.row_count) : null, bytes: size ? Number(size.size_bytes) : null, modified: size ? msOrNull(size.last_modified_time) : null });
        }
      }
      return out;
    },
    /** What the credential can see, for the table picker: datasets with their location, and table counts in the mart's location. */
    async listTables() {
      const projects = [...new Set([cfg.project, cfg.jobProject].filter(Boolean))];
      const datasets = [];
      for (const projectId of projects) {
        const [list] = await client.getDatasets({ projectId: projectId.replace(/^.*:/, "") });
        for (const ds of list.slice(0, 100)) {
          const [m] = await ds.getMetadata();
          datasets.push({ project: projectId, dataset: ds.id, location: m.location ?? null });
        }
      }
      const same = (l) => String(l ?? "").toLowerCase() === String(cfg.location ?? "").toLowerCase();
      for (const d of datasets) {
        d.same_location = same(d.location);
        d.tables = [];
        if (!d.same_location || !isDataset(d.dataset)) continue;
        const rows = await meta(`SELECT table_id, row_count, size_bytes, last_modified_time FROM \`${d.project}.${d.dataset}\`.__TABLES__ ORDER BY table_id LIMIT 500`).catch(() => []);
        d.tables = rows.map((r) => ({ table: r.table_id, rows: Number(r.row_count ?? 0), bytes: Number(r.size_bytes ?? 0), modified: msOrNull(r.last_modified_time) }));
      }
      return { location: cfg.location ?? null, datasets };
    },
    async range() {
      if (!range) {
        const [r] = await query(`SELECT CAST(MIN(date) AS STRING) AS data_from, CAST(MAX(date) AS STRING) AS data_to, COUNT(*) AS n FROM ${table}`);
        if (!r?.data_to) throw new Error(`${table} has no rows.`);
        range = { from: r.data_from, to: r.data_to, rows: Number(r.n) };
      }
      return range;
    },
    refreshedAt: () => lastRun,
    close() {},
  };
}
