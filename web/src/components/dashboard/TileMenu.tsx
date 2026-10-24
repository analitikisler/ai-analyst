// The tile menu in edit mode (09-ux.md S08): Chart (only the types the metric allows), Size (width and height;
// a width the chart cannot use is disabled with its reason), then Rename, Duplicate, Move earlier, Move later,
// Ask about this tile, Remove. A popover rather than a menu, because Size holds two segmented controls.
import { cn } from "cn";
import { CheckIcon, EllipsisIcon } from "lucide-react";
import type { ChartType, Tile, TileResult, TileWidth, WidthRule } from "@/api/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useOpenMetric } from "@/ask/hooks";
import { fmt, useBilingual, useT } from "@/i18n";

export interface TileMenuProps {
  tile: Tile;
  result: TileResult | undefined;
  index: number;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChart: (c: ChartType) => void;
  onSize: (w: TileWidth, h: 1 | 2) => void;
  onRename: () => void;
  onDuplicate: () => void;
  onMove: (to: number) => void;
  onAsk: () => void;
  onRemove: () => void;
}

const WIDTHS: TileWidth[] = [3, 4, 6, 8, 12];

export function TileMenu(p: TileMenuProps) {
  const t = useT();
  const pick = useBilingual();
  const { tile, result } = p;
  const title = pick(tile.title);
  const openMetric = useOpenMetric();
  // The metric a tile shows (the measured side for a tracking check), for "Open the metric".
  const metricId = tile.query.type === "metric" ? tile.query.metric : tile.query.type === "check" ? result?.check?.measured.metric ?? null : null;
  const charts = result?.valid_charts ?? [tile.chart];
  const rules: WidthRule[] = result?.width_rules[tile.chart] ?? WIDTHS.map((w) => ({ w, ok: true }));
  const reason = rules.find((r) => !r.ok)?.reason;
  const item = "flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-text hover:bg-surface-2 disabled:pointer-events-none disabled:text-text-subtle";
  const close = (fn: () => void) => () => {
    fn();
    p.onOpenChange(false);
  };
  return (
    <Popover open={p.open} onOpenChange={p.onOpenChange}>
      <PopoverTrigger
        aria-label={fmt(t.dash.edit.menu, { title })}
        aria-haspopup="menu"
        className="pointer-events-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
      >
        <EllipsisIcon size={16} strokeWidth={1.75} aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" collisionPadding={{ top: 64, bottom: 8, left: 8, right: 8 }} collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }} className="max-h-[var(--available-height)] w-72 gap-0 overflow-y-auto p-1.5">
        <div role="group" aria-label={t.dash.menu.chart} className="pb-1.5">
          <p className="px-2 pt-1 pb-1 text-2xs font-medium text-text-muted">{t.dash.menu.chart}</p>
          {charts.map((c) => (
            <button key={c} type="button" role="menuitemradio" aria-checked={c === tile.chart} className={item} onClick={close(() => c !== tile.chart && p.onChart(c))}>
              <span className="w-4">{c === tile.chart && <CheckIcon size={14} strokeWidth={2} aria-hidden />}</span>
              {t.dash.chart[c]}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t.dash.menu.size} className="border-t border-border py-2">
          <p className="px-2 pb-1 text-2xs font-medium text-text-muted">{t.dash.menu.size}</p>
          <p id={`w-${tile.id}`} className="px-2 text-2xs text-text-muted">
            {t.dash.menu.width}
          </p>
          <div role="radiogroup" aria-labelledby={`w-${tile.id}`} className="mx-2 mt-1 inline-flex rounded-md border border-border bg-surface-2 p-0.5">
            {rules.map((r) => (
              <button
                key={r.w}
                type="button"
                role="radio"
                aria-checked={tile.size.w === r.w}
                aria-disabled={!r.ok || undefined}
                aria-label={fmt(t.dash.menu.cols, { n: r.w })}
                aria-describedby={!r.ok ? `wr-${tile.id}` : undefined}
                onClick={() => r.ok && r.w !== tile.size.w && p.onSize(r.w, tile.size.h)}
                className={cn("h-6 min-w-8 rounded-sm px-2 font-mono text-xs", tile.size.w === r.w ? "bg-surface text-text-strong ring-1 ring-border-strong ring-inset" : r.ok ? "text-text-muted hover:text-text" : "cursor-not-allowed text-text-subtle line-through")}
              >
                {r.w}
              </button>
            ))}
          </div>
          {reason && (
            <p id={`wr-${tile.id}`} className="mt-1 px-2 text-2xs text-text-muted">
              {t.dash.menu.width_line[reason]}
            </p>
          )}
          <p id={`h-${tile.id}`} className="mt-2 px-2 text-2xs text-text-muted">
            {t.dash.menu.height}
          </p>
          <div role="radiogroup" aria-labelledby={`h-${tile.id}`} className="mx-2 mt-1 inline-flex rounded-md border border-border bg-surface-2 p-0.5">
            {([1, 2] as const).map((h) => (
              <button key={h} type="button" role="radio" aria-checked={tile.size.h === h} onClick={() => h !== tile.size.h && p.onSize(tile.size.w, h)} className={cn("h-6 rounded-sm px-2 text-xs", tile.size.h === h ? "bg-surface text-text-strong ring-1 ring-border-strong ring-inset" : "text-text-muted hover:text-text")}>
                {h === 1 ? t.dash.menu.rows1 : t.dash.menu.rows2}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col border-t border-border pt-1.5">
          <button type="button" className={item} onClick={close(p.onRename)}>
            {t.dash.menu.rename}
          </button>
          <button type="button" className={item} onClick={close(p.onDuplicate)}>
            {t.dash.menu.duplicate}
          </button>
          <button type="button" className={item} aria-disabled={p.index === 0 || undefined} title={p.index === 0 ? t.dash.menu.at_start : undefined} onClick={() => p.index > 0 && p.onMove(p.index - 1)}>
            <span className={cn(p.index === 0 && "text-text-subtle")}>{t.dash.menu.move_earlier}</span>
            {p.index === 0 && <span className="ml-auto text-2xs text-text-subtle">{t.dash.menu.at_start}</span>}
          </button>
          <button type="button" className={item} aria-disabled={p.index === p.count - 1 || undefined} onClick={() => p.index < p.count - 1 && p.onMove(p.index + 1)}>
            <span className={cn(p.index === p.count - 1 && "text-text-subtle")}>{t.dash.menu.move_later}</span>
            {p.index === p.count - 1 && <span className="ml-auto text-2xs text-text-subtle">{t.dash.menu.at_end}</span>}
          </button>
          <button type="button" className={item} onClick={close(p.onAsk)}>
            {t.dash.menu.ask}
          </button>
          {metricId && (
            <button type="button" className={item} onClick={close(() => openMetric(metricId))}>
              {t.dash.menu.metric}
            </button>
          )}
          <button type="button" className={item} onClick={close(p.onRemove)}>
            {t.dash.menu.remove}
          </button>
        </div>
        <p className="border-t border-border px-2 pt-1.5 pb-1 text-2xs text-text-subtle">{t.dash.menu.foot}</p>
      </PopoverContent>
    </Popover>
  );
}
