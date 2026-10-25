// A dashboard tile (08-art.md §4.3, 09-ux.md S07): header (title, the check's status at the right), body by chart
// type, foot with the freshness clock. In view mode the whole tile opens the tile drawer and shows no controls;
// in edit mode it shows the drag handle and the ⋯ menu. One tile per dashboard carries the answer mark.
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { cn } from "cn";
import { Clock3Icon, GripVerticalIcon } from "lucide-react";
import type { Compare, Tile, TileResult } from "@/api/types";
import { CHECK_PLATFORM } from "@/ask/labels";
import { CheckBars, CheckChart, DataTable, NoDeviceSplit, Sparkline, SplitBars, TrendChart } from "@/components/charts";
import { DeltaBadge, DeltaFigure, ErrorState, Marked, Status } from "@/components/kit";
import { Tally, TallyCompact } from "@/components/tally/Tally";
import { ExploreBadge, ExploreChart } from "@/components/ask/Explore";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt, useBilingual, useT } from "@/i18n";
import { sourceUnavailableSentence } from "@/lib/errors";
import { useFormat } from "@/lib/format";

export interface TileProps {
  tile: Tile;
  result: TileResult | undefined;
  compare: Compare;
  edit: boolean;
  marked: boolean;
  /** Being moved with the keyboard, or the drop target while dragging. */
  lifted?: boolean;
  dropTarget?: boolean;
  highlight?: boolean;
  busy?: boolean;
  menu?: ReactNode;
  onOpen: () => void;
  onHandleKey?: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  onDragEnd?: () => void;
  onRetry?: () => void;
}

const COLS: Record<number, string> = { 3: "md:col-span-3 xl:col-span-3", 4: "md:col-span-3 xl:col-span-4", 6: "md:col-span-6 xl:col-span-6", 8: "md:col-span-6 xl:col-span-8", 12: "md:col-span-6 xl:col-span-12" };

const CHARTS = new Set(["line", "area", "column", "stacked_column", "both_lines"]);

/** Grid placement. Rows are at least 180 px and grow to fit (a check tile never clips its last line); on phones a
 *  tile takes its own height, and chart tiles keep at least 260 px so the axis sits above the foot line. */
export function tileSpan(tile: Tile) {
  return cn("col-span-1", COLS[tile.size.w], tile.size.h === 2 && "md:row-span-2", CHARTS.has(tile.chart) ? "min-h-[260px] md:min-h-0" : "min-h-[180px] md:min-h-0");
}

export function TileView(p: TileProps) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const { tile, result: r, edit } = p;
  const title = pick(tile.title);
  const check = r?.check;
  const source = tile.query.type === "check" ? fmt(t.dash.tile.source_check, { platform: CHECK_PLATFORM[tile.query.check] }) : tile.query.type === "explore" ? (r?.explore?.tables ?? []).map((x) => x.split(".").at(-1)).join(", ") || "daily_channel_device" : t.dash.tile.source_backoffice;
  // An exploratory tile keeps the period its question had; the foot says which.
  const foot = r ? (tile.query.type === "explore" ? `${source} · ${f.range(tile.query.spec.from, tile.query.spec.to)} · ${f.time(r.ran_at)}` : fmt(t.dash.tile.freshness, { source, date: f.date(r.data_to), time: f.time(r.ran_at) })) : "";
  const describe = check ? `${t.ask.verdict[check.verdict]} ${f.pct(check.delta_pct, 1, true)}` : r?.query ? f.value(r.query.total, r.query.unit) : "";
  return (
    <article
      id={`tile-${tile.id}`}
      onDragOver={p.onDragOver}
      onDrop={p.onDrop}
      aria-busy={p.busy || undefined}
      className={cn(
        "group/tile relative flex min-w-0 scroll-mt-24 flex-col rounded-lg border bg-surface p-4",
        tileSpan(tile),
        edit ? "border-dashed border-border-strong" : "border-border",
        p.lifted && "shadow-md outline-2 outline-ring",
        p.dropTarget && "border-solid bg-well",
        p.highlight && "outline-2 outline-offset-2 outline-ring motion-safe:animate-[aia-outline_2s_var(--ease-out)_both]",
      )}
    >
      {p.busy && <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-lg"><span className="block h-full w-1/3 bg-accent motion-safe:animate-[aia-indeterminate_1.2s_linear_infinite]" /></span>}
      <header className="flex min-h-6 items-center gap-2">
        {edit && (
          <button
            type="button"
            draggable
            onDragStart={p.onDragStart}
            onDragEnd={p.onDragEnd}
            onKeyDown={p.onHandleKey}
            aria-label={fmt(t.dash.edit.handle, { title })}
            aria-pressed={p.lifted || undefined}
            className="-ml-1 hidden size-6 cursor-grab items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text md:inline-flex"
          >
            <GripVerticalIcon size={16} strokeWidth={1.75} aria-hidden />
          </button>
        )}
        {edit ? (
          <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold text-text-strong" title={title}>
            {title}
          </h3>
        ) : (
          <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold text-text-strong" title={title}>
            <button type="button" onClick={p.onOpen} aria-label={fmt(t.dash.tile.open, { title })} aria-description={describe} className="rounded-sm text-left after:absolute after:inset-0 after:rounded-lg after:content-['']">
              {title}
            </button>
          </h3>
        )}
        {check && tile.chart !== "tally" && <Status verdict={check.verdict} />}
        {r?.explore && <ExploreBadge className="hidden sm:inline-flex" />}
        {edit && p.menu}
      </header>
      <div className={cn("mt-2 min-h-0 flex-1", edit && "pointer-events-none")}>
        {!r ? <Skeleton className="h-full min-h-16 w-full" /> : r.error ? <ErrorState size="sm" detail={sourceUnavailableSentence(t, r.error) ?? fmt(t.dash.tile.error, { reason: "" })} onRetry={p.onRetry} /> : <TileBody {...p} />}
      </div>
      <footer className="mt-3 flex items-start gap-1 text-2xs text-text-muted">
        <Clock3Icon size={12} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
        <span className="min-w-0">{foot}</span>
      </footer>
    </article>
  );
}

function TileBody({ tile, result: r, compare, marked }: TileProps) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const title = pick(tile.title);
  if (!r) return null;
  const tall = tile.size.h === 2;
  const wide = tile.size.w >= 6;
  const c = r.check;
  if (c) {
    const prev = r.previous_check;
    const prevLine = compare !== "off" && prev ? fmt(t.dash.tile.prev_check, { delta: f.pct(prev.delta_pct, 1, true), verdict: t.ask.verdict[prev.verdict] }) : null;
    if (tile.chart === "both_lines") return <CheckChart result={c} height={tall ? 230 : 70} />;
    if (tile.chart === "split_bar") return <CheckBars result={c} compact={!tall} />;
    if (tile.chart === "table" && c.breakdown_available === false) return <NoDeviceSplit />;
    if (tile.chart === "table")
      return (
        <DataTable
          label={title}
          dense
          rows={c.breakdown}
          columns={[
            { key: "k", label: t.ask.by_device, render: (b) => (t.dimensions.device as Record<string, string>)[b.key] ?? b.key },
            { key: "e", label: pick(c.expected.label), num: true, render: (b) => f.value(b.expected, c.unit) },
            { key: "m", label: pick(c.measured.label), num: true, render: (b) => f.value(b.measured, c.unit) },
            { key: "d", label: t.tally.difference, num: true, render: (b) => f.pct(b.delta_pct, 1, true) },
          ]}
        />
      );
    if (tall && wide) {
      return (
        <div className="flex h-full flex-col gap-3">
          <Tally result={c} form="inline" mark={marked} showLabel={false} className="hidden md:block" />
          <TallyCompact result={c} mark={marked} className="md:hidden" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
            {c.breakdown.map((b) => (
              <span key={b.key} className="inline-flex items-center gap-2">
                {(t.dimensions.device as Record<string, string>)[b.key]} <span className="font-mono tnum">{f.pct(b.delta_pct, 1, true)}</span> <Status verdict={b.verdict} />
              </span>
            ))}
            {prevLine && <span className="text-2xs text-text-muted">{prevLine}</span>}
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col justify-between gap-1">
        <TallyCompact result={c} mark={marked} />
        {(prevLine || c.findings[0]) && <p className="text-2xs text-text-muted">{prevLine ?? pick(c.findings[0]!.text)}</p>}
      </div>
    );
  }
  if (r.explore) {
    return (
      <div className="flex h-full flex-col gap-2">
        <ExploreBadge className="sm:hidden" />
        <ExploreChart x={r.explore} query={r.query!} compact={!tall} height={tall ? 200 : 76} />
      </div>
    );
  }
  const q = r.query!;
  const cmp = compare !== "off" ? q.comparison : null;
  if (tile.chart === "number") {
    const value = <span className="font-display text-2xl leading-8 font-heading tracking-[-0.012em] text-text-strong tnum">{q.total == null ? t.format.no_data : f.value(q.total, q.unit)}</span>;
    const trend = (r.series ?? q).rows.map((x) => x.value);
    return (
      <div className="@container flex h-full flex-col justify-center">
        <div className="flex items-end justify-between gap-3">
          {marked ? <Marked>{value}</Marked> : value}
          {trend.length > 1 && <Sparkline values={trend} width={72} height={32} area={q.unit === "count" || q.unit === "try"} className="mb-1 hidden shrink-0 @[13rem]:block" />}
        </div>
        {cmp && (
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <DeltaBadge current={q.total} previous={cmp.total} unit={q.unit} />
            <span className="min-w-0 text-2xs text-text-muted">{fmt(t.dash.tile.against, { value: f.value(cmp.total, q.unit) })}</span>
          </div>
        )}
      </div>
    );
  }
  if (tile.chart === "split_bar")
    return (
      <div className="flex h-full flex-col justify-between gap-2 overflow-hidden">
        {q.metric === "roas" && cmp && (
          <p className="text-[13px] text-text">
            <span className="font-mono tnum">{f.value(q.total, q.unit)}</span> <span className="text-text-muted">{fmt(t.dash.tile.against, { value: f.value(cmp.total, q.unit) })}</span>
          </p>
        )}
        <SplitBars query={cmp ? q : { ...q, comparison: null }} title={title} max={tall ? 8 : 3} />
        {q.metric === "roas" && tall && <p className="text-2xs text-text-muted">{t.dash.roas_note}</p>}
      </div>
    );
  if (tile.chart === "table") {
    return (
      <DataTable
        label={title}
        dense
        maxHeight={tall ? 270 : 96}
        rows={q.rows.map((row, i) => ({ ...row, prev: cmp?.rows[i]?.value ?? null }))}
        columns={[
          { key: "k", label: q.group_by === "channel" ? t.ask.by_channel : q.group_by === "device" ? t.ask.by_device : t.check.chart, render: (row) => (t.dimensions.channel as Record<string, string>)[row.key] ?? (t.dimensions.device as Record<string, string>)[row.key] ?? f.date(row.key) },
          { key: "v", label: title, num: true, render: (row) => f.value(row.value, q.unit) },
          ...(cmp ? [{ key: "d", label: <DeltaFigure value="" className="text-2xs" />, num: true, render: (row: { value: number | null; prev: number | null }) => <DeltaBadge current={row.value} previous={row.prev} unit={q.unit} variant="plain" /> }] : []),
        ]}
      />
    );
  }
  const type = tile.chart === "area" ? "area" : tile.chart === "column" ? "column" : "line";
  return <TrendChart query={cmp ? q : { ...q, comparison: null }} type={type} title={title} height={tall ? 220 : 76} compact={!tall} showPrevious={!!cmp} />;
}
