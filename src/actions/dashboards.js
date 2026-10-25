// Dashboards and tiles. Every change logs Activity with an undo.
import { z } from "zod";
import { dashboardResult, findTile, getDashboard, insertDashboard, lastDashboardId, listDashboards, publicDashboard, publicTile, removeDashboard, saveDashboard, touch } from "../dashboards.js";
import { comparisonWindow, PERIODS, resolvePeriod, validCharts, widthRules, CHART_TYPES } from "../engine.js";
import { AppError } from "../errors.js";
import { newId } from "../store/store.js";
import { ACT, CHART_NAMES, COMPARE_NAMES, PERIOD_NAMES, T } from "../text.js";
import { pinAnswer } from "./workspace.js";
import { defineAction } from "./registry.js";

const name = z.string().max(80);
const id = z.string().min(1).max(64);
const summary = (d) => ({ id: d.id, name: d.name, example: d.example, tiles: d.tiles.length });

defineAction({
  name: "list_dashboards",
  description: "The dashboards, in order: dashboard_id, name and the number of tiles. Call it before propose_pin when the person names a dashboard.",
  kind: "read",
  agent: true,
  mcp: false,
  input: z.object({}).strict(),
  run: (ctx) => listDashboards(ctx.store).map(summary),
  forModel: (list) => list.map((d) => ({ dashboard_id: d.id, name: d.name, tiles: d.tiles })),
  summary: (list) => T(`Read the dashboards (${list.length})`, `Dashboard’lar okundu (${list.length})`),
});

defineAction({
  name: "get_dashboard",
  description: "One dashboard with every tile's figures for its period, and every check over that period.",
  kind: "read",
  mcp: false,
  input: z.object({ dashboard_id: id }).strict(),
  async run(ctx, { dashboard_id }) {
    const dash = getDashboard(ctx.store, dashboard_id);
    ctx.store.setMeta("last_dashboard", dash.id);
    return dashboardResult(ctx, dash);
  },
});

defineAction({
  name: "create_dashboard",
  description: "Creates an empty dashboard.",
  kind: "write",
  input: z.object({ name }).strict(),
  run(ctx, { name: raw }) {
    const n = raw.trim();
    if (!n) throw new AppError("invalid_input", "A dashboard needs a name.");
    const at = new Date().toISOString();
    const d = { id: newId("db"), name: T(n, n), example: false, period: "last_28", compare: "previous_period", tiles: [], created_at: at, updated_at: at, version: 1 };
    insertDashboard(ctx.store, d);
    ctx.store.setMeta("last_dashboard", d.id);
    ctx.log(ACT.dashboard_created(d.name), { kind: "dashboard_create", dashboard_id: d.id });
    return publicDashboard(d);
  },
});

defineAction({
  name: "rename_dashboard",
  description: "Renames a dashboard.",
  kind: "write",
  input: z.object({ dashboard_id: id, name }).strict(),
  run(ctx, { dashboard_id, name: raw }) {
    const d = getDashboard(ctx.store, dashboard_id);
    const n = raw.trim();
    if (!n) throw new AppError("invalid_input", "A dashboard needs a name.");
    const before = d.name;
    d.name = T(n, n);
    touch(d);
    saveDashboard(ctx.store, d);
    const act = ctx.log(ACT.dashboard_renamed(before, d.name), { kind: "dashboard_rename", dashboard_id: d.id, name: before });
    return { dashboard: publicDashboard(d), activity_id: act.id };
  },
});

defineAction({
  name: "delete_dashboard",
  description: "Deletes a dashboard. One always stays.",
  kind: "write",
  input: z.object({ dashboard_id: id }).strict(),
  run(ctx, { dashboard_id }) {
    const all = listDashboards(ctx.store);
    if (all.length <= 1) throw new AppError("only_one", "One dashboard always stays.");
    const d = getDashboard(ctx.store, dashboard_id);
    const index = all.findIndex((x) => x.id === dashboard_id);
    removeDashboard(ctx.store, dashboard_id);
    const next = listDashboards(ctx.store)[Math.max(0, index - 1)].id;
    ctx.store.setMeta("last_dashboard", next);
    ctx.log(ACT.dashboard_deleted(d.name), { kind: "dashboard_delete", dashboard: d, index });
    return { deleted: true, next };
  },
});

defineAction({
  name: "set_dashboard_period",
  description: "Sets a dashboard's period and what it is compared with.",
  kind: "write",
  input: z.object({ dashboard_id: id, period: z.enum(PERIODS).optional(), compare: z.enum(["off", "previous_period", "previous_year"]).optional() }).strict(),
  async run(ctx, { dashboard_id, period, compare }) {
    const d = getDashboard(ctx.store, dashboard_id);
    const range = await ctx.warehouse.range();
    if (compare === "previous_year" && !comparisonWindow(range, resolvePeriod(range, period ?? d.period).from, range.to, "previous_year")) throw new AppError("no_data", "Data starts too late for a year earlier.");
    const before = { period: d.period, compare: d.compare };
    d.period = period ?? d.period;
    d.compare = compare ?? d.compare;
    touch(d);
    saveDashboard(ctx.store, d);
    const act = ctx.log(ACT.period(d.name, PERIOD_NAMES[d.period], COMPARE_NAMES[d.compare]), { kind: "period", dashboard_id: d.id, ...before });
    return { dashboard: publicDashboard(d), activity_id: act.id };
  },
});

defineAction({
  name: "pin_answer",
  description: "Pins a published answer to a dashboard as a tile that follows the dashboard's period. Only a person pins; the agent proposes a pin for approval.",
  kind: "write",
  input: z.object({ answer_id: id, dashboard_id: id.optional() }).strict(),
  run(ctx, { answer_id, dashboard_id }) {
    const r = pinAnswer(ctx, answer_id, dashboard_id, ctx.actor);
    return { tile: publicTile(r.tile), activity_id: r.activity_id };
  },
});

defineAction({
  name: "update_tile",
  description: "Changes a tile's chart, size or title (one at a time).",
  kind: "write",
  input: z
    .object({
      tile_id: id,
      chart: z.enum(CHART_TYPES).optional(),
      size: z.object({ w: z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]), h: z.union([z.literal(1), z.literal(2)]) }).strict().optional(),
      title: name.optional(),
    })
    .strict(),
  run(ctx, { tile_id, chart, size, title }) {
    const { dash, tile } = findTile(ctx.store, tile_id);
    const before = structuredClone(tile);
    let detail;
    if (chart) {
      if (!validCharts(ctx.pack, tile.query).includes(chart)) throw new AppError("invalid_chart", "That chart type does not suit this figure.");
      tile.chart = chart;
      if (!widthRules(chart).find((r) => r.w === tile.size.w)?.ok) tile.size = { ...tile.size, w: 4 };
      detail = ACT.chart(tile.title, CHART_NAMES[chart]);
    } else if (size) {
      if (!widthRules(tile.chart).find((r) => r.w === size.w)?.ok) throw new AppError("invalid_size", "That width does not suit this chart.");
      tile.size = size;
      detail = ACT.resized(tile.title, size.w, size.h);
    } else if (title != null) {
      const n = title.trim();
      if (!n) throw new AppError("invalid_input", "A tile needs a name.");
      tile.title = T(n, n);
      detail = ACT.renamed(before.title, tile.title);
    } else throw new AppError("invalid_input", "Nothing to change.");
    tile.version += 1;
    touch(dash);
    saveDashboard(ctx.store, dash);
    const act = ctx.log(detail, { kind: "tile_update", tile: before });
    return { tile: publicTile(tile), activity_id: act.id };
  },
});

defineAction({
  name: "move_tile",
  description: "Moves a tile to a position on its dashboard.",
  kind: "write",
  input: z.object({ tile_id: id, to_index: z.number().int().min(0).max(1000) }).strict(),
  run(ctx, { tile_id, to_index }) {
    const { dash, tile, index } = findTile(ctx.store, tile_id);
    const order = dash.tiles.map((t) => t.id);
    const target = Math.max(0, Math.min(to_index, dash.tiles.length - 1));
    if (target === index) return { dashboard: publicDashboard(dash), activity_id: "" };
    dash.tiles.splice(index, 1);
    dash.tiles.splice(target, 0, tile);
    const other = dash.tiles[target + 1] ?? null;
    touch(dash);
    saveDashboard(ctx.store, dash);
    const act = ctx.log(ACT.moved(tile.title, other?.title ?? null, !other), { kind: "tile_order", dashboard_id: dash.id, order });
    return { dashboard: publicDashboard(dash), activity_id: act.id };
  },
});

defineAction({
  name: "duplicate_tile",
  description: "Duplicates a tile next to itself.",
  kind: "write",
  input: z.object({ tile_id: id }).strict(),
  run(ctx, { tile_id }) {
    const { dash, tile, index } = findTile(ctx.store, tile_id);
    const copy = { ...structuredClone(tile), id: newId("pin"), created_by: "person", created_at: new Date().toISOString(), version: 1 };
    dash.tiles.splice(index + 1, 0, copy);
    touch(dash);
    saveDashboard(ctx.store, dash);
    const act = ctx.log(ACT.duplicated(tile.title), { kind: "tile_add", tile_id: copy.id });
    return { tile: publicTile(copy), activity_id: act.id };
  },
});

defineAction({
  name: "remove_tile",
  description: "Removes a tile from its dashboard.",
  kind: "write",
  input: z.object({ tile_id: id }).strict(),
  run(ctx, { tile_id }) {
    const { dash, tile, index } = findTile(ctx.store, tile_id);
    dash.tiles.splice(index, 1);
    touch(dash);
    saveDashboard(ctx.store, dash);
    const act = ctx.log(ACT.removed(tile.title, dash.name), { kind: "tile_remove", tile, index });
    return { removed: true, activity_id: act.id };
  },
});

export { lastDashboardId };
