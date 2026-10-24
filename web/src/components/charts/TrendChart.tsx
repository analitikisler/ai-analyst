// One metric over time (08-art.md §5.3): line for days, columns for weeks and months, area only for an additive
// metric on a zero base. The previous period is the same hue, dashed and thinner, aligned day by day. The last 3
// days are lighter ("may change"); a partial period is hatched.
import { useId, useMemo } from "react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceArea, Tooltip, XAxis, YAxis } from "recharts";
import type { QueryResult } from "@/api/types";
import { eventLines, EventsToggle, useChartEvents } from "./events";
import { useBilingual, useT } from "@/i18n";
import { useFormat } from "@/lib/format";
import { axisLine, axisTick, barCursor, ChartEmpty, ChartLegend, ChartPatterns, ChartTooltipBox, cursorStroke, evenTicks, gridStroke, niceMax, prefersReducedMotion, provisionalStart, tickFormatter, useWidth } from "./common";

export interface TrendChartProps {
  query: QueryResult;
  type: "line" | "area" | "column";
  height?: number;
  showPrevious?: boolean;
  /** Hide the y axis (small tiles); min and max stay readable in the tooltip. */
  compact?: boolean;
  title: string;
  className?: string;
}

export function TrendChart({ query: q, type, height = 220, showPrevious = true, compact, title, className }: TrendChartProps) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const id = useId().replace(/:/g, "");
  const [ref, width] = useWidth<HTMLDivElement>();
  const ev = useChartEvents(
    useMemo(() => q.rows.map((r) => r.key), [q.rows]),
    q.group_by === "week" ? "week" : q.group_by === "month" ? "month" : "day",
  );
  const prevRows = showPrevious ? (q.comparison?.rows ?? []) : [];
  const daily = q.group_by === "day";
  const prov = daily ? provisionalStart(q.rows.map((r) => r.key), q.provisional_from) : undefined;
  const data = useMemo(
    () =>
      q.rows.map((r, i) => {
        const provisional = prov != null && r.key >= prov;
        const joins = prov != null && q.rows[i + 1]?.key === prov;
        return {
          key: r.key,
          value: provisional && type !== "column" ? null : r.value,
          valueP: (provisional || joins) && type !== "column" ? r.value : null,
          raw: r.value,
          previous: prevRows[i]?.value ?? null,
          previousKey: prevRows[i]?.key,
          provisional,
          partial: q.partial?.key === r.key,
        };
      }),
    [q.rows, prevRows, prov, type, q.partial],
  );
  if (!q.rows.length) return <ChartEmpty height={height} />;
  const max = niceMax(Math.max(...q.rows.map((r) => r.value ?? 0), ...prevRows.map((r) => r.value ?? 0), 0), q.unit);
  const anim = !prefersReducedMotion();
  const tick = (k: string) => f.date(k);
  const legend = [
    { key: "v", name: title, color: "var(--color-chart-1)", emphasis: true },
    ...(prevRows.length && q.comparison ? [{ key: "p", name: `${t.charts.previous} · ${f.range(q.comparison.from, q.comparison.to)}`, color: "var(--color-chart-1)", dashed: true }] : []),
  ];
  const tooltip = (
    <Tooltip
      cursor={type === "column" ? barCursor : cursorStroke}
      isAnimationActive={false}
      wrapperStyle={{ zIndex: 10 }}
      content={({ active, payload }) => {
        const row = active && payload?.[0] ? (payload[0].payload as (typeof data)[number]) : null;
        if (!row) return null;
        return (
          <ChartTooltipBox
            title={q.group_by === "week" ? f.range(row.key, addSix(row.key)) : f.date(row.key, true)}
            rows={[
              { key: "v", name: title, color: "var(--color-chart-1)", value: f.value(row.raw, q.unit), emphasis: true },
              ...(row.previous != null && row.previousKey ? [{ key: "p", name: f.date(row.previousKey), color: "var(--color-chart-1)", value: f.value(row.previous, q.unit), dashed: true }] : []),
            ]}
            footer={row.provisional ? t.charts.provisional_tip : undefined}
          />
        );
      }}
    />
  );
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={gridStroke} />
      <XAxis dataKey="key" tickFormatter={tick} tick={axisTick} axisLine={axisLine} tickLine={false} minTickGap={24} tickMargin={8} />
      <YAxis hide={compact} domain={[0, max]} ticks={evenTicks(max)} tickFormatter={tickFormatter(f, q.unit)} tick={axisTick} axisLine={false} tickLine={false} width={48} />
    </>
  );
  const summary = t.charts.summary_line.replace("{title}", title).replace("{range}", f.range(q.from, q.to));
  void pick;
  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <ChartLegend items={legend} />
        <EventsToggle count={ev.count} on={ev.on} onChange={ev.setOn} />
      </div>
      <div ref={ref} role="img" aria-label={summary} style={{ height }}>
        {width > 0 &&
          (type === "column" ? (
            <BarChart width={width} height={height} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="24%" accessibilityLayer={false}>
              <ChartPatterns id={id} />
              {axes}
              {tooltip}
              {eventLines(ev.groups)}
              {showPrevious && prevRows.length > 0 && <Bar dataKey="previous" fill="var(--color-surface)" stroke="var(--color-chart-1)" strokeDasharray="3 2" strokeWidth={1} radius={[1, 1, 0, 0]} maxBarSize={24} isAnimationActive={false} />}
              <Bar dataKey="raw" radius={[1, 1, 0, 0]} maxBarSize={40} isAnimationActive={false}>
                {data.map((r) => (
                  <Cell
                    key={r.key}
                    fill={r.partial ? `url(#hatch-partial-${id})` : r.provisional ? "var(--color-chart-provisional)" : "var(--color-chart-1)"}
                    stroke={r.partial || r.provisional ? "var(--color-chart-1)" : "none"}
                    strokeWidth={1}
                  />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <ComposedChart width={width} height={height} data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
              <ChartPatterns id={id} />
              {prov && <ReferenceArea x1={prov} x2={q.rows[q.rows.length - 1]?.key} fill={`url(#hatch-prov-${id})`} fillOpacity={1} ifOverflow="hidden" label={{ value: t.ask.may_change, position: "insideTopRight", fill: "var(--color-text-muted)", fontSize: 12 }} />}
              {axes}
              {tooltip}
              {eventLines(ev.groups)}
              {type === "area" && <Area dataKey="value" stroke="none" fill="var(--color-chart-1)" fillOpacity={0.12} baseValue={0} isAnimationActive={false} connectNulls={false} activeDot={false} />}
              {showPrevious && prevRows.length > 0 && <Line dataKey="previous" stroke="var(--color-chart-1)" strokeWidth={1.5} strokeDasharray="4 3" strokeOpacity={0.7} dot={false} isAnimationActive={false} activeDot={false} />}
              <Line dataKey="value" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} isAnimationActive={anim} animationDuration={400} connectNulls={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-surface)", fill: "var(--color-chart-1)" }} />
              <Line dataKey="valueP" stroke="var(--color-chart-1)" strokeWidth={2} strokeDasharray="3 3" dot={false} isAnimationActive={false} connectNulls={false} activeDot={false} />
            </ComposedChart>
          ))}
      </div>
    </div>
  );
}

function addSix(k: string) {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}
