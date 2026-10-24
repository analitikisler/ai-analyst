// Ported from Overt (ui/KpiCard.tsx): label + InfoTip, the value in the display face with a muted unit,
// delta chip, comparison line, a sparkline when the tile is wide enough (container query). 20 px padding.
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import type { Unit } from "@/api/types";
import { Sparkline } from "@/components/charts";
import { Skeleton } from "@/components/ui/skeleton";
import { DeltaBadge } from "./DeltaBadge";
import { InfoTip, type GlossaryTerm } from "./InfoTip";

export interface KpiCardProps {
  label: ReactNode;
  /** Pre-formatted value ("1.84M TL", "2,753"). */
  value: ReactNode;
  /** Small muted unit after the value. */
  unit?: ReactNode;
  /** Current and previous raw values for the delta chip, in the metric's unit. */
  delta?: { current: number | null; previous: number | null; unit: Unit };
  /** Comparison line under the delta ("against 9–15 Oct 2026"). */
  comparison?: ReactNode;
  info?: GlossaryTerm | ReactNode;
  /** Sparkline values (null = gap). */
  trend?: (number | null)[];
  trendColor?: string;
  /** Flat tint under the sparkline: additive metrics only. */
  trendArea?: boolean;
  /** `hero` = 36 px value for a lone headline figure. */
  size?: "default" | "hero";
  loading?: boolean;
  /** Makes the whole tile a link. */
  to?: string;
  className?: string;
}

const isGlossary = (v: unknown): v is GlossaryTerm => !!v && typeof v === "object" && "term" in v && "short" in v;

export function KpiCard({ label, value, unit, delta, comparison, info, trend, trendColor = "var(--color-chart-1)", trendArea, size = "default", loading, to, className }: KpiCardProps) {
  const body = (
    <>
      <div className="flex items-center gap-1">
        <span className="truncate eyebrow">{label}</span>
        {info != null && (isGlossary(info) ? <InfoTip term={info} /> : <InfoTip content={info} />)}
      </div>
      {loading ? (
        <>
          <Skeleton className={cn("mt-3", size === "hero" ? "h-10 w-28" : "h-8 w-20")} />
          <Skeleton className="mt-3 h-4 w-24" />
        </>
      ) : (
        <>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-1">
              <span className={cn("font-display font-heading tracking-[-0.012em] text-text-strong tnum", size === "hero" ? "text-4xl leading-10" : "text-2xl leading-8")}>{value}</span>
              {unit && <span className={cn("text-text-muted tnum", size === "hero" ? "text-xl" : "text-sm")}>{unit}</span>}
            </div>
            {trend && trend.length > 1 && (
              <Sparkline values={trend} color={trendColor} area={trendArea} width={72} height={32} className="mb-1 hidden shrink-0 @[13rem]:block" />
            )}
          </div>
          {(delta || comparison) && (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {delta && <DeltaBadge current={delta.current} previous={delta.previous} unit={delta.unit} />}
              {comparison && <span className="min-w-0 text-xs text-text-subtle">{comparison}</span>}
            </div>
          )}
        </>
      )}
    </>
  );
  const cls = cn("@container block min-w-0 rounded-lg border border-border bg-surface p-4 sm:p-5", to && "transition-[border-color] duration-160 hover:border-border-strong", className);
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-print="avoid-break" aria-busy={loading || undefined}>
      {body}
    </div>
  );
}
