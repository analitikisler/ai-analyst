// The tally: a measured figure against the system that owns it. One SQL per side returns
// daily sums split by the breakdown dimension, from the first day with data to the end of the
// period; the period totals, the per-segment split and the since-date all come from those rows.
import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import { addDays, isISODate } from "../format.js";
import { compileAggregate, echoFilters, mergeWhere, normalizeFilters } from "../metrics/compile.js";
import { MART } from "../metrics/load.js";

const verdictOf = (expected, measured, tolerance) => {
  if (!expected) return { delta_pct: null, verdict: "insufficient_data" };
  const deltaPct = (measured - expected) / expected;
  // The epsilon keeps a delta that equals the tolerance on the right side of it despite float rounding.
  return { delta_pct: deltaPct, verdict: Math.abs(deltaPct) <= tolerance + 1e-12 ? "adds_up" : "does_not_add_up" };
};

/**
 * @param {{ pack: any, warehouse: import("../warehouse/index.js").Warehouse, check: string, from?: string, to?: string,
 *   filters?: object, findings?: Array<{ id, source, text, since, checks }> }} o
 *   findings: findings linked to this check; they are attached when the check does not add up.
 *   seriesLead: days of daily series before the period, so a chart shows where the gap started.
 * @returns {Promise<object>} CheckResult
 */
export async function reconcile({ pack, warehouse, check: checkId, from, to, filters, findings = [], seriesLead = 14 }) {
  const check = pack.checks[checkId];
  if (!check) throw new AppError("unknown_check", `Unknown check "${checkId}". Use one of: ${Object.keys(pack.checks).join(", ")}.`);
  for (const [k, v] of Object.entries({ from, to })) {
    if (v != null && !isISODate(v)) throw new AppError("invalid_date", `${k} must be a date written YYYY-MM-DD, not "${v}".`);
  }
  const range = await warehouse.range();
  const clamp = (s) => (s < range.from ? range.from : s > range.to ? range.to : s);
  let end = to ? clamp(to) : range.to;
  let start = from ? clamp(from) : clamp(addDays(end, -13));
  if (start > end) [start, end] = [end, start];
  const f = normalizeFilters(filters);
  const dims = ["day", check.breakdown];

  const sides = {};
  for (const side of ["expected", "measured"]) {
    const metric = pack.metrics[check[side].metric];
    const sql = compileAggregate(metric, {
      dims,
      from: range.from,
      to: end,
      where: mergeWhere(metric.where, check.where, f),
      dialect: warehouse.dialect,
      table: warehouse.table,
    });
    sides[side] = { metric, sql };
  }
  const [expRows, measRows] = await Promise.all([warehouse.query(sides.expected.sql), warehouse.query(sides.measured.sql)]);

  const sumWhere = (rows, keep) => rows.reduce((acc, r) => (keep(r) ? acc + (r.value ?? 0) : acc), 0);
  const inPeriod = (r) => r.day >= start && r.day <= end;
  const expected = sumWhere(expRows, inPeriod);
  const measured = sumWhere(measRows, inPeriod);
  const overall = verdictOf(expected, measured, check.tolerance);

  const segments = f[check.breakdown] ?? MART.dimensions[check.breakdown];
  const breakdown = segments.map((key) => {
    const keep = (r) => inPeriod(r) && r[check.breakdown] === key;
    const e = sumWhere(expRows, keep);
    const m = sumWhere(measRows, keep);
    return { key, expected: e, measured: m, ...verdictOf(e, m, check.tolerance) };
  });

  // The first day of the current unbroken run of days outside tolerance; a day with no expected value counts as inside.
  const byDay = (rows) => rows.reduce((acc, r) => acc.set(r.day, (acc.get(r.day) ?? 0) + (r.value ?? 0)), new Map());
  const expDay = byDay(expRows);
  const measDay = byDay(measRows);
  let since = null;
  for (let d = range.from; d <= end; d = addDays(d, 1)) {
    const e = expDay.get(d) ?? 0;
    const r = e ? ((measDay.get(d) ?? 0) - e) / e : 0;
    if (Math.abs(r) > check.tolerance) since ??= d;
    else since = null;
  }

  const seriesFrom = clamp(addDays(start, -seriesLead));
  const series = [];
  for (let d = seriesFrom; d <= end; d = addDays(d, 1)) series.push({ date: d, expected: expDay.get(d) ?? 0, measured: measDay.get(d) ?? 0 });

  const lang2 = (side) => ({ metric: check[side].metric, label: check[side].label });
  return {
    id: `c_${randomUUID().slice(0, 8)}`,
    check: check.id,
    label: check.label,
    from: start,
    to: end,
    filters: echoFilters(f),
    unit: sides.expected.metric.unit,
    expected: { ...lang2("expected"), value: expected },
    measured: { ...lang2("measured"), value: measured },
    delta: measured - expected,
    delta_pct: overall.delta_pct,
    tolerance: check.tolerance,
    verdict: overall.verdict,
    breakdown_by: check.breakdown,
    breakdown,
    out_of_tolerance_since: since,
    findings:
      overall.verdict === "does_not_add_up"
        ? findings
            .filter((x) => !x.since || x.since <= end)
            .map(({ id, source, text, since: s, release, confirmed }) => ({ id, source, text, since: s, release: release ?? null, ...(confirmed ? { confirmed } : {}) }))
        : [],
    sql: { expected: sides.expected.sql, measured: sides.measured.sql },
    dialect: warehouse.dialect,
    ran_at: new Date().toISOString(),
    series,
    series_from: seriesFrom,
    provisional_from: addDays(range.to, -2),
  };
}
