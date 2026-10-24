// The tile drawer (09-ux.md S07, `?tile=`): how the number was worked out. The figure or tally at full size, the
// query in words, the definitions, the SQL, where it ran; Previous tile, Next tile and Ask about this tile.
import { useSearchParams } from "react-router";
import type { DashboardResult, Tile } from "@/api/types";
import { useOpenMetric } from "@/ask/hooks";
import { CheckBars, CheckChart, SplitBars, TrendChart } from "@/components/charts";
import { CodeBlock, DeltaBadge } from "@/components/kit";
import { Tally } from "@/components/tally/Tally";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fmt, useBilingual, useT } from "@/i18n";
import { useFormat } from "@/lib/format";
import { METRIC_LABELS } from "./metricLabels";

export function TileDrawer({ result, onAsk }: { result: DashboardResult; onAsk: (tile: Tile) => void }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const openMetric = useOpenMetric();
  const [params, setParams] = useSearchParams();
  const id = params.get("tile");
  const tiles = result.dashboard.tiles;
  const index = tiles.findIndex((x) => x.id === id);
  const tile = tiles[index];
  const r = result.tiles.find((x) => x.tile_id === id);
  const go = (to: string | null) => {
    const next = new URLSearchParams(params);
    if (to) next.set("tile", to);
    else next.delete("tile");
    setParams(next);
  };
  const c = r?.check;
  const q = r?.query;
  const compare = result.dashboard.compare !== "off";
  const queryLine = tile
    ? tile.query.type === "check"
      ? `${pick(tile.title)}, ${t.check.chart.toLocaleLowerCase()}, ${f.range(result.from, result.to)}`
      : tile.query.type === "explore"
        ? `${pick(tile.title)}, ${f.range(tile.query.spec.from, tile.query.spec.to)} · ${t.ask.explore.badge}`
        : `${pick(METRIC_LABELS[tile.query.metric] ?? tile.title)}, ${f.range(result.from, result.to)}`
    : "";
  const metrics = c ? [c.expected.metric, c.measured.metric] : q && !r?.explore ? [q.metric] : [];
  const sqls = c ? [c.sql.expected, c.sql.measured] : q ? [q.sql, ...(compare && q.comparison ? [q.comparison.sql] : [])] : [];
  return (
    <Sheet open={!!tile} onOpenChange={(o) => !o && go(null)}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]">
        {tile && r && (
          <>
            <SheetHeader className="border-b border-border pr-12">
              <SheetTitle className="text-base font-semibold">{pick(tile.title)}</SheetTitle>
              <SheetDescription className="tnum">
                {f.range(result.from, result.to)} · {fmt(t.dash.drawer.position, { n: index + 1, m: tiles.length })}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {c ? (
                <div className="flex flex-col gap-6">
                  <Tally result={c} />
                  {tile.query.type === "check" && tile.query.split ? <CheckBars result={c} /> : <CheckChart result={c} height={200} />}
                </div>
              ) : q ? (
                <div className="flex flex-col gap-4">
                  <p className="flex flex-wrap items-baseline gap-3">
                    <span className="font-display text-[28px] leading-9 font-heading text-text-strong tnum">{f.value(q.total, q.unit)}</span>
                    {compare && q.comparison && <DeltaBadge current={q.total} previous={q.comparison.total} unit={q.unit} size="md" />}
                    {compare && q.comparison && <span className="text-[13px] text-text-muted">{fmt(t.ask.against, { value: f.value(q.comparison.total, q.unit), range: f.range(q.comparison.from, q.comparison.to) })}</span>}
                  </p>
                  {q.group_by === "channel" || q.group_by === "device" ? <SplitBars query={q} title={pick(tile.title)} /> : q.rows.length > 1 ? <TrendChart query={q} type={q.group_by === "day" ? "line" : "column"} title={pick(tile.title)} height={200} /> : null}
                </div>
              ) : null}
              <dl className="mt-6 flex flex-col gap-4 text-[13px] leading-[18px]">
                <div>
                  <dt className="text-2xs font-medium text-text-muted">{t.dash.drawer.query}</dt>
                  <dd className="mt-0.5 text-text">{queryLine}</dd>
                </div>
                <div>
                  <dt className="text-2xs font-medium text-text-muted">{t.ask.definition}</dt>
                  <dd className="mt-1 flex flex-wrap gap-2">
                    {metrics.map((m) => (
                      <Button key={m} variant="outline" size="xs" onClick={() => openMetric(m)}>
                        {pick(METRIC_LABELS[m]!)}
                      </Button>
                    ))}
                  </dd>
                </div>
                <div className="flex flex-col gap-2">
                  {sqls.map((s, i) => (
                    <CodeBlock key={i} code={s} language="sql" title={`SQL ${i + 1} / ${sqls.length}`} maxHeight={220} />
                  ))}
                </div>
                <p className="text-2xs text-text-muted">{fmt(t.dash.drawer.ran_duckdb, { time: f.time(r.ran_at) })}</p>
              </dl>
            </div>
            <SheetFooter className="flex-row flex-wrap border-t border-border">
              <Button variant="outline" size="sm" disabled={index <= 0} onClick={() => go(tiles[index - 1]!.id)}>
                {t.dash.drawer.prev}
              </Button>
              <Button variant="outline" size="sm" disabled={index >= tiles.length - 1} onClick={() => go(tiles[index + 1]!.id)}>
                {t.dash.drawer.next}
              </Button>
              <Button variant="outline" size="sm" className="ml-auto" onClick={() => onAsk(tile)}>
                {t.dash.drawer.ask}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
