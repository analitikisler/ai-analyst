// describe_tables: the allowed tables with their columns, types, descriptions, row counts and partitioning, read
// from INFORMATION_SCHEMA (BigQuery) or the demo file's catalogue by the server, never by the model, and cached for
// 10 minutes. It carries the person's one-line description per table and each table's protected columns.
import { DESCRIBE_TTL_MS, DEMO_DATASET, policyFor, protectedFor } from "./allow.js";

/** The entries to describe: the mart, then the allowlist of this source. */
export function describeEntries(config, warehouse) {
  const policy = policyFor(config, warehouse);
  if (policy.demo) return { policy, entries: policy.allowed.map((t) => ({ project: null, dataset: DEMO_DATASET, table: t })) };
  const bq = config.bigquery;
  return { policy, entries: [{ project: String(bq.project).toLowerCase(), dataset: bq.dataset, table: policy.mart.split(".").at(-1) }, ...policy.entries.map(({ project, dataset, table }) => ({ project, dataset, table }))] };
}

/** One table as the agent and Settings see it. */
function view(config, policy, t) {
  const p = protectedFor(config, t.key, t.columns);
  const description = config.explore?.descriptions?.[t.key] ?? t.builtin_description ?? null;
  return {
    table: t.key,
    mart: t.key === policy.mart,
    type: t.type ?? "table",
    description,
    rows: t.rows ?? null,
    bytes: t.bytes ?? null,
    modified: t.modified ?? null,
    partitioned_by: t.columns.find((c) => c.partitioning)?.name ?? null,
    columns: t.columns.map((c) => ({ name: c.name, type: c.type, ...(c.description ? { description: c.description } : {}) })),
    protected_columns: p?.columns ?? [],
    protected_confirmed: p?.confirmed ?? false,
  };
}

/**
 * The allowed tables of the app's warehouse, cached per warehouse and allowlist for 10 minutes.
 * @param {{ config: object, warehouse: object }} app
 */
export async function describeAllowed(app, { refresh = false } = {}) {
  const { config, warehouse } = app;
  const { policy, entries } = describeEntries(config, warehouse);
  const sig = JSON.stringify(entries);
  const cache = (warehouse.describeCache ??= new Map());
  const hit = cache.get(sig);
  let raw;
  if (!refresh && hit && Date.now() - hit.at < DESCRIBE_TTL_MS) raw = hit.raw;
  else {
    raw = warehouse.describe ? await warehouse.describe(entries) : [];
    cache.clear();
    cache.set(sig, { at: Date.now(), raw });
  }
  // Protected columns and descriptions come from the config as it is now, not from the cache.
  return raw.filter((t) => t.key === policy.mart || policy.match(t.key.split("."))).map((t) => view(config, policy, t));
}

/** Drops the cached structure (a table list changed). */
export function forgetDescribe(warehouse) {
  warehouse?.describeCache?.clear();
}
