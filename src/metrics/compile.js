// Metric + query parameters -> SQL for one dialect. There is no free-form SQL: column names
// come only from the validated pack, filter values only from the mart's known values, and
// dates only as checked YYYY-MM-DD strings, so literals can be inlined and the SQL shown
// to the person is exactly the SQL that ran.
import { AppError } from "../errors.js";
import { addDays, isISODate, weekStart } from "../format.js";
import { MART } from "./load.js";

export const DIALECTS = ["duckdb", "bigquery"];

const DIM_SQL = {
  duckdb: {
    day: "date",
    week: "CAST(DATE_TRUNC('week', date) AS DATE)",
    month: "CAST(DATE_TRUNC('month', date) AS DATE)",
    channel: "channel",
    device: "device",
  },
  bigquery: {
    day: "date",
    week: "DATE_TRUNC(date, WEEK(MONDAY))",
    month: "DATE_TRUNC(date, MONTH)",
    channel: "channel",
    device: "device",
  },
};

const quote = (v) => `'${String(v).replace(/'/g, "''")}'`;
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Checks filter values against the mart and returns { channel?: string[], device?: string[] }. */
export function normalizeFilters(filters = {}) {
  const out = {};
  for (const [dim, value] of Object.entries(filters ?? {})) {
    if (value == null || (Array.isArray(value) && !value.length)) continue;
    const known = MART.dimensions[dim];
    if (!known) throw new AppError("invalid_filter", `Unknown filter "${dim}". Filter by ${Object.keys(MART.dimensions).join(" or ")}.`);
    const values = asList(value).map(String);
    const bad = values.filter((v) => !known.includes(v));
    if (bad.length) throw new AppError("invalid_filter", `Unknown ${dim} ${bad.map((b) => `"${b}"`).join(", ")}. Use one of: ${known.join(", ")}.`);
    out[dim] = [...new Set(values)];
  }
  return out;
}

/** The filters as the result echoes them: one value stays a string, several stay a list. */
export const echoFilters = (filters) => Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, v.length === 1 ? v[0] : v]));

/** Intersects fixed filters (the metric's, the check's) with the person's. Empty means no row can match. */
export function mergeWhere(...wheres) {
  const out = {};
  for (const w of wheres) {
    for (const [dim, values] of Object.entries(w ?? {})) {
      out[dim] = out[dim] ? out[dim].filter((v) => values.includes(v)) : [...values];
    }
  }
  for (const [dim, values] of Object.entries(out)) {
    if (!values.length) {
      const fixed = wheres.map((w) => w?.[dim]).filter(Boolean)[0];
      throw new AppError("invalid_filter", `No ${dim} matches every filter here.${fixed ? ` This covers only ${fixed.join(", ")}.` : ""}`);
    }
  }
  return out;
}

const clamp = (s, range) => (s < range.from ? range.from : s > range.to ? range.to : s);

/**
 * QueryParams -> the normalised query: defaults, clamping, complete weeks.
 * @param {{ metrics: Record<string, any> }} pack
 * @param {{ metric: string, group_by?: string, from?: string, to?: string, filters?: object }} input
 * @param {{ from: string, to: string }} range the dates the warehouse has data for
 */
export function resolveQuery(pack, input, range) {
  const metric = pack.metrics[input.metric];
  if (!metric) throw new AppError("unknown_metric", `Unknown metric "${input.metric}". Use one of: ${Object.keys(pack.metrics).join(", ")}.`);
  const groupBy = input.group_by ?? "none";
  if (groupBy !== "none" && !metric.dimensions.includes(groupBy)) {
    throw new AppError("invalid_group_by", `${metric.id} can be grouped by ${["none", ...metric.dimensions].join(", ")}, not "${groupBy}".`);
  }
  for (const k of ["from", "to"]) {
    if (input[k] != null && !isISODate(input[k])) throw new AppError("invalid_date", `${k} must be a date written YYYY-MM-DD, not "${input[k]}".`);
  }
  let to = input.to ? clamp(input.to, range) : range.to;
  let from = input.from ? clamp(input.from, range) : clamp(addDays(to, -27), range);
  if (from > to) [from, to] = [to, from];
  // Weekly results keep complete Monday–Sunday weeks only, so the last point is never a part week.
  if (groupBy === "week") {
    let ws = weekStart(from);
    if (ws < from) ws = addDays(ws, 7);
    let we = addDays(weekStart(to), 6);
    if (we > to) we = addDays(weekStart(to), -1);
    if (ws < we) [from, to] = [ws, we];
  }
  return { metric: metric.id, group_by: groupBy, from, to, filters: normalizeFilters(input.filters) };
}

/**
 * One aggregate over the mart.
 * @param {object} metric a pack metric
 * @param {{ dims: string[], from: string, to: string, where?: object, dialect: string, table: string, order?: string }} o
 *   dims: day | week | month | channel | device, in output order. order: "value" sorts by value, descending.
 */
export function compileAggregate(metric, { dims, from, to, where = {}, dialect, table, order }) {
  if (!DIALECTS.includes(dialect)) throw new Error(`Unknown SQL dialect "${dialect}".`);
  if (!isISODate(from) || !isISODate(to)) throw new Error("compileAggregate needs YYYY-MM-DD dates.");
  const select = dims.map((d) => {
    const expr = DIM_SQL[dialect][d];
    if (!expr) throw new Error(`Unknown dimension "${d}".`);
    return expr === d ? d : `${expr} AS ${d}`;
  });
  if (metric.sum) {
    if (!MART.measures.includes(metric.sum)) throw new Error(`Unknown column "${metric.sum}".`);
    select.push(`SUM(${metric.sum}) AS value`);
  } else {
    const { numerator: n, denominator: d } = metric.ratio;
    if (![n, d].every((c) => MART.measures.includes(c))) throw new Error("Unknown ratio column.");
    select.push(`SUM(${n}) AS numerator`, `SUM(${d}) AS denominator`);
    select.push(dialect === "bigquery" ? `SAFE_DIVIDE(SUM(${n}), SUM(${d})) AS value` : `SUM(${n}) / NULLIF(SUM(${d}), 0) AS value`);
  }
  const conditions = [`date BETWEEN DATE ${quote(from)} AND DATE ${quote(to)}`];
  for (const [dim, values] of Object.entries(where)) {
    if (!MART.dimensions[dim] || !values.every((v) => MART.dimensions[dim].includes(v))) throw new Error(`Filter values for ${dim} are not in the mart.`);
    conditions.push(values.length === 1 ? `${dim} = ${quote(values[0])}` : `${dim} IN (${values.map(quote).join(", ")})`);
  }
  const lines = [`-- metric ${metric.id} v${metric.version}`, "SELECT", select.map((s) => `  ${s}`).join(",\n"), `FROM ${table}`, `WHERE ${conditions.join("\n  AND ")}`];
  if (dims.length) {
    lines.push(`GROUP BY ${dims.join(", ")}`);
    lines.push(`ORDER BY ${order === "value" ? "value DESC" : dims.join(", ")}`);
  }
  return lines.join("\n");
}

/** SQL for a resolved query. */
export function compileQuery(pack, q, { dialect, table }) {
  const metric = pack.metrics[q.metric];
  return compileAggregate(metric, {
    dims: q.group_by === "none" ? [] : [q.group_by],
    from: q.from,
    to: q.to,
    where: mergeWhere(metric.where, q.filters),
    dialect,
    table,
    order: ["channel", "device"].includes(q.group_by) ? "value" : undefined,
  });
}
