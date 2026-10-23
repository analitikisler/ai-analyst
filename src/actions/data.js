// Reading the warehouse: run_query, reconcile, run_all_checks.
import { z } from "zod";
import { reconcile as tally } from "../checks/reconcile.js";
import { addDays, fmtPct, fmtVal } from "../format.js";
import { compileQuery, echoFilters, resolveQuery } from "../metrics/compile.js";
import { MART } from "../metrics/load.js";
import { newId } from "../store/store.js";
import { defineAction } from "./registry.js";
import { checkSummary, querySummary, T } from "./text.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date written YYYY-MM-DD");
const oneOrMany = (values) => z.union([z.enum(values), z.array(z.enum(values)).min(1)]);
export const filtersSchema = z
  .object({
    channel: oneOrMany(MART.dimensions.channel).optional().describe("One channel or a list."),
    device: oneOrMany(MART.dimensions.device).optional().describe("One device or a list."),
  })
  .strict();

const round = (v, d) => (typeof v === "number" ? Number(v.toFixed(d)) : v);

/** QueryParams -> QueryResult, stored. */
export async function runQuery(ctx, input) {
  const range = await ctx.warehouse.range();
  const q = resolveQuery(ctx.pack, input, range);
  const metric = ctx.pack.metrics[q.metric];
  const sql = compileQuery(ctx.pack, q, ctx.warehouse);
  const raw = await ctx.warehouse.query(sql);
  const sum = (k) => raw.reduce((a, r) => a + (r[k] ?? 0), 0);
  // Ratios come from the sums of their parts, never from averaging the rows.
  const total = metric.sum ? sum("value") : sum("denominator") ? sum("numerator") / sum("denominator") : null;
  let rows = q.group_by === "none" ? [] : raw.map((r) => ({ key: r[q.group_by], value: r.value }));
  if (["channel", "device"].includes(q.group_by)) rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  else rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const result = {
    id: newId("q"),
    metric: metric.id,
    metric_version: metric.version,
    group_by: q.group_by,
    from: q.from,
    to: q.to,
    filters: echoFilters(q.filters),
    unit: metric.unit,
    rows,
    total,
    sql,
    dialect: ctx.warehouse.dialect,
    ran_at: new Date().toISOString(),
  };
  return ctx.store.saveQuery(result);
}

/** What the model sees of a query: ids, the figures, and how to write them. */
export function compactQuery(q, lang = "en") {
  const d = q.unit === "pct" ? 6 : 4;
  const rows = q.rows.length > 40 ? null : q.rows.map((r) => [r.key, round(r.value, d)]);
  return {
    query_id: q.id,
    metric: q.metric,
    unit: q.unit,
    period: [q.from, q.to],
    group_by: q.group_by,
    filters: q.filters,
    total: round(q.total, d),
    total_formatted: fmtVal(q.total, q.unit, lang),
    ...(rows ? { rows } : { rows_omitted: `${q.rows.length} rows: group by week or month to see them` }),
  };
}

export function compactCheck(c, lang = "en") {
  const { sql, label, ...rest } = c;
  return {
    check_id: c.id,
    ...rest,
    delta_pct_formatted: c.delta_pct == null ? null : fmtPct(c.delta_pct, 1, true, lang),
    breakdown: c.breakdown.map((b) => ({ ...b, delta_pct_formatted: b.delta_pct == null ? null : fmtPct(b.delta_pct, 1, true, lang) })),
  };
}

export async function runReconcile(ctx, input) {
  const result = await tally({ pack: ctx.pack, warehouse: ctx.warehouse, ...input, findings: ctx.store.findingsFor(input.check) });
  return ctx.store.saveCheck(result);
}

const checkIds = (pack) => Object.keys(pack.checks);

defineAction({
  name: "run_query",
  description:
    "Runs one metric from the governed metric pack over the warehouse and returns query_id, total and rows ([key, value]). Use it for every figure you mention; never compute or invent figures yourself. Ratios are computed from sums. Weekly results keep complete Monday–Sunday weeks only.",
  kind: "read",
  input: (pack) =>
    z
      .object({
        metric: z.enum(Object.keys(pack.metrics)).describe("Metric id from the pack."),
        group_by: z.enum(MART.groupBy).optional().describe("Default none (just the total)."),
        from: date.optional().describe("First day, YYYY-MM-DD. Default: 27 days before to."),
        to: date.optional().describe("Last day, YYYY-MM-DD. Default: the last day with data."),
        filters: filtersSchema.optional(),
      })
      .strict(),
  run: runQuery,
  forModel: compactQuery,
  summary: querySummary,
});

defineAction({
  name: "reconcile",
  description:
    "Compares a measured figure with the system that owns it (a check) and returns expected, measured, delta, delta_pct, tolerance, verdict, the breakdown, out_of_tolerance_since and linked findings. Run it whenever the metric you answer with has a check, or the question is whether numbers match. Default period: the last 14 days with data.",
  kind: "read",
  input: (pack) =>
    z
      .object({
        check: z.enum(checkIds(pack)).describe("Check id from the pack."),
        from: date.optional(),
        to: date.optional(),
        filters: filtersSchema.optional(),
      })
      .strict(),
  run: runReconcile,
  forModel: compactCheck,
  summary: checkSummary,
});

defineAction({
  name: "run_all_checks",
  description: "Runs every check over the last N days with data and stores the run. Returns each check's verdict.",
  kind: "write",
  input: z.object({ days: z.number().int().min(1).max(90).default(14).describe("Days to check, ending on the last day with data.") }).strict(),
  async run(ctx, { days }) {
    const range = await ctx.warehouse.range();
    const from = addDays(range.to, -(days - 1));
    const results = [];
    for (const check of checkIds(ctx.pack)) results.push(await runReconcile(ctx, { check, from, to: range.to }));
    const bad = results.filter((r) => r.verdict === "does_not_add_up").length;
    const run = ctx.store.saveCheckRun({ id: newId("run"), created_at: new Date().toISOString(), actor: ctx.actor, days, from: results[0]?.from ?? from, to: range.to, results });
    ctx.log(T[ctx.lang].checks_run(results.length, bad));
    return run;
  },
  forModel: (run, lang) => ({
    run_id: run.id,
    days: run.days,
    checks: run.results.map((c) => ({ check_id: c.id, check: c.check, verdict: c.verdict, delta_pct: c.delta_pct, delta_pct_formatted: c.delta_pct == null ? null : fmtPct(c.delta_pct, 1, true, lang), out_of_tolerance_since: c.out_of_tolerance_since })),
  }),
  summary: (run, lang) => T[lang].checks_run(run.results.length, run.results.filter((r) => r.verdict === "does_not_add_up").length),
});
