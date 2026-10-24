// Both sides of a check by day (07-creative.md §3 D, 08-art.md §5.3 "check variant"): the period plus the 14 days
// before it, the lead-in on `well` so the day it broke is visible; the owner system as a recessive line, the
// measured side in the data blue; red hatching between them only on days outside tolerance (and only when the
// verdict is bad); the release as a dashed marker; the last 3 days dashed and labelled "may change".
import { useId, useMemo, useState, type ReactNode } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { CheckResult } from "@/api/types";
import { eventLines, EventsToggle, useChartEvents } from "./events";
import { SegmentedControl } from "@/components/kit/SegmentedControl";
import { fmt, useBilingual, useT } from "@/i18n";
import { addDays } from "@/lib/dates";
import { useFormat } from "@/lib/format";
import { axisLine, axisTick, ChartLegend, ChartPatterns, ChartTooltipBox, cursorStroke, evenTicks, gridStroke, niceMax, prefersReducedMotion, provisionalStart, tickFormatter, useWidth } from "./common";

export function CheckChart({ result: c, height = 220, className }: { result: CheckResult; height?: number; className?: string }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const id = useId().replace(/:/g, "");
  const [ref, width] = useWidth<HTMLDivElement>();
  const series = c.series ?? [];
  const ev = useChartEvents(useMemo(() => series.map((p) => p.date), [series]));
  const prov = provisionalStart(series.map((p) => p.date), c.provisional_from);
  const data = useMemo(
    () =>
      series.map((p, i) => {
        const outside = p.expected ? Math.abs((p.measured - p.expected) / p.expected) > c.tolerance : false;
        const inPeriod = p.date >= c.from && p.date <= c.to;
        const provisional = prov != null && p.date >= prov;
        const joinsProvisional = prov != null && series[i + 1]?.date === prov;
        return {
          date: p.date,
          expected: provisional ? null : p.expected,
          measured: provisional ? null : p.measured,
          expectedP: provisional || joinsProvisional ? p.expected : null,
          measuredP: provisional || joinsProvisional ? p.measured : null,
          gap: c.verdict === "does_not_add_up" && outside && inPeriod ? [Math.min(p.expected, p.measured), Math.max(p.expected, p.measured)] : null,
          raw: p,
        };
      }),
    [series, c.tolerance, c.from, c.to, c.verdict, prov],
  );
  const max = niceMax(Math.max(...series.flatMap((p) => [p.expected, p.measured]), 1), c.unit);
  const leadEnd = addDays(c.from, -1);
  const hasLead = (c.series_from ?? c.from) < c.from;
  const anim = !prefersReducedMotion();
  const legend = [
    { key: "e", name: pick(c.expected.label), color: "var(--color-chart-ref)" },
    { key: "m", name: pick(c.measured.label), color: "var(--color-chart-1)", emphasis: true },
  ];
  const summary = `${t.charts.summary_check
    .replace("{expected}", pick(c.expected.label))
    .replace("{measured}", pick(c.measured.label))
    .replace("{range}", f.range(c.from, c.to))}`;
  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <ChartLegend items={legend} />
        <EventsToggle count={ev.count} on={ev.on} onChange={ev.setOn} />
      </div>
      <div ref={ref} role="img" aria-label={summary} style={{ height }}>
        {width > 0 && (
          <ComposedChart width={width} height={height} data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
            <ChartPatterns id={id} />
            <CartesianGrid vertical={false} stroke={gridStroke} />
            {hasLead && (
              <ReferenceArea
                x1={c.series_from}
                x2={leadEnd}
                fill="var(--color-well)"
                fillOpacity={1}
                ifOverflow="hidden"
                label={{ value: t.ask.before_period, position: "insideTopLeft", fill: "var(--color-text-muted)", fontSize: 12 }}
              />
            )}
            {prov && (
              <ReferenceArea x1={prov} x2={series[series.length - 1]?.date} fill={`url(#hatch-prov-${id})`} fillOpacity={1} ifOverflow="hidden" label={{ value: t.ask.may_change, position: "insideTopRight", fill: "var(--color-text-muted)", fontSize: 12 }} />
            )}
            <XAxis dataKey="date" tickFormatter={(d: string) => f.date(d)} tick={axisTick} axisLine={axisLine} tickLine={false} minTickGap={24} tickMargin={8} />
            <YAxis domain={[0, max]} ticks={evenTicks(max)} tickFormatter={tickFormatter(f, c.unit)} tick={axisTick} axisLine={false} tickLine={false} width={44} />
            <Tooltip
              cursor={cursorStroke}
              isAnimationActive={false}
              wrapperStyle={{ zIndex: 10 }}
              content={({ active, payload }) => {
                const row = active && payload?.[0] ? (payload[0].payload as (typeof data)[number]) : null;
                if (!row) return null;
                return (
                  <ChartTooltipBox
                    title={f.date(row.date, true)}
                    rows={[
                      { key: "e", name: pick(c.expected.label), color: "var(--color-chart-ref)", value: f.value(row.raw.expected, c.unit) },
                      { key: "m", name: pick(c.measured.label), color: "var(--color-chart-1)", value: f.value(row.raw.measured, c.unit), emphasis: true },
                    ]}
                    footer={prov && row.date >= prov ? t.charts.provisional_tip : undefined}
                  />
                );
              }}
            />
            <Area dataKey="gap" stroke="none" fill={`url(#hatch-gap-${id})`} fillOpacity={1} isAnimationActive={false} connectNulls={false} activeDot={false} />
            {eventLines(ev.groups)}
            <Line dataKey="expected" stroke="var(--color-chart-ref)" strokeWidth={1.5} dot={false} isAnimationActive={anim} animationDuration={400} connectNulls={false} activeDot={{ r: 3, fill: "var(--color-chart-ref)", stroke: "var(--color-surface)" }} />
            <Line dataKey="expectedP" stroke="var(--color-chart-ref)" strokeWidth={1.5} strokeDasharray="3 3" dot={false} isAnimationActive={false} connectNulls={false} activeDot={false} />
            <Line dataKey="measured" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} isAnimationActive={anim} animationDuration={400} connectNulls={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-surface)", fill: "var(--color-chart-1)" }} />
            <Line dataKey="measuredP" stroke="var(--color-chart-1)" strokeWidth={2} strokeDasharray="3 3" dot={false} isAnimationActive={false} connectNulls={false} activeDot={false} />
          </ComposedChart>
        )}
      </div>
    </div>
  );
}

/** Difference by day (11-review.md P2 2): Δ% per day in ink against the shaded ±tolerance band, days outside the
 *  band hatched (red only when the verdict is bad), the lead-in on `well`, the release marker and the last 3 days
 *  hatched "may change". The default view of a check, so a sales spike after the release does not read as caused
 *  by it: only the gap between the two systems is drawn. */
export function DiffChart({ result: c, height = 220, className }: { result: CheckResult; height?: number; className?: string }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const id = useId().replace(/:/g, "");
  const [ref, width] = useWidth<HTMLDivElement>();
  const series = c.series ?? [];
  const ev = useChartEvents(useMemo(() => series.map((p) => p.date), [series]));
  const prov = provisionalStart(series.map((p) => p.date), c.provisional_from);
  const tol = c.tolerance;
  const data = useMemo(
    () =>
      series.map((p, i) => {
        const d = p.expected ? (p.measured - p.expected) / p.expected : null;
        const inPeriod = p.date >= c.from && p.date <= c.to;
        const provisional = prov != null && p.date >= prov;
        const joins = prov != null && series[i + 1]?.date === prov;
        const outside = d != null && Math.abs(d) > tol;
        return {
          date: p.date,
          d: provisional ? null : d,
          dP: provisional || joins ? d : null,
          gap: outside && inPeriod ? [d < 0 ? d : tol, d < 0 ? -tol : d] : null,
          raw: p,
          diff: d,
        };
      }),
    [series, c.from, c.to, tol, prov],
  );
  const values = data.map((x) => x.diff ?? 0);
  const step = 0.05;
  const lo = Math.min(-tol * 1.5, Math.floor(Math.min(...values, 0) / step) * step);
  const hi = Math.max(tol * 1.5, Math.ceil(Math.max(...values, 0) / step) * step);
  const ticks: number[] = [];
  const tickStep = hi - lo > 0.4 ? 0.1 : step;
  for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi + 1e-9; v += tickStep) ticks.push(Math.round(v * 100) / 100);
  const leadEnd = addDays(c.from, -1);
  const hasLead = (c.series_from ?? c.from) < c.from;
  const anim = !prefersReducedMotion();
  const bad = c.verdict === "does_not_add_up";
  const legend = [
    { key: "d", name: t.charts.diff_title, color: "var(--color-text)", emphasis: true },
    { key: "b", name: fmt(t.charts.band, { t: f.pct(tol, 0) }), color: "var(--color-border-strong)", hollow: true },
  ];
  const summary = fmt(t.charts.summary_diff, { expected: pick(c.expected.label), measured: pick(c.measured.label), range: f.range(c.from, c.to), t: f.pct(tol, 0) });
  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <ChartLegend items={legend} />
        <EventsToggle count={ev.count} on={ev.on} onChange={ev.setOn} />
      </div>
      <div ref={ref} role="img" aria-label={summary} style={{ height }}>
        {width > 0 && (
          <ComposedChart width={width} height={height} data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
            <ChartPatterns id={id} />
            <CartesianGrid vertical={false} stroke={gridStroke} />
            {hasLead && (
              <ReferenceArea x1={c.series_from} x2={leadEnd} fill="var(--color-well)" fillOpacity={1} ifOverflow="hidden" label={{ value: t.ask.before_period, position: "insideTopLeft", fill: "var(--color-text-muted)", fontSize: 12 }} />
            )}
            {prov && <ReferenceArea x1={prov} x2={series[series.length - 1]?.date} fill={`url(#hatch-prov-${id})`} fillOpacity={1} ifOverflow="hidden" label={{ value: t.ask.may_change, position: "insideTopRight", fill: "var(--color-text-muted)", fontSize: 12 }} />}
            <ReferenceArea y1={-tol} y2={tol} fill="var(--color-surface-2)" fillOpacity={0.9} stroke="var(--color-border-strong)" strokeDasharray="3 3" strokeOpacity={0.8} ifOverflow="hidden" />
            <ReferenceLine y={0} stroke="var(--color-border-strong)" />
            <XAxis dataKey="date" tickFormatter={(d: string) => f.date(d)} tick={axisTick} axisLine={axisLine} tickLine={false} minTickGap={24} tickMargin={8} />
            <YAxis domain={[lo, hi]} ticks={ticks} tickFormatter={(v: number) => f.pct(v, 0, true)} tick={axisTick} axisLine={false} tickLine={false} width={48} />
            <Tooltip
              cursor={cursorStroke}
              isAnimationActive={false}
              wrapperStyle={{ zIndex: 10 }}
              content={({ active, payload }) => {
                const row = active && payload?.[0] ? (payload[0].payload as (typeof data)[number]) : null;
                if (!row) return null;
                return (
                  <ChartTooltipBox
                    title={f.date(row.date, true)}
                    rows={[
                      { key: "d", name: t.tally.difference, color: "var(--color-text)", value: f.pct(row.diff, 1, true), emphasis: true },
                      { key: "e", name: pick(c.expected.label), color: "var(--color-chart-ref)", value: f.value(row.raw.expected, c.unit) },
                      { key: "m", name: pick(c.measured.label), color: "var(--color-chart-1)", value: f.value(row.raw.measured, c.unit) },
                    ]}
                    footer={prov && row.date >= prov ? t.charts.provisional_tip : undefined}
                  />
                );
              }}
            />
            <Area dataKey="gap" stroke="none" fill={`url(#hatch-${bad ? "gap" : "neutral"}-${id})`} fillOpacity={1} isAnimationActive={false} connectNulls={false} activeDot={false} />
            {eventLines(ev.groups)}
            <Line dataKey="d" stroke="var(--color-text)" strokeWidth={1.75} dot={false} isAnimationActive={anim} animationDuration={400} connectNulls={false} activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--color-surface)", fill: "var(--color-text)" }} />
            <Line dataKey="dP" stroke="var(--color-text)" strokeWidth={1.75} strokeDasharray="3 3" dot={false} isAnimationActive={false} connectNulls={false} activeDot={false} />
          </ComposedChart>
        )}
      </div>
    </div>
  );
}

/** The check's chart with its view switch: Difference (default) or Both series. */
export function CheckEvidenceChart({ result, height = 220, extra, className }: { result: CheckResult; height?: number; extra?: ReactNode; className?: string }) {
  const t = useT();
  const [view, setView] = useState<"diff" | "both">("diff");
  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          label={t.charts.view}
          value={view}
          onChange={setView}
          options={[
            { value: "diff", label: t.charts.view_diff },
            { value: "both", label: t.charts.view_both },
          ]}
        />
        {extra}
      </div>
      {view === "diff" ? <DiffChart result={result} height={height} /> : <CheckChart result={result} height={height} />}
    </div>
  );
}
