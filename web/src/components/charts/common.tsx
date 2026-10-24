// Shared chart chrome, ported from Overt (web/src/components/charts/common.tsx) with 08-art.md §5.2: recessive
// axes and grid, token tooltips with mono values, legends in ink, hatches on SVG patterns. Formatting comes from
// lib/format (language-aware).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import type { Unit } from "@/api/types";
import { useT } from "@/i18n";
import type { Format } from "@/lib/format";

export interface SeriesDef {
  key: string;
  name: string;
  color: string;
  emphasis?: boolean;
  dashed?: boolean;
  hollow?: boolean;
}

export const axisTick = { fill: "var(--color-text-subtle)", fontSize: 12, fontFamily: "var(--font-sans)" } as const;
export const axisLine = { stroke: "var(--color-border-strong)" } as const;
export const gridStroke = "var(--color-border)";
export const cursorStroke = { stroke: "var(--color-border-strong)", strokeWidth: 1 } as const;
export const barCursor = { fill: "var(--color-surface-2)" } as const;
export const margin = { top: 8, right: 8, bottom: 0, left: 0 };

export const tickFormatter = (f: Format, unit: Unit) => (v: number) => f.compact(v, unit);

/** Round a max up to a "nice" axis bound. Rates cap at 1. */
export function niceMax(max: number, unit: Unit): number {
  if (!Number.isFinite(max) || max <= 0) return unit === "pct" ? 0.1 : 10;
  if (unit === "pct") {
    const step = max > 0.5 ? 0.2 : max > 0.2 ? 0.1 : max > 0.05 ? 0.05 : 0.01;
    return Math.min(1, Math.ceil((max * 1.05) / step) * step);
  }
  const mag = 10 ** Math.floor(Math.log10(max));
  const n = max / mag;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * mag;
}

/** The first day of the "may change" stretch, only when it falls inside the plotted days (the last 3 days of
 *  data). A period that ends before the data end, like last complete week, has none. */
export function provisionalStart(keys: string[], provisionalFrom: string | undefined | null): string | undefined {
  if (!provisionalFrom || !keys.length) return undefined;
  return keys.find((k) => k >= provisionalFrom);
}

/** Evenly spaced axis ticks from 0 to a nice max: 0, 100k, 200k… (4 to 6 steps). */
export function evenTicks(max: number): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const mag = 10 ** Math.floor(Math.log10(max));
  const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5].map((x) => x * mag);
  const step = steps.find((st) => max / st <= 6 && Math.abs(max / st - Math.round(max / st)) < 1e-9) ?? max / 4;
  const out: number[] = [];
  for (let v = 0; v <= max + step / 1e6; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Pattern defs for one chart; ids are suffixed so two charts on a page never share one. */
export function ChartPatterns({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={`hatch-partial-${id}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="1.5" height="5" fill="var(--color-chart-1)" />
      </pattern>
      <pattern id={`hatch-gap-${id}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
        <rect width="1.5" height="5" fill="var(--color-danger)" />
      </pattern>
      <pattern id={`hatch-neutral-${id}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
        <rect width="1.5" height="5" fill="var(--color-border-strong)" />
      </pattern>
      <pattern id={`hatch-prov-${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="1" height="6" fill="var(--color-border)" />
      </pattern>
    </defs>
  );
}

export interface TooltipRow {
  key: string;
  name: ReactNode;
  color: string;
  value: string;
  emphasis?: boolean;
  dashed?: boolean;
}

export function ChartTooltipBox({ title, rows, footer }: { title?: ReactNode; rows: TooltipRow[]; footer?: ReactNode }) {
  return (
    <div className="max-w-72 min-w-40 rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-md">
      {title && <div className="mb-1.5 font-medium text-text-muted">{title}</div>}
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-1.5">
              <Swatch color={r.color} dashed={r.dashed} />
              <span className={cn("truncate", r.emphasis ? "font-semibold text-text-strong" : "text-text-muted")}>{r.name}</span>
            </span>
            <span className={cn("font-mono text-text tnum", r.emphasis && "font-semibold")}>{r.value}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t border-border pt-1.5 text-text-subtle">{footer}</div>}
    </div>
  );
}

export function Swatch({ color, dashed, hollow }: { color: string; dashed?: boolean; hollow?: boolean }) {
  if (dashed) return <span aria-hidden className="inline-block h-0 w-3 shrink-0 border-t-2 border-dashed" style={{ borderColor: color }} />;
  if (hollow) return <span aria-hidden className="inline-block size-2 shrink-0 rounded-xs border bg-surface" style={{ borderColor: color }} />;
  return <span aria-hidden className="inline-block size-2 shrink-0 rounded-xs" style={{ background: color }} />;
}

/** Legend with square swatches; labels wear ink, not series colour. */
export function ChartLegend({ items, className }: { items: SeriesDef[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {items.map((s) => (
        <li key={s.key} className="inline-flex max-w-56 items-center gap-1.5 text-2xs">
          <Swatch color={s.color} dashed={s.dashed} hollow={s.hollow} />
          <span className={cn("truncate", s.emphasis ? "font-medium text-text" : "text-text-muted")}>{s.name}</span>
        </li>
      ))}
    </ul>
  );
}

export function ChartEmpty({ height, children }: { height: number; children?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex items-center justify-center rounded-md border border-dashed border-border text-[13px] text-text-subtle" style={{ height }}>
      {children ?? t.charts.empty}
    </div>
  );
}

/** Measures its box, so charts can lay out without Recharts' ResponsiveContainer warnings. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
