// The real warehouse: the person's own BigQuery project, with their own credentials (gcloud application
// default credentials, a key file path, optionally impersonating a service account). Every query is dry-run
// first and refused when it would scan more than the cap; the real run carries maximumBytesBilled as a second
// guard and a job timeout. Queries run (and are billed) in the job project; the mart lives in the data project.
import { assertCloudAllowed } from "../cloud.js";
import { AppError } from "../errors.js";
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

  async function dryRun(sql, maxBytes, { strict = false } = {}) {
    const [dry] = await client.createQueryJob(queryOptions(cfg, sql, { dryRun: true, maxBytes }));
    const stats = dry?.metadata?.statistics ?? {};
    const bytes = Number(stats.totalBytesProcessed ?? 0);
    // The dry run is authoritative about what a query reads: refuse unless it is a SELECT that references the
    // mart and nothing else. Exploratory SQL (strict) must report both; compiled SQL is checked when reported.
    const refs = stats.query?.referencedTables;
    const type = stats.query?.statementType;
    if (strict || refs || type) {
      const names = (refs ?? []).map((r) => `${r.projectId}.${r.datasetId}.${r.tableId}`.toLowerCase());
      if (!refs || !names.length || names.some((x) => x !== mart)) throw new AppError("sql_table_not_allowed", "Only the mart table, daily_channel_device, can be read.", { params: { detail: "referenced tables" } });
      if (type !== "SELECT") throw new AppError("sql_not_select", "Only a read-only query can run: it must start with SELECT or WITH.", { params: { detail: String(type ?? "unknown statement") } });
    }
    if (bytes > maxBytes) {
      throw new AppError("bytes_cap", `This query would scan ${(bytes / 1024 ** 3).toFixed(2)} GB, more than the ${(maxBytes / 1024 ** 3).toFixed(2)} GB cap (BIGQUERY_MAX_BYTES). Narrow the dates.`, { bytes, params: { bytes, cap: maxBytes } });
    }
    return bytes;
  }

  async function query(sql) {
    await dryRun(sql, cfg.maxBytes);
    const [rows] = await client.query(queryOptions(cfg, sql));
    lastRun = new Date().toISOString();
    return rows.map(normalizeRow);
  }

  return {
    dialect: "bigquery",
    table,
    demo: false,
    query,
    bytesCap: cfg.maxBytes,
    /** One exploratory statement, already through the SQL guard: dry run, then the run with the cap and a timeout. */
    async explore(sql, { timeoutMs = 30000 } = {}) {
      const bytes = await dryRun(sql, cfg.maxBytes, { strict: true });
      try {
        const [rows] = await client.query({ ...queryOptions(cfg, sql), jobTimeoutMs: timeoutMs });
        lastRun = new Date().toISOString();
        const out = rows.map(normalizeAny);
        return { rows: out, columns: out[0] ? Object.keys(out[0]) : [], bytes };
      } catch (err) {
        // The raw error can name other projects or tables; the person gets a code, the log gets the detail.
        console.error("[ai-analyst] exploratory query failed on BigQuery:", String(err.message).split("\n")[0]);
        throw new AppError("explore_sql_error", "BigQuery refused the query. Check the columns and the SQL, then try again.");
      }
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
