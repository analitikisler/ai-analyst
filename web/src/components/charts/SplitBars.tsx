// Split bars (08-art.md §5.3): horizontal, sorted by value, one colour (bars differ by length, not hue), values
// in ink at the bar ends, the previous period as a tick on each bar. Plain HTML, so labels never clip.
import { cn } from "cn";
import type { QueryResult } from "@/api/types";
import { useT } from "@/i18n";
import { useFormat } from "@/lib/format";
import { ChartLegend } from "./common";

export function SplitBars({ query: q, showPrevious = true, title, className, max: maxRows, names }: { query: QueryResult; showPrevious?: boolean; title: string; className?: string; max?: number; names?: (key: string) => string }) {
  const t = useT();
  const f = useFormat();
  const rows = q.rows.slice(0, maxRows ?? q.rows.length);
  const prev = new Map((q.comparison?.rows ?? []).map((r) => [r.key, r.value]));
  const max = Math.max(...rows.map((r) => Math.abs(r.value ?? 0)), ...(showPrevious ? [...prev.values()].map((v) => v ?? 0) : []), 1e-9);
  const name = (k: string) => names?.(k) ?? (t.dimensions.channel as Record<string, string>)[k] ?? (t.dimensions.device as Record<string, string>)[k] ?? k;
  const summary = t.charts.summary_bars.replace("{title}", title).replace("{range}", f.range(q.from, q.to)).replace("{values}", rows.map((r) => `${name(r.key)} ${f.value(r.value, q.unit)}`).join(", "));
  return (
    <div className={className}>
      {showPrevious && q.comparison && (
        <ChartLegend
          className="mb-2"
          items={[
            { key: "v", name: title, color: "var(--color-chart-1)", emphasis: true },
            { key: "p", name: `${t.charts.previous} · ${f.range(q.comparison.from, q.comparison.to)}`, color: "var(--color-text)", dashed: false, hollow: true },
          ]}
        />
      )}
      <ul role="img" aria-label={summary} className="flex flex-col gap-2">
        {rows.map((r) => {
          const p = showPrevious ? prev.get(r.key) : undefined;
          return (
            <li key={r.key} aria-hidden className="grid grid-cols-[minmax(4.5rem,7rem)_minmax(0,1fr)_auto] items-center gap-2">
              <span className="truncate text-[13px] text-text">{name(r.key)}</span>
              <span className="relative h-3.5 rounded-xs bg-well">
                <span className="absolute inset-y-0 left-0 rounded-xs bg-chart-1" style={{ width: `${((r.value ?? 0) / max) * 100}%` }} />
                {p != null && <span className="absolute -inset-y-1 w-0.5 bg-text" style={{ left: `calc(${(p / max) * 100}% - 1px)` }} />}
              </span>
              <span className={cn("min-w-14 text-right font-mono text-[13px] text-text tnum")}>{f.value(r.value, q.unit)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
