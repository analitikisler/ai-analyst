// Queries over the mart with the pack's rules: QueryParams -> QueryResult (with the comparison window,
// part-month and provisional markers), the tally with its daily series and week history, dashboard periods
// and the chart grammar. Every figure comes from SQL compiled from the pack and run on the warehouse; the
// SQL in a result is the SQL that ran. Ported rule for rule from the approved prototype's engine.ts, which
// itself ports this repo's compile.js and reconcile.js.
import { reconcile as tally } from "./checks/reconcile.js";
import { AppError } from "./errors.js";
import { addDays, addMonths, daysBetween, monthEnd, monthStart, weekStart } from "./format.js";
import { compileQuery, echoFilters, resolveQuery } from "./metrics/compile.js";
import { newId } from "./store/store.js";

const now = () => new Date().toISOString();

// ---------------------------------------------------------------- windows and periods

/** The comparison window: the previous period shifted by whole weeks (or a month for month to date), or 364 days.
 *  null when it starts before the data. */
export function comparisonWindow(range, from, to, kind, monthToDate = false) {
  if (kind === "previous_year") {
    const f = addDays(from, -364);
    return f < range.from ? null : { from: f, to: addDays(to, -364), shift: 364 };
  }
  if (monthToDate) {
    const f = addMonths(from, -1);
    const t = addMonths(to, -1);
    return f < range.from ? null : { from: f, to: t, shift: daysBetween(f, from) };
  }
  const len = daysBetween(from, to) + 1;
  const shift = Math.ceil(len / 7) * 7;
  const f = addDays(from, -shift);
  return f < range.from ? null : { from: f, to: addDays(to, -shift), shift };
}

/** The last complete Monday-to-Sunday week on or before `to`. */
export function lastCompleteWeek(to) {
  const end = addDays(weekStart(to), addDays(weekStart(to), 6) <= to ? 6 : -1);
  return { from: addDays(end, -6), to: end };
}

export const PERIODS = ["last_7", "last_14", "last_28", "last_90", "last_week", "this_month", "last_month"];

/** A dashboard period against the last day with data. */
export function resolvePeriod(range, p) {
  const to = range.to;
  const clamp = (s) => (s < range.from ? range.from : s);
  switch (p) {
    case "last_7":
      return { from: addDays(to, -6), to, monthToDate: false };
    case "last_14":
      return { from: addDays(to, -13), to, monthToDate: false };
    case "last_28":
      return { from: addDays(to, -27), to, monthToDate: false };
    case "last_90":
      return { from: clamp(addDays(to, -89)), to, monthToDate: false };
    case "last_week":
      return { ...lastCompleteWeek(to), monthToDate: false };
    case "this_month":
      return { from: monthStart(to), to, monthToDate: true };
    case "last_month": {
      const end = addDays(monthStart(to), -1);
      return { from: monthStart(end), to: end, monthToDate: false };
    }
    default:
      throw new AppError("invalid_input", `Unknown period "${p}".`);
  }
}

// ---------------------------------------------------------------- queries

const sortRows = (rows, g) =>
  ["channel", "device"].includes(g) ? rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity)) : rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

/** Runs one compiled aggregate and returns { rows, total } with ratios computed from the sums of their parts. */
async function aggregate(ctx, metric, q) {
  const sql = compileQuery(ctx.pack, q, ctx.warehouse);
  const raw = await ctx.warehouse.query(sql);
  const ratio = !metric.sum;
  const val = (r) => (ratio ? (r.denominator ? r.numerator / r.denominator : null) : r.value ?? 0);
  let n = 0;
  let d = 0;
  for (const r of raw) {
    if (ratio) {
      n += r.numerator ?? 0;
      d += r.denominator ?? 0;
    } else n += r.value ?? 0;
  }
  const total = ratio ? (d ? n / d : null) : n;
  const rows = q.group_by === "none" ? [] : sortRows(raw.map((r) => ({ key: String(r[q.group_by]), value: val(r) })), q.group_by);
  return { sql, rows, total };
}

/**
 * QueryParams -> QueryResult.
 * @param {object} ctx { pack, warehouse, store }
 * @param {{ metric, group_by?, from?, to?, filters?, compare?, month_to_date? }} input
 * @param {{ save?: boolean }} [opts] save: store it, so an answer can cite it by id (default true).
 */
export async function runQuery(ctx, input, { save = true } = {}) {
  const range = await ctx.warehouse.range();
  const q = resolveQuery(ctx.pack, input, range);
  const metric = ctx.pack.metrics[q.metric];
  const agg = await aggregate(ctx, metric, q);
  const result = {
    id: newId("q"),
    metric: metric.id,
    metric_version: metric.version,
    group_by: q.group_by,
    from: q.from,
    to: q.to,
    filters: echoFilters(q.filters),
    unit: metric.unit,
    rows: agg.rows,
    total: agg.total,
    sql: agg.sql,
    dialect: ctx.warehouse.dialect,
    ran_at: now(),
    provisional_from: addDays(range.to, -2),
    partial: q.group_by === "month" && q.to < monthEnd(q.to) ? { key: monthStart(q.to), days: Number(q.to.slice(8)), of: Number(monthEnd(q.to).slice(8)) } : null,
  };
  if (input.compare) {
    const w = comparisonWindow(range, q.from, q.to, input.compare, input.month_to_date);
    if (!w) {
      result.comparison = null;
      result.comparison_note = "no_data";
    } else {
      const prev = await aggregate(ctx, metric, { ...q, from: w.from, to: w.to });
      const delta = result.total != null && prev.total != null ? result.total - prev.total : null;
      result.comparison = {
        kind: input.compare,
        from: w.from,
        to: w.to,
        shift_days: w.shift,
        total: prev.total,
        rows: prev.rows,
        delta,
        delta_pct: delta != null && prev.total ? delta / prev.total : null,
        sql: prev.sql,
      };
      if (metric.unit === "pct" && delta != null) result.comparison.delta_points = delta * 100;
    }
  }
  return save && ctx.store ? ctx.store.saveQuery(result) : result;
}

// ---------------------------------------------------------------- the tally

/** Findings as a CheckResult carries them; a finding confirmed by a failing audit says so. */
export function findingsFor(store, checkId) {
  const audit = store.list("audits", { limit: 50 }).find((a) => a.check === checkId && a.status !== "handoff" && a.result && !a.result.ok);
  return store.findingsFor(checkId).map((x) => ({ ...x, ...(audit && x.since ? { confirmed: { audit_id: audit.id, at: audit.finished_at } } : {}) }));
}

/** One check over a period. opts.seriesLead: days of series before the period (default 14). */
export async function runReconcile(ctx, input, { save = true, seriesLead = 14 } = {}) {
  const result = await tally({ pack: ctx.pack, warehouse: ctx.warehouse, ...input, findings: ctx.store ? findingsFor(ctx.store, input.check) : [], seriesLead });
  return save && ctx.store ? ctx.store.saveCheck(result) : result;
}

const verdictOf = (expected, measured, tolerance) => {
  if (!expected) return { delta_pct: null, verdict: "insufficient_data" };
  const deltaPct = (measured - expected) / expected;
  return { delta_pct: deltaPct, verdict: Math.abs(deltaPct) <= tolerance + 1e-12 ? "adds_up" : "does_not_add_up" };
};

/** Complete weeks ending on or before `to`, oldest first. */
export async function checkHistory(ctx, checkId, weeks = 7) {
  const range = await ctx.warehouse.range();
  const check = ctx.pack.checks[checkId];
  const last = lastCompleteWeek(range.to).to;
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const wTo = addDays(last, -7 * i);
    const wFrom = addDays(wTo, -6);
    if (wFrom < range.from) continue;
    const r = await runReconcile(ctx, { check: checkId, from: wFrom, to: wTo }, { save: false, seriesLead: 0 });
    out.push({ from: wFrom, to: wTo, expected: r.expected.value, measured: r.measured.value, ...verdictOf(r.expected.value, r.measured.value, check.tolerance) });
  }
  return out;
}

// ---------------------------------------------------------------- chart grammar

export const CHART_TYPES = ["number", "line", "column", "stacked_column", "area", "table", "tally", "split_bar", "both_lines"];
const WIDTHS = [3, 4, 6, 8, 12];

export function validCharts(pack, query) {
  if (query.type === "check") return ["tally", "both_lines", "split_bar", "table"];
  if (query.type === "explore") {
    const d = query.spec.dims;
    return d.length === 0 ? ["number"] : d.length === 2 ? ["table"] : d[0] === "week" ? ["column", "line", "table"] : ["split_bar", "table"];
  }
  const m = pack.metrics[query.metric];
  const g = query.group_by;
  if (g === "channel" || g === "device") return ["split_bar", "table", "number"];
  if (m.unit === "pct" || !m.sum) return ["line", "number", "table"];
  return ["number", "line", "column", "area", "table"];
}

export function widthRules(chart) {
  return WIDTHS.map((w) => {
    if ((chart === "line" || chart === "both_lines") && w < 4) return { w, ok: false, reason: "line" };
    if ((chart === "column" || chart === "area") && w < 4) return { w, ok: false, reason: "column" };
    if (chart === "table" && w < 4) return { w, ok: false, reason: "table" };
    return { w, ok: true };
  });
}
export const allWidthRules = () => Object.fromEntries(CHART_TYPES.map((c) => [c, widthRules(c)]));
