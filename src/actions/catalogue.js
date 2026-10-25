// What the workspace knows: sources, suggestions, metrics (the data dictionary), checks, the workspace itself.
import { z } from "zod";
import { agentMode } from "../agent/mode.js";
import { listDashboards } from "../dashboards.js";
import { runQuery, runReconcile } from "../engine.js";
import { AppError } from "../errors.js";
import { workspaceName } from "../config.js";
import { addDays } from "../format.js";
import { compileQuery, resolveQuery } from "../metrics/compile.js";
import { listOverlay, writeOverlay } from "../metrics/overlay.js";
import { ACT, CROSS_Q, EXPLORE_Q, FOLLOW, NEAR, SUGGEST, T } from "../text.js";
import { availableColumns, checkAnswerable, metricAnswerable } from "../connectors/index.js";
import { defineAction } from "./registry.js";

export const metricInfo = (m) => ({
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
  definition: m.sum ? { sum: m.sum } : { ratio: m.ratio },
});

/** Which tracking checks use a metric, and on which side. */
export function checksUsing(pack, id) {
  const out = [];
  for (const c of Object.values(pack.checks)) {
    if (c.expected.metric === id) out.push({ id: c.id, role: "source" });
    else if (c.measured.metric === id) out.push({ id: c.id, role: "measured" });
  }
  return out;
}

const SOURCE_ROW = {
  backoffice: T("Back office, by order date", "Sipariş paneli, sipariş tarihine göre"),
  ga4: T("GA4 BigQuery export", "GA4 BigQuery dışa aktarımı"),
  ads: T("Google Ads, Meta Ads and TikTok Ads, as each reports it", "Google Ads, Meta Ads ve TikTok Ads, her biri kendi bildirdiği gibi"),
};

/** The definition in rows, derived from the pack: formula, table, grain, source, timezone, filters, rules. */
export function definitionRows(m) {
  const formula = m.sum ? `SUM(${m.sum})` : `SUM(${m.ratio.numerator}) / SUM(${m.ratio.denominator})`;
  const rows = [
    { label: T("Formula", "Formül"), value: T(formula, formula) },
    { label: T("Table", "Tablo"), value: T(m.model, m.model) },
    { label: T("Grain", "Ayrıntı düzeyi"), value: T("Day × channel × device", "Gün × kanal × cihaz") },
    { label: T("Source", "Kaynak"), value: { en: m.source.split("+").map((s) => SOURCE_ROW[s]?.en ?? s).join("; "), tr: m.source.split("+").map((s) => SOURCE_ROW[s]?.tr ?? s).join("; ") } },
    { label: T("Timezone", "Saat dilimi"), value: T("Europe/Istanbul; a day is midnight to midnight there", "Europe/Istanbul; gün oradaki gece yarısından gece yarısına") },
    { label: T("Filters", "Filtreler"), value: m.where?.channel ? { en: `channel in ${m.where.channel.join(", ")}`, tr: `kanal: ${m.where.channel.join(", ")}` } : T("None", "Yok") },
  ];
  if (["orders", "revenue", "aov"].includes(m.id)) rows.push({ label: T("Excluded", "Hariç"), value: T("Test orders. Cancelled orders are kept (since Orders v3)", "Test siparişleri. İptal edilen siparişler dahil (Sipariş v3’ten beri)") });
  if (m.unit === "try") rows.push({ label: T("VAT", "KDV"), value: m.id === "ad_spend" ? T("Ad spend has no VAT; converted to TRY at the day’s TCMB rate", "Reklam harcamasında KDV yok; günün TCMB kuruyla TRY’ye çevrilir") : T("Includes 20% VAT; shipping excluded", "%20 KDV dahil; kargo hariç") });
  if (m.source.includes("ga4")) rows.push({ label: T("Deduplication", "Tekilleştirme"), value: T("Once per transaction_id; sessions by user_pseudo_id and ga_session_id", "transaction_id başına bir kez; oturumlar user_pseudo_id ve ga_session_id ile") });
  if (m.where?.channel || m.id === "conversion_rate") rows.push({ label: T("Attribution", "Atıf"), value: T("Back-office orders by last non-direct click; platform figures as each platform reports them", "Sipariş paneli siparişleri son doğrudan olmayan tıklamaya göre; platform rakamları her platformun bildirdiği gibi") });
  const TR_DIM = { day: "gün", week: "hafta", month: "ay", channel: "kanal", device: "cihaz" };
  rows.push({ label: T("Can be split by", "Kırılımlar"), value: { en: m.dimensions.join(", "), tr: m.dimensions.map((x) => TR_DIM[x] ?? x).join(", ") } });
  rows.push({ label: T("Owner", "Sorumlu"), value: T(m.owner, m.owner) });
  return rows;
}

const packEntry = (pack, m) => ({ id: m.id, label: m.label, description: m.description, unit: m.unit, source: m.source, version: m.version, checks: checksUsing(pack, m.id).map((x) => x.id), status: "active" });
const proposedEntry = (p) => ({ id: p.id, label: p.label, description: p.description, unit: p.unit, source: "model", version: 1, checks: [], status: p.status === "accepted" ? "accepted" : "proposed" });

/** Proposed metrics from the store and accepted ones from the overlay, one entry per id. */
function proposals(ctx) {
  const fromStore = ctx.store.list("metric_proposals", { order: "ASC" }).filter((p) => p.status !== "declined");
  const accepted = listOverlay(ctx.config.dataDir).map((m) => ({ ...m, created_at: m.proposed_at }));
  const ids = new Set(accepted.map((m) => m.id));
  return [...fromStore.filter((p) => !ids.has(p.id)), ...accepted];
}

// ---------------------------------------------------------------- sources and suggestions

const DEMO_SOURCES = [
  { id: "ga4", name: T("GA4 BigQuery export", "GA4 BigQuery dışa aktarımı"), detail: "analytics_312 · events_*", rows: 41820000 },
  { id: "backoffice", name: T("Back office (ikas)", "Sipariş paneli (ikas)"), detail: "orders, order_items", rows: 118400 },
  { id: "google_ads", name: T("Google Ads", "Google Ads"), detail: "campaign, cost, conversions", rows: 9120 },
  { id: "meta_ads", name: T("Meta Ads", "Meta Ads"), detail: "campaign, spend, purchases", rows: 7340 },
  { id: "tiktok_ads", name: T("TikTok Ads", "TikTok Ads"), detail: "campaign, spend, conversions", rows: 2210 },
  { id: "ai_tag_debugger", name: T("ai tag debugger", "ai tag debugger"), detail: "audit findings", rows: 14 },
];

defineAction({
  name: "list_sources",
  description: "The systems behind the mart. On demo data these are the demo shop's (described, not connected); on your shop's own data, the connected sources; on BigQuery, the mart table itself.",
  kind: "read",
  agent: true,
  input: z.object({}).strict(),
  async run(ctx) {
    if (ctx.warehouse.demo) return DEMO_SOURCES;
    const range = await ctx.warehouse.range();
    if (ctx.warehouse.local) {
      const { connectorStates } = await import("../connectors/index.js");
      return connectorStates(ctx.app)
        .filter((s) => s.status !== "not_connected")
        .map((s) => ({ id: s.id, name: s.name, detail: [s.target, s.last_sync?.from && s.last_sync?.to ? `${s.last_sync.from} – ${s.last_sync.to}` : null, s.fills.join(", ")].filter(Boolean).join(" · "), rows: null }));
    }
    return [{ id: "mart", name: T("BigQuery mart", "BigQuery mart tablosu"), detail: ctx.warehouse.table.replace(/`/g, ""), rows: range.rows }];
  },
});

defineAction({
  name: "list_suggestions",
  description: "The questions the Ask page offers.",
  kind: "read",
  mcp: false,
  input: z.object({}).strict(),
  run(ctx) {
    const mode = agentMode(ctx.app);
    // On the demo, one question across the shop's tables (it needs them on the list in Settings › Data source).
    const cross = ctx.warehouse.demo ? [CROSS_Q.returns_category] : [];
    // On your shop's data, only what the connected sources can answer: no ad checks or ROAS without ad data.
    const cols = availableColumns(ctx.app);
    const ok = (s) => (s.check ? checkAnswerable(ctx.app, s.check, cols) : metricAnswerable(ctx.app, s.metric, cols));
    const fit = (list) => list.filter(ok).map(({ text, tag }) => ({ text, tag }));
    const ga4 = { ...SUGGEST.ga4, check: "ga4_vs_orders" };
    if (mode.mode === "model" && mode.exploratory) return [...fit([ga4]), ...[...cross, ...Object.values(EXPLORE_Q)].map((text) => ({ text, tag: "exploratory" }))];
    const main = [ga4, { ...SUGGEST.meta, check: "meta_vs_orders" }, { ...SUGGEST.roas, metric: "roas" }, { ...SUGGEST.revenue_week, metric: "revenue" }];
    if (!cols) return fit(main);
    // Questions that take the place of the ones the source cannot answer, in this order.
    const more = [
      { text: NEAR.revenue_channel_28, tag: "by_channel", metric: "revenue" },
      { text: FOLLOW.conversion_device, tag: "chart", metric: "conversion_rate" },
      { text: FOLLOW.orders_device, tag: "chart", metric: "orders" },
      { text: NEAR.aov_device_28, tag: "chart", metric: "aov" },
      { text: FOLLOW.revenue_day, tag: "chart", metric: "revenue" },
    ];
    return fit([...main, ...more]).slice(0, 4);
  },
});

// ---------------------------------------------------------------- metrics

defineAction({
  name: "list_metrics",
  description: "Lists the metrics in the pack: ids, labels, units, versions, descriptions, the definition and the check that verifies each.",
  kind: "read",
  agent: true,
  input: z.object({}).strict(),
  run: (ctx) => Object.values(ctx.pack.metrics).map(metricInfo),
});

defineAction({
  name: "explain_metric",
  description: "The full definition of one metric, with the SQL it compiles to for the last 28 days and the check that verifies it.",
  kind: "read",
  agent: true,
  input: (pack) => z.object({ metric: z.enum(Object.keys(pack.metrics)) }).strict(),
  async run(ctx, { metric: id }) {
    const m = ctx.pack.metrics[id];
    const range = await ctx.warehouse.range();
    const q = resolveQuery(ctx.pack, { metric: id, from: addDays(range.to, -27), to: range.to }, range);
    const check = m.check ? ctx.pack.checks[m.check] : null;
    return {
      ...metricInfo(m),
      model: m.model,
      sql_example: compileQuery(ctx.pack, q, ctx.warehouse),
      dialect: ctx.warehouse.dialect,
      check: check ? { id: check.id, label: check.label, tolerance: check.tolerance } : null,
    };
  },
});

defineAction({
  name: "list_metric_entries",
  description: "The data dictionary: every pack metric, plus metrics proposed from exploratory answers.",
  kind: "read",
  mcp: false,
  input: z.object({}).strict(),
  run: (ctx) => [...Object.values(ctx.pack.metrics).map((m) => packEntry(ctx.pack, m)), ...proposals(ctx).map(proposedEntry)],
});

const historyOf = (m) => (m.history ?? []).map((h) => ({ version: h.version, date: h.date, change: h.change, actor: T(h.actor, h.actor) }));

defineAction({
  name: "get_metric",
  description: "One metric's page: definition rows, compiled SQL, the last 90 days, the checks that use it, where it is used and its history.",
  kind: "read",
  mcp: false,
  input: z.object({ metric: z.string().min(1).max(80) }).strict(),
  async run(ctx, { metric: id }) {
    const m = ctx.pack.metrics[id];
    if (m) {
      const range = await ctx.warehouse.range();
      const series = await runQuery(ctx, { metric: id, group_by: "day", from: addDays(range.to, -89), to: range.to }, { save: false });
      const sql = (await runQuery(ctx, { metric: id, from: addDays(range.to, -27), to: range.to }, { save: false })).sql;
      const run = ctx.store.latestCheckRun();
      const checks = [];
      for (const { id: cid, role } of checksUsing(ctx.pack, id)) {
        const r = run?.results.find((x) => x.check === cid) ?? (await runReconcile(ctx, { check: cid }, { save: false }));
        checks.push({ id: cid, label: ctx.pack.checks[cid].label, role, verdict: r.verdict, delta_pct: r.delta_pct, from: r.from, to: r.to });
      }
      const usesIt = (t) => (t.query.type === "metric" && t.query.metric === id) || (t.query.type === "check" && [ctx.pack.checks[t.query.check].expected.metric, ctx.pack.checks[t.query.check].measured.metric].includes(id));
      const used_in = listDashboards(ctx.store).flatMap((d) => d.tiles.filter(usesIt).map((t) => ({ dashboard_id: d.id, dashboard: d.name, tile_id: t.id, title: t.title })));
      return { entry: packEntry(ctx.pack, m), definition: definitionRows(m), sql, series, checks, used_in, history: historyOf(m), proposal: null };
    }
    const p = proposals(ctx).find((x) => x.id === id);
    if (!p) throw new AppError("not_found", `There is no metric called ${id}.`);
    const accepted = p.status === "accepted";
    const history = accepted
      ? p.history
      : [{ version: 0, date: p.created_at.slice(0, 10), change: T("Proposed from an exploratory answer, with the model’s SQL.", "Bir keşif cevabından, modelin SQL’iyle önerildi."), actor: T("Agent", "Agent") }];
    const definition = [
      { label: T("Status", "Durum"), value: accepted ? T("Accepted · not checked", "Kabul edildi · sağlaması yok") : T("Proposed · draft", "Önerildi · taslak") },
      { label: T("Formula", "Formül"), value: T("The model’s SQL, below", "Modelin SQL’i, aşağıda") },
      { label: T("Table", "Tablo"), value: T("daily_channel_device", "daily_channel_device") },
      { label: T("Timezone", "Saat dilimi"), value: T("Europe/Istanbul", "Europe/Istanbul") },
      { label: T("Tracking checks", "Ölçüm kontrolleri"), value: T("None: not checked", "Yok: sağlaması yok") },
    ];
    const used_in = listDashboards(ctx.store).flatMap((d) => d.tiles.filter((t) => t.answer_id && t.answer_id === p.answer_id).map((t) => ({ dashboard_id: d.id, dashboard: d.name, tile_id: t.id, title: t.title })));
    return { entry: proposedEntry(p), definition, sql: p.sql, series: null, checks: [], used_in, history, proposal: { question: p.question, answer_id: p.answer_id, conversation_id: p.conversation_id } };
  },
});

defineAction({
  name: "decide_metric",
  description: "Accepts or declines a metric proposed from an exploratory answer. Accepting writes it to <data_dir>/metrics/, next to the pack.",
  kind: "write",
  input: z.object({ metric: z.string().min(1).max(80), accept: z.boolean() }).strict(),
  run(ctx, { metric, accept }) {
    const p = ctx.store.get("metric_proposals", metric);
    if (!p || p.status !== "proposed") throw new AppError("not_pending", "This metric is not waiting for a decision.");
    const at = new Date().toISOString();
    const next = { ...p, status: accept ? "accepted" : "declined", ...(accept ? { accepted_at: at } : {}) };
    if (accept) {
      writeOverlay(ctx.config.dataDir, {
        id: p.id,
        version: 1,
        status: "accepted",
        label: p.label,
        description: p.description,
        unit: p.unit,
        source: "model",
        sql: p.sql,
        question: p.question,
        answer_id: p.answer_id,
        conversation_id: p.conversation_id,
        proposed_at: p.created_at,
        accepted_at: at,
        history: [
          { version: 1, date: at.slice(0, 10), change: T("Accepted from an exploratory answer. No tracking check uses it, so it stays not checked.", "Bir keşif cevabından kabul edildi. Hiçbir ölçüm kontrolü kullanmadığı için sağlaması yok."), actor: T("Person", "Kişi") },
          { version: 0, date: p.created_at.slice(0, 10), change: T("Proposed from an exploratory answer, with the model’s SQL.", "Bir keşif cevabından, modelin SQL’iyle önerildi."), actor: T("Agent", "Agent") },
        ],
      });
    }
    ctx.store.put("metric_proposals", next);
    const act = ctx.log(accept ? ACT.metric_accepted(p.label) : ACT.metric_declined(p.label));
    return { entry: accept ? proposedEntry(next) : null, activity_id: act.id };
  },
});

// ---------------------------------------------------------------- checks

defineAction({
  name: "list_checks",
  description: "Lists the tracking checks: which metric is expected (the system that owns the number), which is measured, the tolerance, the breakdown and linked findings.",
  kind: "read",
  agent: true,
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

/** The workspace header. Also used by the agent and chat apps. */
export async function workspaceInfo(ctx) {
  const range = await ctx.warehouse.range();
  return {
    name: workspaceName(ctx.config, ctx.warehouse),
    demo: ctx.warehouse.demo,
    data_from: range.from,
    data_to: range.to,
    refreshed_at: ctx.warehouse.refreshedAt() ?? ctx.store.getMeta("seeded_at"),
    rows: range.rows,
  };
}

defineAction({
  name: "get_workspace",
  description: "The workspace: its name, whether it is demo data, the data range and the row count.",
  kind: "read",
  agent: true,
  input: z.object({}).strict(),
  run: workspaceInfo,
});
