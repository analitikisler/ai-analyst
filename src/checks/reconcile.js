// The tally: a measured figure against the system that owns it. One SQL per side returns
// daily sums split by the breakdown dimension, from the first day with data to the end of the
// period; the period totals, the per-segment split and the since-date all come from those rows.
import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import { addDays, isISODate } from "../format.js";
import { compileAggregate, echoFilters, mergeWhere, normalizeFilters } from "../metrics/compile.js";
import { MART } from "../metrics/load.js";

// Why a side has no verdict: missing (NULL) data is never read as zero.
// A metric label inside a sentence: "Orders" reads "orders", while "GA4 purchases" and "ROAS" keep their capitals.
const inSentence = (s) => (/^[A-Z0-9]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const REASONS = {
  missing_expected: (l) => ({ en: `No data for ${inSentence(l.en)} in this period: the column is empty, so there is nothing to compare.`, tr: `Bu dönemde ${l.tr} için veri yok: sütun boş, karşılaştırılacak bir şey yok.` }),
  missing_measured: (l) => ({ en: `No data for ${inSentence(l.en)} in this period: the column is empty, so there is nothing to compare.`, tr: `Bu dönemde ${l.tr} için veri yok: sütun boş, karşılaştırılacak bir şey yok.` }),
  missing_both: () => ({ en: "No data on either side in this period: both columns are empty.", tr: "Bu dönemde iki tarafta da veri yok: iki sütun da boş." }),
  zero_expected: (l) => ({ en: `${l.en} is 0 in this period, so a difference in percent cannot be worked out.`, tr: `Bu dönemde ${l.tr} 0; yüzde fark hesaplanamıyor.` }),
};

/** null when no row has a value: SUM over only NULLs stays missing, never 0. */
const sumN = (rows, keep) => rows.reduce((acc, r) => (keep(r) && r.value != null ? (acc ?? 0) + Number(r.value) : acc), null);

const verdictOf = (expected, measured, tolerance) => {
  if (expected == null || measured == null) return { delta_pct: null, verdict: "insufficient_data", missing: expected == null && measured == null ? "both" : expected == null ? "expected" : "measured" };
  if (!expected) return { delta_pct: null, verdict: "insufficient_data", missing: null };
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

  const inPeriod = (r) => r.day >= start && r.day <= end;
  const expected = sumN(expRows, inPeriod);
  const measured = sumN(measRows, inPeriod);
  const overall = verdictOf(expected, measured, check.tolerance);
  // The metric's own label (the pack's), not the check side's short one.
  const labelOf = (side) => sides[side].metric.label ?? check[side].label;
  const reasonOf = (v) => (v.verdict !== "insufficient_data" ? null : v.missing ? REASONS[`missing_${v.missing}`](labelOf(v.missing === "measured" ? "measured" : "expected")) : REASONS.zero_expected(labelOf("expected")));

  // Only the segments the data holds (the demo: mobile and desktop). When a side has no split at all (every row
  // "unknown", such as an orders file without a device column), the check runs on totals and the split is not
  // available.
  const seen = (rows) => new Set(rows.filter((r) => inPeriod(r) && r.value != null).map((r) => r[check.breakdown]));
  const expSeen = seen(expRows);
  const measSeen = seen(measRows);
  const noSplit = (s) => s.size > 0 && [...s].every((k) => k === "unknown");
  const breakdownAvailable = !noSplit(expSeen) && !noSplit(measSeen);
  const segments = !breakdownAvailable ? [] : f[check.breakdown] ?? MART.dimensions[check.breakdown].filter((k) => expSeen.has(k) || measSeen.has(k) || (!expSeen.size && !measSeen.size && k !== "unknown" && k !== "other"));
  const breakdown = segments.map((key) => {
    const keep = (r) => inPeriod(r) && r[check.breakdown] === key;
    const e = sumN(expRows, keep);
    const m = sumN(measRows, keep);
    const { missing, ...v } = verdictOf(e, m, check.tolerance);
    const reason = reasonOf({ ...v, missing });
    return { key, expected: e, measured: m, ...v, ...(reason ? { reason } : {}) };
  });

  // The first day of the current unbroken run of days outside tolerance; a day with no expected value counts as inside.
  // A day with no value on either side (NULL) counts as inside, and stays null in the series.
  const byDay = (rows) => rows.reduce((acc, r) => (r.value == null ? acc : acc.set(r.day, (acc.get(r.day) ?? 0) + Number(r.value))), new Map());
  const expDay = byDay(expRows);
  const measDay = byDay(measRows);
  let since = null;
  for (let d = range.from; d <= end; d = addDays(d, 1)) {
    const e = expDay.get(d);
    const mv = measDay.get(d);
    const r = e && mv != null ? (mv - e) / e : 0;
    if (Math.abs(r) > check.tolerance) since ??= d;
    else since = null;
  }

  const seriesFrom = clamp(addDays(start, -seriesLead));
  const series = [];
  for (let d = seriesFrom; d <= end; d = addDays(d, 1)) series.push({ date: d, expected: expDay.get(d) ?? null, measured: measDay.get(d) ?? null });

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
    delta: expected == null || measured == null ? null : measured - expected,
    delta_pct: overall.delta_pct,
    tolerance: check.tolerance,
    verdict: overall.verdict,
    reason: reasonOf(overall),
    breakdown_by: check.breakdown,
    breakdown,
    ...(breakdownAvailable ? {} : { breakdown_available: false }),
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
