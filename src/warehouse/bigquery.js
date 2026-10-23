// The real warehouse: the person's own BigQuery project, with their own credentials
// (GOOGLE_APPLICATION_CREDENTIALS or gcloud). Every query is dry-run first and refused when
// it would scan more than the cap; the real run carries maximumBytesBilled as a second guard.
import { AppError } from "../errors.js";
import { MART } from "../metrics/load.js";

// Project ids are 6-30 chars (optionally domain-scoped, "example.com:project"); datasets are letters, digits, _.
const PROJECT = /^([a-z0-9.-]+:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATASET = /^[A-Za-z_][A-Za-z0-9_]{0,1023}$/;

export function tableName({ project, dataset }) {
  if (!project || !PROJECT.test(project)) throw new Error(`BIGQUERY_PROJECT "${project ?? ""}" is not a valid project id.`);
  if (!dataset || !DATASET.test(dataset)) throw new Error(`BIGQUERY_DATASET "${dataset ?? ""}" is not a valid dataset name.`);
  return `\`${project}.${dataset}.${MART.model}\``;
}

/** The job options for one query. maximumBytesBilled is a string because the API takes int64 as text. */
export function queryOptions(cfg, sql, { dryRun = false } = {}) {
  return {
    query: sql,
    location: cfg.location,
    useLegacySql: false,
    maximumBytesBilled: String(Math.floor(cfg.maxBytes)),
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

/**
 * @param {{ project: string, dataset: string, location: string, maxBytes: number }} cfg
 * @param {{ client?: any }} [opts] client: a BigQuery client (tests pass a fake)
 */
export async function openBigQuery(cfg, opts = {}) {
  const table = tableName(cfg);
  const client = opts.client ?? new (await import("@google-cloud/bigquery")).BigQuery({ projectId: cfg.project.replace(/^.*:/, ""), location: cfg.location });
  let range = null;
  let lastRun = null;

  async function query(sql) {
    const [dry] = await client.createQueryJob(queryOptions(cfg, sql, { dryRun: true }));
    const bytes = Number(dry?.metadata?.statistics?.totalBytesProcessed ?? 0);
    if (bytes > cfg.maxBytes) {
      throw new AppError("bytes_cap", `This query would scan ${(bytes / 1024 ** 3).toFixed(2)} GB, more than the ${(cfg.maxBytes / 1024 ** 3).toFixed(2)} GB cap (BIGQUERY_MAX_BYTES). Narrow the dates.`, { bytes });
    }
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
