// A check split by device (09-ux.md F2): per segment, the owner system as a hollow bar and the measured side
// filled, the gap hatched when that segment does not add up, the Δ and the verdict as text.
import type { CheckResult } from "@/api/types";
import { Status } from "@/components/kit/Status";
import { Hatch } from "@/components/tally/Tally";
import { useBilingual, useT } from "@/i18n";
import { useFormat } from "@/lib/format";
import { ChartLegend } from "./common";

/** A source with no device split (all unknown): the check ran on totals, so there is no device table to show. */
export function NoDeviceSplit({ className }: { className?: string }) {
  const t = useT();
  return <p className={className ?? "text-[13px] text-text-muted"}>{t.check.no_split}</p>;
}

export function CheckBars({ result: c, className, compact }: { result: CheckResult; className?: string; compact?: boolean }) {
  const t = useT();
  if (c.breakdown_available === false) return <NoDeviceSplit className={className} />;
  const f = useFormat();
  const pick = useBilingual();
  const max = Math.max(...c.breakdown.flatMap((b) => [b.expected ?? 0, b.measured ?? 0]), 1);
  return (
    <div className={className}>
      {!compact && (
        <ChartLegend
          className="mb-3"
          items={[
            { key: "e", name: pick(c.expected.label), color: "var(--color-chart-ref-edge)", hollow: true },
            { key: "m", name: pick(c.measured.label), color: "var(--color-chart-1)", emphasis: true },
          ]}
        />
      )}
      <ul className="flex flex-col gap-3">
        {c.breakdown.map((row) => {
          // Missing data draws as an empty bar; the figures read "–" and the verdict says there is no data.
          const b = { ...row, expected: row.expected ?? 0, measured: row.measured ?? 0 };
          const under = b.measured <= b.expected;
          return (
            <li key={b.key} className="grid grid-cols-[minmax(4.5rem,6rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
              <span className="text-[13px] text-text">{(t.dimensions.device as Record<string, string>)[b.key] ?? b.key}</span>
              <span aria-hidden className="flex flex-col gap-1">
                <span className="relative h-2.5 rounded-xs border border-chart-ref-edge bg-surface" style={{ width: `${(b.expected / max) * 100}%` }} />
                <span className="relative h-2.5" style={{ width: `${(Math.max(b.expected, b.measured) / max) * 100}%` }}>
                  <span className="absolute inset-y-0 left-0 rounded-xs bg-chart-1" style={{ width: `${(b.measured / Math.max(b.expected, b.measured)) * 100}%` }} />
                  {under && b.expected > b.measured && (
                    <span className="absolute inset-y-0 right-0 overflow-hidden rounded-xs border border-dashed border-border-strong" style={{ width: `${((b.expected - b.measured) / b.expected) * 100}%` }}>
                      <Hatch tone={b.verdict === "does_not_add_up" ? "gap" : "neutral"} />
                    </span>
                  )}
                </span>
              </span>
              <span className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-2xs text-text-muted tnum">
                <span>
                  {f.value(row.expected, c.unit)} · {f.value(row.measured, c.unit)}
                </span>
                <span className="text-text">{f.pct(b.delta_pct, 1, true)}</span>
                <Status verdict={b.verdict} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
