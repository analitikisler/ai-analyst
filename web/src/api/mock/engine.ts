// The demo warehouse for the fixture API: the real Örnek Moda mart rows (fixtures/mart.json, exported from the
// capture server's DuckDB) queried with the server's own rules, ported from ai-analyst src/metrics/compile.js and
// src/checks/reconcile.js: sums of columns, ratios of sums, complete Monday–Sunday weeks, the tally with its
// tolerance, the breakdown and the since-date. The compare option (B07) and the check series (B12) follow
// 10-backend.md §2.6 and §2.10. The SQL text is compiled the way compileAggregate writes it.
import { addDays, addMonths, daysBetween, eachDay, monthEnd, monthStart, weekStart } from "@/lib/dates";
import type {
  BreakdownRow,
  ChartType,
  CheckId,
  CheckResult,
  CompareKind,
  Filters,
  GroupBy,
  MetricId,
  MetricInfo,
  PeriodKey,
  QueryComparison,
  QueryParams,
  QueryResult,
  QueryRow,
  TileQuery,
  TileWidth,
  Verdict,
  WeekRow,
  WidthRule,
} from "../types";
import mart from "../fixtures/mart.json";
import { CHECKS, METRICS } from "./pack";

type Col = "sessions" | "orders" | "revenue" | "ga4_purchases" | "ga4_revenue" | "platform_conversions" | "ad_spend";
export interface Row {
  date: string;
  channel: string;
  device: string;
  values: Record<Col, number>;
}

const COLS = mart.columns as string[];
export const MART: Row[] = (mart.rows as (string | number)[][]).map((r) => {
  const values = {} as Record<Col, number>;
  COLS.slice(3).forEach((c, i) => (values[c as Col] = Number(r[i + 3])));
  return { date: String(r[0]), channel: String(r[1]), device: String(r[2]), values };
});

export const RANGE = { from: MART[0]!.date, to: MART[MART.length - 1]!.date };
export const MART_ROWS = MART.length;
export const DIMENSIONS = { channel: ["organic", "direct", "google_ads", "meta_ads", "tiktok_ads", "email"], device: ["mobile", "desktop"] } as const;
export const TABLE = "daily_channel_device";
/** The demo's planted release (findings since-date). */
export const RELEASE = { date: "2026-10-09", label: { en: "v4.12 release", tr: "v4.12 sürümü" } };

let seq = 0;
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36).padStart(3, "0")}`;
const now = () => new Date().toISOString();
const clamp = (s: string) => (s < RANGE.from ? RANGE.from : s > RANGE.to ? RANGE.to : s);
const asList = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function normFilters(f?: Filters): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(f ?? {})) {
    const list = asList(v as string | string[]);
    if (list.length) out[k] = list;
  }
  return out;
}
const echo = (f: Record<string, string[]>): Filters => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.length === 1 ? v[0] : v])) as Filters;

function mergeWhere(...ws: (Record<string, string[]> | Partial<Record<string, string[]>> | null | undefined)[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const w of ws) {
    for (const [d, vals] of Object.entries(w ?? {})) {
      if (!vals) continue;
      out[d] = out[d] ? out[d]!.filter((v) => vals.includes(v)) : [...vals];
    }
  }
  return out;
}

const matches = (r: Row, where: Record<string, string[]>) => Object.entries(where).every(([d, vals]) => vals.includes(d === "channel" ? r.channel : r.device));

const DIM_SQL: Record<string, string> = { day: "date", week: "CAST(DATE_TRUNC('week', date) AS DATE)", month: "CAST(DATE_TRUNC('month', date) AS DATE)", channel: "channel", device: "device" };
const q = (v: string) => `'${v}'`;

/** The SQL compileAggregate writes for this metric, dims and window. */
export function compileSql(metric: MetricInfo, dims: string[], from: string, to: string, where: Record<string, string[]>, order?: "value") {
  const select = dims.map((d) => (DIM_SQL[d] === d ? d : `${DIM_SQL[d]} AS ${d}`));
  if ("sum" in metric.definition) select.push(`SUM(${metric.definition.sum}) AS value`);
  else {
    const { numerator: n, denominator: d } = metric.definition.ratio;
    select.push(`SUM(${n}) AS numerator`, `SUM(${d}) AS denominator`, `SUM(${n}) / NULLIF(SUM(${d}), 0) AS value`);
  }
  const conds = [`date BETWEEN DATE ${q(from)} AND DATE ${q(to)}`];
  for (const [d, vals] of Object.entries(where)) conds.push(vals.length === 1 ? `${d} = ${q(vals[0]!)}` : `${d} IN (${vals.map(q).join(", ")})`);
  const lines = [`-- metric ${metric.id} v${metric.version}`, "SELECT", select.map((s) => `  ${s}`).join(",\n"), `FROM ${TABLE}`, `WHERE ${conds.join("\n  AND ")}`];
  if (dims.length) lines.push(`GROUP BY ${dims.join(", ")}`, `ORDER BY ${order === "value" ? "value DESC" : dims.join(", ")}`);
  return lines.join("\n");
}

const keyOf = (r: Row, g: GroupBy) =>
  g === "day" ? r.date : g === "week" ? weekStart(r.date) : g === "month" ? monthStart(r.date) : g === "channel" ? r.channel : g === "device" ? r.device : "all";

/** Sums the metric's parts per group over [from, to]. */
function aggregate(metric: MetricInfo, g: GroupBy, from: string, to: string, where: Record<string, string[]>) {
  const groups = new Map<string, { n: number; d: number }>();
  const def = metric.definition;
  for (const r of MART) {
    if (r.date < from || r.date > to || !matches(r, where)) continue;
    const k = keyOf(r, g);
    const acc = groups.get(k) ?? { n: 0, d: 0 };
    if ("sum" in def) acc.n += r.values[def.sum as Col];
    else {
      acc.n += r.values[def.ratio.numerator as Col];
      acc.d += r.values[def.ratio.denominator as Col];
    }
    groups.set(k, acc);
  }
  const valueOf = (a: { n: number; d: number }) => ("sum" in def ? a.n : a.d ? a.n / a.d : null);
  let n = 0;
  let d = 0;
  for (const a of groups.values()) {
    n += a.n;
    d += a.d;
  }
  const total = "sum" in def ? n : d ? n / d : null;
  const rows: QueryRow[] = [...groups.entries()].map(([key, a]) => ({ key, value: valueOf(a) }));
  return { rows, total };
}

/** resolveQuery: defaults, clamping, complete weeks. */
export function resolveWindow(params: { group_by?: GroupBy; from?: string; to?: string }) {
  let to = params.to ? clamp(params.to) : RANGE.to;
  let from = params.from ? clamp(params.from) : clamp(addDays(to, -27));
  if (from > to) [from, to] = [to, from];
  if (params.group_by === "week") {
    let ws = weekStart(from);
    if (ws < from) ws = addDays(ws, 7);
    let we = addDays(weekStart(to), 6);
    if (we > to) we = addDays(weekStart(to), -1);
    if (ws < we) [from, to] = [ws, we];
  }
  return { from, to };
}

/** The comparison window: previous period shifted by whole weeks, or 364 days; null when it starts before the data. */
export function comparisonWindow(from: string, to: string, kind: CompareKind, monthToDate = false): { from: string; to: string; shift: number } | null {
  if (kind === "previous_year") {
    const f = addDays(from, -364);
    return f < RANGE.from ? null : { from: f, to: addDays(to, -364), shift: 364 };
  }
  if (monthToDate) {
    const f = addMonths(from, -1);
    const t = addMonths(to, -1);
    return f < RANGE.from ? null : { from: f, to: t, shift: daysBetween(f, from) };
  }
  const len = daysBetween(from, to) + 1;
  const shift = Math.ceil(len / 7) * 7;
  const f = addDays(from, -shift);
  return f < RANGE.from ? null : { from: f, to: addDays(to, -shift), shift };
}

const sortRows = (rows: QueryRow[], g: GroupBy) =>
  ["channel", "device"].includes(g) ? rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity)) : rows.sort((a, b) => (a.key < b.key ? -1 : 1));

export function runQuery(params: QueryParams & { month_to_date?: boolean }): QueryResult {
  const metric = METRICS[params.metric];
  const g = params.group_by ?? "none";
  const { from, to } = resolveWindow(params);
  const f = normFilters(params.filters);
  const where = mergeWhere(metric.where, f);
  const order = ["channel", "device"].includes(g) ? ("value" as const) : undefined;
  const dims = g === "none" ? [] : [g];
  const agg = aggregate(metric, g, from, to, where);
  const rows = g === "none" ? [] : sortRows(agg.rows, g);
  const result: QueryResult = {
    id: newId("q"),
    metric: metric.id,
    metric_version: metric.version,
    group_by: g,
    from,
    to,
    filters: echo(f),
    unit: metric.unit,
    rows,
    total: agg.total,
    sql: compileSql(metric, dims, from, to, where, order),
    dialect: "duckdb",
    ran_at: now(),
    provisional_from: addDays(RANGE.to, -2),
    partial: g === "month" && to < monthEnd(to) ? { key: monthStart(to), days: Number(to.slice(8)), of: Number(monthEnd(to).slice(8)) } : null,
  };
  if (params.compare) {
    const w = comparisonWindow(from, to, params.compare, params.month_to_date);
    if (!w) {
      result.comparison = null;
      result.comparison_note = "no_data";
    } else {
      const prev = aggregate(metric, g, w.from, w.to, where);
      const prevRows = g === "none" ? [] : sortRows(prev.rows, g);
      const delta = result.total != null && prev.total != null ? result.total - prev.total : null;
      const comparison: QueryComparison = {
        kind: params.compare,
        from: w.from,
        to: w.to,
        shift_days: w.shift,
        total: prev.total,
        rows: prevRows,
        delta,
        delta_pct: delta != null && prev.total ? delta / prev.total : null,
        sql: compileSql(metric, dims, w.from, w.to, where, order),
      };
      if (metric.unit === "pct" && delta != null) comparison.delta_points = delta * 100;
      result.comparison = comparison;
    }
  }
  return result;
}

// ---------------------------------------------------------------- the tally

const verdictOf = (expected: number, measured: number, tolerance: number): { delta_pct: number | null; verdict: Verdict } => {
  if (!expected) return { delta_pct: null, verdict: "insufficient_data" };
  const deltaPct = (measured - expected) / expected;
  return { delta_pct: deltaPct, verdict: Math.abs(deltaPct) <= tolerance + 1e-12 ? "adds_up" : "does_not_add_up" };
};

function dailySides(checkId: CheckId, from: string, to: string, filters?: Filters) {
  const check = CHECKS[checkId];
  const f = normFilters(filters);
  const side = (s: "expected" | "measured") => {
    const metric = METRICS[check[s].metric];
    const where = mergeWhere(metric.where, check.where as Record<string, string[]> | null, f);
    const col = ("sum" in metric.definition ? metric.definition.sum : "") as Col;
    const byKey = new Map<string, number>();
    for (const r of MART) {
      if (r.date < from || r.date > to || !matches(r, where)) continue;
      const k = `${r.date}|${r.device}`;
      byKey.set(k, (byKey.get(k) ?? 0) + r.values[col]);
    }
    return { metric, where, byKey };
  };
  return { check, f, exp: side("expected"), meas: side("measured") };
}

export function reconcile(checkId: CheckId, from?: string, to?: string, filters?: Filters, opts: { seriesLead?: number } = {}): CheckResult {
  let end = to ? clamp(to) : RANGE.to;
  let start = from ? clamp(from) : clamp(addDays(end, -13));
  if (start > end) [start, end] = [end, start];
  const { check, f, exp, meas } = dailySides(checkId, RANGE.from, end, filters);
  const sum = (m: Map<string, number>, keep: (date: string, device: string) => boolean) => {
    let s = 0;
    for (const [k, v] of m) {
      const [date, device] = k.split("|") as [string, string];
      if (keep(date, device)) s += v;
    }
    return s;
  };
  const inPeriod = (d: string) => d >= start && d <= end;
  const expected = sum(exp.byKey, inPeriod);
  const measured = sum(meas.byKey, inPeriod);
  const overall = verdictOf(expected, measured, check.tolerance);
  const segments = (f.device as string[] | undefined) ?? [...DIMENSIONS.device];
  const breakdown: BreakdownRow[] = segments.map((key) => {
    const keep = (d: string, dev: string) => inPeriod(d) && dev === key;
    const e = sum(exp.byKey, keep);
    const m = sum(meas.byKey, keep);
    return { key, expected: e, measured: m, ...verdictOf(e, m, check.tolerance) };
  });
  const day = (m: Map<string, number>, d: string) => sum(m, (date) => date === d);
  let since: string | null = null;
  for (const d of eachDay(RANGE.from, end)) {
    const e = day(exp.byKey, d);
    const r = e ? (day(meas.byKey, d) - e) / e : 0;
    if (Math.abs(r) > check.tolerance) since ??= d;
    else since = null;
  }
  const lead = opts.seriesLead ?? 14;
  const seriesFrom = clamp(addDays(start, -lead));
  const series = eachDay(seriesFrom, end).map((d) => ({ date: d, expected: day(exp.byKey, d), measured: day(meas.byKey, d) }));
  const dims = ["day", check.breakdown];
  return {
    id: newId("c"),
    check: check.id,
    label: check.label,
    from: start,
    to: end,
    filters: echo(f),
    unit: exp.metric.unit,
    expected: { metric: check.expected.metric, label: check.expected.label, value: expected },
    measured: { metric: check.measured.metric, label: check.measured.label, value: measured },
    delta: measured - expected,
    delta_pct: overall.delta_pct,
    tolerance: check.tolerance,
    verdict: overall.verdict,
    breakdown_by: check.breakdown,
    breakdown,
    out_of_tolerance_since: since,
    findings: overall.verdict === "does_not_add_up" ? check.findings.filter((x) => !x.since || x.since <= end).map((x) => ({ ...x, release: x.since ? "v4.12" : null })) : [],
    sql: { expected: compileSql(exp.metric, dims, RANGE.from, end, exp.where), measured: compileSql(meas.metric, dims, RANGE.from, end, meas.where) },
    dialect: "duckdb",
    ran_at: now(),
    series,
    series_from: seriesFrom,
    provisional_from: addDays(RANGE.to, -2),
  };
}

/** Complete weeks ending before `to` (B12 check_history). */
export function checkHistory(checkId: CheckId, weeks = 7, to = RANGE.to): WeekRow[] {
  const check = CHECKS[checkId];
  let lastSunday = addDays(weekStart(to), -1);
  if (addDays(weekStart(to), 6) <= to) lastSunday = addDays(weekStart(to), 6);
  const out: WeekRow[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const wTo = addDays(lastSunday, -7 * i);
    const wFrom = addDays(wTo, -6);
    if (wFrom < RANGE.from) continue;
    const r = reconcile(checkId, wFrom, wTo, undefined, { seriesLead: 0 });
    out.push({ from: wFrom, to: wTo, expected: r.expected.value, measured: r.measured.value, ...verdictOf(r.expected.value, r.measured.value, check.tolerance) });
  }
  return out;
}

// ---------------------------------------------------------------- periods

/** A dashboard period against the last day with data. */
export function resolvePeriod(p: PeriodKey): { from: string; to: string; monthToDate: boolean } {
  const to = RANGE.to;
  switch (p) {
    case "last_7":
      return { from: addDays(to, -6), to, monthToDate: false };
    case "last_14":
      return { from: addDays(to, -13), to, monthToDate: false };
    case "last_28":
      return { from: addDays(to, -27), to, monthToDate: false };
    case "last_90":
      return { from: clamp(addDays(to, -89)), to, monthToDate: false };
    case "last_week": {
      const end = addDays(weekStart(to), addDays(weekStart(to), 6) <= to ? 6 : -1);
      return { from: addDays(end, -6), to: end, monthToDate: false };
    }
    case "this_month":
      return { from: monthStart(to), to, monthToDate: true };
    case "last_month": {
      const end = addDays(monthStart(to), -1);
      return { from: monthStart(end), to: end, monthToDate: false };
    }
  }
}

// ---------------------------------------------------------------- chart grammar (06-data.md §2, 09-ux.md S08, B10)

export const additive = (m: MetricId) => "sum" in METRICS[m].definition;

export function validCharts(query: TileQuery): ChartType[] {
  if (query.type === "check") return ["tally", "both_lines", "split_bar", "table"];
  if (query.type === "explore") {
    const d = query.spec.dims;
    return d.length === 0 ? ["number"] : d.length === 2 ? ["table"] : d[0] === "week" ? ["column", "line", "table"] : ["split_bar", "table"];
  }
  const m = METRICS[query.metric];
  const g = query.group_by;
  if (g === "channel" || g === "device") return m.unit === "pct" || !additive(m.id) ? ["split_bar", "table", "number"] : ["split_bar", "table", "number"];
  if (m.unit === "pct") return ["line", "number", "table"];
  if (!additive(m.id)) return ["line", "number", "table"];
  return ["number", "line", "column", "area", "table"];
}

const WIDTHS: TileWidth[] = [3, 4, 6, 8, 12];

export function widthRules(chart: ChartType): WidthRule[] {
  return WIDTHS.map((w) => {
    if ((chart === "line" || chart === "both_lines") && w < 4) return { w, ok: false, reason: "line" };
    if ((chart === "column" || chart === "area") && w < 4) return { w, ok: false, reason: "column" };
    if (chart === "table" && w < 4) return { w, ok: false, reason: "table" };
    return { w, ok: true };
  });
}
