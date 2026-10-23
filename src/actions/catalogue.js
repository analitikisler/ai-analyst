// What the workspace knows: metrics, checks, sources, the workspace itself.
import { z } from "zod";
import { addDays } from "../format.js";
import { compileQuery, resolveQuery } from "../metrics/compile.js";
import { NAMES } from "../metrics/load.js";
import { defineAction } from "./registry.js";

const metricInfo = (m) => ({
  id: m.id,
  label: m.label,
  unit: m.unit,
  version: m.version,
  source: m.source,
  owner: m.owner,
  description: m.description,
  dimensions: m.dimensions,
  where: m.where ?? null,
  check: m.check ?? null,
});

defineAction({
  name: "list_metrics",
  description: "Lists the metrics in the pack: ids, labels, units, versions, descriptions and the check that verifies each.",
  kind: "read",
  input: z.object({}).strict(),
  run: (ctx) => Object.values(ctx.pack.metrics).map(metricInfo),
});

defineAction({
  name: "explain_metric",
  description: "The full definition of one metric, with the SQL it compiles to for the last 28 days and the check that verifies it.",
  kind: "read",
  input: (pack) => z.object({ metric: z.enum(Object.keys(pack.metrics)) }).strict(),
  async run(ctx, { metric: id }) {
    const m = ctx.pack.metrics[id];
    const range = await ctx.warehouse.range();
    const q = resolveQuery(ctx.pack, { metric: id, from: addDays(range.to, -27), to: range.to }, range);
    const check = m.check ? ctx.pack.checks[m.check] : null;
    return {
      ...metricInfo(m),
      definition: m.sum ? { sum: m.sum } : { ratio: m.ratio },
      model: m.model,
      sql_example: compileQuery(ctx.pack, q, ctx.warehouse),
      dialect: ctx.warehouse.dialect,
      check: check ? { id: check.id, label: check.label, tolerance: check.tolerance } : null,
    };
  },
});

defineAction({
  name: "list_checks",
  description: "Lists the checks: which metric is expected (the system that owns the number), which is measured, the tolerance and the breakdown dimension.",
  kind: "read",
  input: z.object({}).strict(),
  run: (ctx) =>
    Object.values(ctx.pack.checks).map((c) => ({
      id: c.id,
      label: c.label,
      expected: c.expected,
      measured: c.measured,
      where: c.where ?? null,
      tolerance: c.tolerance,
      breakdown: c.breakdown,
      findings: ctx.store.findingsFor(c.id).map(({ id, source, text, since }) => ({ id, source, text, since })),
    })),
});

// The demo shop's upstream systems. With a real warehouse only the mart itself is known.
const DEMO_SOURCES = [
  { id: "ga4", name: { en: "GA4 BigQuery export", tr: "GA4 BigQuery dışa aktarımı" }, detail: "analytics_312 · events_*", connected: true, rows: 41820000, synced_at: "06:00" },
  { id: "backoffice", name: NAMES.source.backoffice, detail: "orders, order_items", connected: true, rows: 118400, synced_at: "06:00" },
  { id: "google_ads", name: { en: "Google Ads", tr: "Google Ads" }, detail: "campaign, cost, conversions", connected: true, rows: 9120, synced_at: "05:40" },
  { id: "meta_ads", name: { en: "Meta Ads", tr: "Meta Ads" }, detail: "campaign, spend, purchases", connected: true, rows: 7340, synced_at: "05:40" },
  { id: "tiktok_ads", name: { en: "TikTok Ads", tr: "TikTok Ads" }, detail: "campaign, spend, conversions", connected: true, rows: 2210, synced_at: "05:45" },
  { id: "search_console", name: { en: "Search Console", tr: "Search Console" }, detail: "bulk export", connected: false, rows: null, synced_at: null },
  { id: "ai_tag_debugger", name: { en: "AI Tag Debugger", tr: "AI Tag Debugger" }, detail: "audit findings", connected: true, rows: 14, synced_at: "06:10" },
];

defineAction({
  name: "list_sources",
  description: "The connected sources, with row counts and last sync, and the mart every metric reads.",
  kind: "read",
  input: z.object({}).strict(),
  async run(ctx) {
    const range = await ctx.warehouse.range();
    return {
      demo: ctx.warehouse.demo,
      warehouse: { dialect: ctx.warehouse.dialect, table: ctx.warehouse.table, rows: range.rows, data_from: range.from, data_to: range.to, refreshed_at: ctx.warehouse.refreshedAt() },
      sources: ctx.warehouse.demo
        ? DEMO_SOURCES
        : [...new Set(Object.values(ctx.pack.metrics).flatMap((m) => m.source.split("+")))].map((id) => ({ id, name: NAMES.source[id], detail: ctx.warehouse.table, connected: true, rows: null, synced_at: null })),
    };
  },
});

/** The workspace header: name, data range, counts. Also used by GET /api/state. */
export async function workspaceInfo(ctx) {
  const range = await ctx.warehouse.range();
  const alerts = ctx.store.listAlerts();
  return {
    name: ctx.config?.workspace ?? "Örnek Moda",
    demo: ctx.warehouse.demo,
    dialect: ctx.warehouse.dialect,
    data_from: range.from,
    data_to: range.to,
    refreshed_at: ctx.warehouse.refreshedAt(),
    counts: {
      metrics: Object.keys(ctx.pack.metrics).length,
      checks: Object.keys(ctx.pack.checks).length,
      pins: ctx.store.listPins().length,
      alerts: alerts.length,
      pending_alerts: alerts.filter((a) => a.status === "pending").length,
    },
  };
}

defineAction({
  name: "get_workspace",
  description: "The workspace: its name, whether it is demo data, the data range and counts of metrics, checks, pins and alerts.",
  kind: "read",
  input: z.object({}).strict(),
  run: workspaceInfo,
});
