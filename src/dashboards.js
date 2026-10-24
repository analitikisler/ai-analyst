// Dashboards and tiles. A tile keeps the query, not a frozen answer, so it follows the dashboard's period and
// compare setting; its chart follows the chart grammar (engine.validCharts) and its width the width rules.
import { allWidthRules, comparisonWindow, resolvePeriod, runQuery, runReconcile, validCharts } from "./engine.js";
import { AppError } from "./errors.js";
import { exploreQuery } from "./explore/run.js";
import { newId } from "./store/store.js";
import { T } from "./text.js";

const now = () => new Date().toISOString();
const ORDER = "dashboard_order";

export function listDashboards(store) {
  const order = store.getMeta(ORDER) ?? [];
  const all = store.list("dashboards", { order: "ASC" });
  const byId = new Map(all.map((d) => [d.id, d]));
  return [...order.map((id) => byId.get(id)).filter(Boolean), ...all.filter((d) => !order.includes(d.id))];
}
export function getDashboard(store, id) {
  const d = store.get("dashboards", id);
  if (!d) throw new AppError("not_found", `Unknown dashboard "${id}".`);
  return d;
}
export const saveDashboard = (store, d) => store.put("dashboards", d);
export function insertDashboard(store, d, index = null) {
  const order = listDashboards(store).map((x) => x.id).filter((id) => id !== d.id);
  order.splice(index == null ? order.length : Math.min(index, order.length), 0, d.id);
  store.put("dashboards", d);
  store.setMeta(ORDER, order);
}
export function removeDashboard(store, id) {
  store.remove("dashboards", id);
  store.setMeta(ORDER, (store.getMeta(ORDER) ?? []).filter((x) => x !== id));
}
export function findTile(store, tileId) {
  for (const dash of listDashboards(store)) {
    const index = dash.tiles.findIndex((t) => t.id === tileId);
    if (index >= 0) return { dash, tile: dash.tiles[index], index };
  }
  throw new AppError("not_found", `Unknown tile "${tileId}".`);
}
/** The first change clears the Example badge. */
export function touch(d) {
  d.updated_at = now();
  d.version += 1;
  d.example = false;
}
export const lastDashboardId = (store) => {
  const id = store.getMeta("last_dashboard");
  return id && store.get("dashboards", id) ? id : listDashboards(store)[0]?.id ?? null;
};

const seedTile = (dashboard_id, id, title, query, chart, w, h, at) => ({ id, dashboard_id, title, answer_id: null, query, chart, size: { w, h }, created_by: "demo", created_at: at, version: 1 });

/** The example dashboard every workspace starts with. */
export function exampleDashboard(pack, at = now()) {
  const id = "db_example";
  return {
    id,
    name: T("Shop overview", "Mağaza özeti"),
    example: true,
    period: "last_28",
    compare: "previous_period",
    created_at: at,
    updated_at: at,
    version: 1,
    tiles: [
      seedTile(id, "pin_revenue", T("Revenue", "Ciro"), { type: "metric", metric: "revenue", group_by: "none" }, "number", 3, 1, at),
      seedTile(id, "pin_orders", T("Orders", "Sipariş"), { type: "metric", metric: "orders", group_by: "none" }, "number", 3, 1, at),
      seedTile(id, "pin_ga4", pack.checks.ga4_vs_orders.label, { type: "check", check: "ga4_vs_orders" }, "tally", 6, 2, at),
      seedTile(id, "pin_meta", pack.checks.meta_vs_orders.label, { type: "check", check: "meta_vs_orders" }, "tally", 6, 1, at),
      seedTile(id, "pin_rev_day", T("Revenue by day", "Günlük ciro"), { type: "metric", metric: "revenue", group_by: "day" }, "line", 8, 2, at),
      seedTile(id, "pin_roas", T("ROAS by channel", "Kanala göre ROAS"), { type: "metric", metric: "roas", group_by: "channel" }, "split_bar", 4, 2, at),
    ],
  };
}

/** The tile a pinned answer becomes: the query, the grammar's default chart and size. */
export function tileFromAnswer(pack, a, dashboard_id, actor = "person") {
  const base = { id: newId("pin"), dashboard_id, answer_id: a.id, created_by: actor, created_at: now(), version: 1 };
  if (a.explore) {
    const shape = a.explore.shape;
    const chart = shape === "number" ? "number" : shape === "series" ? "column" : shape === "category" ? "split_bar" : "table";
    // The SQL stays with the tile on the server, so the tile re-runs the same guarded query.
    return { ...base, title: a.title, query: { type: "explore", spec: a.explore.spec, sql: a.explore.sql, unit: a.explore.unit, label: a.explore.label }, chart, size: shape === "number" ? { w: 3, h: 1 } : { w: 6, h: 2 } };
  }
  if (a.check) {
    const ck = pack.checks[a.check.check];
    if (a.kind === "check_split") {
      return { ...base, title: ck.id === "ga4_vs_orders" ? T("GA4 against orders by device", "Cihaza göre GA4 ve siparişler") : { en: `${ck.label.en} by device`, tr: `Cihaza göre ${ck.label.tr}` }, query: { type: "check", check: ck.id, split: "device" }, chart: "split_bar", size: { w: 6, h: 1 } };
    }
    return { ...base, title: ck.label, query: { type: "check", check: ck.id }, chart: "tally", size: { w: 6, h: 1 } };
  }
  const q = a.query;
  const m = pack.metrics[q.metric];
  const g = q.group_by;
  const lower = m.label.tr.toLocaleLowerCase("tr");
  const title =
    g === "none" ? m.label : g === "channel" ? { en: `${m.label.en} by channel`, tr: `Kanala göre ${lower}` } : g === "device" ? { en: `${m.label.en} by device`, tr: `Cihaza göre ${lower}` } : g === "week" ? { en: `${m.label.en} by week`, tr: `Haftalık ${lower}` } : g === "month" ? { en: `${m.label.en} by month`, tr: `Aylık ${lower}` } : { en: `${m.label.en} by day`, tr: `Günlük ${lower}` };
  const chart = g === "none" ? "number" : g === "channel" || g === "device" ? "split_bar" : g === "week" || g === "month" ? "column" : "line";
  const size = chart === "number" ? { w: 3, h: 1 } : chart === "split_bar" ? { w: 4, h: 2 } : { w: 6, h: 2 };
  return { ...base, title, query: { type: "metric", metric: q.metric, group_by: g, filters: q.filters }, chart, size };
}

/** A tile as the client sees it: the server-only SQL of an explore tile stays here. */
export const publicTile = (t) => (t.query.type === "explore" ? { ...t, query: { type: "explore", spec: t.query.spec } } : t);
export const publicDashboard = (d) => ({ ...d, tiles: d.tiles.map(publicTile) });

export async function tileResult(ctx, dash, tile, range) {
  const p = resolvePeriod(range, dash.period);
  const compare = dash.compare === "off" ? undefined : dash.compare;
  const hits = ctx.warehouse.stats?.misses ?? 0;
  const base = { tile_id: tile.id, from: p.from, to: p.to, valid_charts: validCharts(ctx.pack, tile.query), width_rules: allWidthRules(), ran_at: now(), data_to: range.to };
  const done = (r) => ({ ...r, cached: ctx.warehouse.stats ? ctx.warehouse.stats.misses === hits : false });
  try {
    if (tile.query.type === "check") {
      const check = await runReconcile(ctx, { check: tile.query.check, from: p.from, to: p.to, filters: tile.query.filters }, { save: false });
      const w = compare ? comparisonWindow(range, p.from, p.to, compare, p.monthToDate) : null;
      const previous = w ? await runReconcile(ctx, { check: tile.query.check, from: w.from, to: w.to, filters: tile.query.filters }, { save: false, seriesLead: 0 }) : null;
      return done({ ...base, check, previous_check: previous });
    }
    if (tile.query.type === "explore") {
      const { runExploreSql } = await import("./explore/run.js");
      if (!tile.query.sql) throw new AppError("explore_failed", "This tile has no stored query.");
      const x = await runExploreSql(ctx, { sql: tile.query.sql, ...tile.query.spec, unit: tile.query.unit, label: tile.query.label }, ctx.pack);
      return done({ ...base, from: x.spec.from, to: x.spec.to, explore: x, query: exploreQuery(x, ctx.warehouse.dialect) });
    }
    const q = tile.query;
    const query = await runQuery(ctx, { metric: q.metric, group_by: q.group_by, from: p.from, to: p.to, filters: q.filters, compare, month_to_date: p.monthToDate }, { save: false });
    const series = q.group_by === "none" ? await runQuery(ctx, { metric: q.metric, group_by: "day", from: p.from, to: p.to, filters: q.filters }, { save: false }) : undefined;
    return done({ ...base, query, ...(series ? { series } : {}) });
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return { ...base, cached: false, error: { code: err.code, message: err.message } };
  }
}

export async function dashboardResult(ctx, dash) {
  const range = await ctx.warehouse.range();
  const p = resolvePeriod(range, dash.period);
  const w = dash.compare === "off" ? null : comparisonWindow(range, p.from, p.to, dash.compare, p.monthToDate);
  const tiles = [];
  for (const t of dash.tiles) tiles.push(await tileResult(ctx, dash, t, range));
  const checks = [];
  for (const c of Object.keys(ctx.pack.checks)) checks.push(await runReconcile(ctx, { check: c, from: p.from, to: p.to }, { save: false }));
  return {
    dashboard: publicDashboard(dash),
    from: p.from,
    to: p.to,
    compare_from: w?.from ?? null,
    compare_to: w?.to ?? null,
    compare_note: dash.compare !== "off" && !w ? "no_data" : null,
    data_to: range.to,
    tiles,
    checks,
  };
}
