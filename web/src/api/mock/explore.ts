// Exploratory answers for the fixture API (owner round 4): the one read-only SQL query a model would write against the
// mart, computed here from the real mart rows (fixtures/mart.json), never typed in. Shapes follow the chart rules:
// no dimension is a number, weeks are a series, one other dimension is a by-category bar, two dimensions a table.
import { addMonths, parseISO, weekStart } from "@/lib/dates";
import type { ExploreResult, ExploreSpec, GroupBy, MetricId, QueryResult, Text, Unit } from "../types";
import { MART, newId, TABLE, type Row } from "./engine";
import { METRICS } from "./pack";
import { T } from "./text";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const weekday = (date: string) => WEEKDAYS[parseISO(date).getUTCDay()]!;

const MEASURE: Record<ExploreSpec["measure"], { metric: MetricId; unit: Unit; label: Text; sql: string }> = {
  revenue: { metric: "revenue", unit: "try", label: METRICS.revenue.label, sql: "SUM(revenue) AS revenue" },
  orders: { metric: "orders", unit: "count", label: METRICS.orders.label, sql: "SUM(orders) AS orders" },
  sessions: { metric: "sessions", unit: "count", label: METRICS.sessions.label, sql: "SUM(sessions) AS sessions" },
  ad_spend: { metric: "ad_spend", unit: "try", label: METRICS.ad_spend.label, sql: "SUM(ad_spend) AS ad_spend" },
  aov: { metric: "aov", unit: "try", label: METRICS.aov.label, sql: "SUM(revenue) / NULLIF(SUM(orders), 0) AS average_order_value" },
  spend_growth: { metric: "ad_spend", unit: "pct", label: T("Ad spend growth", "Reklam harcaması artışı"), sql: "" },
  // Only a model's own query measures "something else" (the server labels it); the mock never plans one.
  other: { metric: "revenue", unit: "count", label: T("Value", "Değer"), sql: "NULL AS value" },
};

export const DIM_LABEL: Record<ExploreSpec["dims"][number], Text> = {
  weekday: T("Weekday", "Hafta günü"),
  channel: T("Channel", "Kanal"),
  device: T("Device", "Cihaz"),
  week: T("Week", "Hafta"),
  other: T("Group", "Grup"),
};
const DIM_SQL: Record<ExploreSpec["dims"][number], string> = {
  weekday: "strftime(date, '%a') AS weekday",
  channel: "channel",
  device: "device",
  week: "date_trunc('week', date) AS week",
  other: "",
};

/** The mart's columns, for the card when no query can be written. */
export const MART_COLUMNS = ["date", "channel", "device", "sessions", "orders", "revenue", "ga4_purchases", "ga4_revenue", "platform_conversions", "ad_spend"];

const keyOf = (r: Row, d: ExploreSpec["dims"][number]) => (d === "weekday" ? weekday(r.date) : d === "week" ? weekStart(r.date) : d === "channel" ? r.channel : d === "device" ? r.device : "");
const within = (from: string, to: string) => MART.filter((r) => r.date >= from && r.date <= to);

function measureOf(rows: Row[], m: ExploreSpec["measure"]): number | null {
  const sum = (c: keyof Row["values"]) => rows.reduce((s, r) => s + r.values[c], 0);
  if (m === "aov") {
    const o = sum("orders");
    return o ? sum("revenue") / o : null;
  }
  if (m === "spend_growth" || m === "other") return null;
  return sum(m);
}

function group(rows: Row[], dims: ExploreSpec["dims"]): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const r of rows) {
    const k = dims.map((d) => keyOf(r, d)).join("|");
    out.set(k, [...(out.get(k) ?? []), r]);
  }
  return out;
}

function sqlOf(spec: ExploreSpec): string {
  const where = `WHERE date BETWEEN DATE '${spec.from}' AND DATE '${spec.to}'`;
  if (spec.measure === "spend_growth") {
    return [
      "WITH spend AS (",
      "  SELECT channel,",
      `    SUM(CASE WHEN date BETWEEN DATE '${spec.from}' AND DATE '${spec.to}' THEN ad_spend END) AS this_period,`,
      `    SUM(CASE WHEN date BETWEEN DATE '${addMonths(spec.from, -1)}' AND DATE '${addMonths(spec.to, -1)}' THEN ad_spend END) AS last_period`,
      `  FROM ${TABLE}`,
      "  GROUP BY channel",
      ")",
      "SELECT channel, this_period / NULLIF(last_period, 0) - 1 AS growth",
      "FROM spend",
      "WHERE last_period > 0",
      "ORDER BY growth DESC",
      "LIMIT 1000",
    ].join("\n");
  }
  const dims = spec.dims.map((d) => DIM_SQL[d]);
  const names = spec.dims.map((d) => (d === "weekday" || d === "week" ? d : d));
  return [
    `SELECT ${[...dims, MEASURE[spec.measure].sql].join(", ")}`,
    `FROM ${TABLE}`,
    where,
    ...(names.length ? [`GROUP BY ${names.join(", ")}`, `ORDER BY ${spec.dims[0] === "week" ? "week" : `${MEASURE[spec.measure].sql.split(" AS ")[1]} DESC`}`] : []),
    "LIMIT 1000",
  ].join("\n");
}

export function runExplore(spec: ExploreSpec): ExploreResult {
  const m = MEASURE[spec.measure];
  const rows = within(spec.from, spec.to);
  let out: (string | number | null)[][];
  if (spec.measure === "spend_growth") {
    const prev = group(within(addMonths(spec.from, -1), addMonths(spec.to, -1)), ["channel"]);
    out = [...group(rows, ["channel"]).entries()]
      .map(([k, rs]) => {
        const cur = measureOf(rs, "ad_spend")!;
        const before = measureOf(prev.get(k) ?? [], "ad_spend") ?? 0;
        return [k, before > 0 ? cur / before - 1 : null] as (string | number | null)[];
      })
      .filter((r) => r[1] != null);
  } else if (!spec.dims.length) {
    out = [[measureOf(rows, spec.measure)]];
  } else {
    out = [...group(rows, spec.dims).entries()].map(([k, rs]) => [...k.split("|"), measureOf(rs, spec.measure)]);
  }
  const vi = spec.measure === "spend_growth" ? 1 : spec.dims.length;
  if (spec.dims[0] === "week") out.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  else out.sort((a, b) => Number(b[vi] ?? -Infinity) - Number(a[vi] ?? -Infinity));
  const shape: ExploreResult["shape"] = spec.dims.length === 0 ? "number" : spec.dims.length > 1 ? "table" : spec.dims[0] === "week" ? "series" : "category";
  return {
    spec,
    shape,
    unit: m.unit,
    label: m.label,
    columns: [...spec.dims.map((d) => DIM_LABEL[d]), m.label],
    rows: out.slice(0, 1000),
    sql: sqlOf(spec),
    bytes: rows.length * (2 + spec.dims.length) * 8 + 4096,
    tables: [TABLE],
  };
}

/** The result as a query result, so the existing number, series and bar charts can draw it. */
export function exploreQuery(x: ExploreResult): QueryResult {
  const m = MEASURE[x.spec.measure];
  const value = (r: (string | number | null)[]) => r[r.length - 1] as number | null;
  const group_by: GroupBy = x.shape === "number" ? "none" : x.shape === "series" ? "week" : "channel";
  return {
    id: newId("q"),
    metric: m.metric,
    metric_version: 1,
    group_by,
    from: x.spec.from,
    to: x.spec.to,
    filters: {},
    unit: x.unit,
    rows: x.shape === "number" || x.shape === "table" ? [] : x.rows.map((r) => ({ key: String(r[0]), value: value(r) })),
    total: x.shape === "number" ? value(x.rows[0] ?? [null]) : null,
    sql: x.sql,
    dialect: "duckdb",
    ran_at: new Date().toISOString(),
    comparison: null,
  };
}
