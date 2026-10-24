// Ported from Overt (ui/FilterBar.tsx). Overt binds period + engine to the URL; a dashboard here has one period
// and one comparison, set once per dashboard (DECISIONS.md §5), so the bar is controlled. Year on year is
// disabled with its reason when the data does not reach back a year.
import { cn } from "cn";
import type { Compare, PeriodKey } from "@/api/types";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useT } from "@/i18n";

export const PERIODS: PeriodKey[] = ["last_7", "last_14", "last_28", "last_90", "last_week", "this_month", "last_month"];
export const COMPARISONS: Compare[] = ["off", "previous_period", "previous_year"];

export interface FilterBarProps {
  period: PeriodKey;
  onPeriodChange: (p: PeriodKey) => void;
  compare?: Compare;
  onCompareChange?: (c: Compare) => void;
  yoyDisabledReason?: string;
  full?: boolean;
  className?: string;
}

export function FilterBar({ period, onPeriodChange, compare, onCompareChange, yoyDisabledReason, full, className }: FilterBarProps) {
  const t = useT();
  return (
    <div className={cn(full ? "grid grid-cols-2 gap-2" : "flex items-center gap-2", className)} role="group" aria-label={t.dash.filters}>
      <label className="flex min-w-0 flex-col">
        <span className="sr-only">{t.dash.period.label}</span>
        <NativeSelect size="sm" value={period} onChange={(e) => onPeriodChange(e.target.value as PeriodKey)} className={full ? "w-full" : "w-44"}>
          {PERIODS.map((p) => (
            <NativeSelectOption key={p} value={p}>
              {t.dash.period[p]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      {compare && onCompareChange && (
        <label className="flex min-w-0 flex-col">
          <span className="sr-only">{t.dash.compare.label}</span>
          <NativeSelect size="sm" value={compare} onChange={(e) => onCompareChange(e.target.value as Compare)} className={full ? "w-full" : "w-48"} title={yoyDisabledReason}>
            {COMPARISONS.map((c) => (
              <NativeSelectOption key={c} value={c} disabled={c === "previous_year" && !!yoyDisabledReason}>
                {c === "off" ? `${t.dash.compare.label}: ${t.dash.compare.off}` : t.dash.compare[c]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      )}
    </div>
  );
}
