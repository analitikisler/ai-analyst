// Exploratory answers and tiles (owner round 4): a query the model wrote against the mart, outside the metric set.
// Always labelled with a neutral badge "Exploratory · not checked" and its tooltip; never a verdict, never the orange
// mark. The result is drawn by its shape with the same chart rules as metrics.
import { CompassIcon } from "lucide-react";
import { cn } from "cn";
import { useAppState } from "@/api/queries";
import type { ExploreResult, QueryResult } from "@/api/types";
import { DataTable, SplitBars, TrendChart } from "@/components/charts";
import { CodeBlock, Disclosure } from "@/components/kit";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { plural, useBilingual, useLang, useT } from "@/i18n";
import { useFormat } from "@/lib/format";

export function ExploreBadge({ className }: { className?: string }) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className={cn("inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-sm border border-warning/50 bg-warning-soft px-1.5 text-2xs font-medium text-text outline-offset-2", className)}
          />
        }
      >
        <CompassIcon size={12} strokeWidth={1.75} aria-hidden />
        {t.ask.explore.badge}
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{t.ask.explore.tip}</TooltipContent>
    </Tooltip>
  );
}

/** A key of the result in words: channel, device or weekday names, a week as its start date. */
export function useExploreKey() {
  const t = useT();
  const f = useFormat();
  return (dim: string, key: string | number | null) => {
    const k = String(key);
    if (dim === "week") return f.date(k);
    const maps = { channel: t.dimensions.channel, device: t.dimensions.device, weekday: t.dimensions.weekday } as Record<string, Record<string, string>>;
    return maps[dim]?.[k] ?? k;
  };
}

/** The result drawn by its shape. `query` is the same result as a query result, for the shared charts. */
export function ExploreChart({ x, query, compact, height = 220 }: { x: ExploreResult; query: QueryResult; compact?: boolean; height?: number }) {
  const f = useFormat();
  const pick = useBilingual();
  const name = useExploreKey();
  const title = pick(x.label);
  if (x.shape === "number") {
    return <p className="font-display text-2xl leading-8 font-heading tracking-[-0.012em] text-text-strong tnum">{f.value(query.total, x.unit)}</p>;
  }
  if (x.shape === "series") return <TrendChart query={query} type="column" title={title} height={height} compact={compact} showPrevious={false} />;
  if (x.shape === "category") return <SplitBars query={{ ...query, rows: query.rows.map((r) => ({ ...r, key: r.key })) }} title={title} max={compact ? 4 : undefined} names={(k) => name(x.spec.dims[0] ?? "channel", k)} />;
  const dims = x.spec.dims;
  return (
    <DataTable
      label={title}
      dense
      maxHeight={compact ? 200 : 280}
      rows={x.rows.map((r, i) => ({ i, r }))}
      columns={[
        ...dims.map((d, j) => ({ key: `d${j}`, label: pick(x.columns[j]!), render: (row: { r: (string | number | null)[] }) => name(d, row.r[j] ?? null) })),
        { key: "v", label: title, num: true, render: (row: { r: (string | number | null)[] }) => f.value(row.r[row.r.length - 1] as number | null, x.unit) },
      ]}
    />
  );
}

/** The model's SQL, open by default, and the way to make it a metric. */
export function ExploreWorking({ x, title }: { x: ExploreResult; title: string }) {
  const t = useT();
  const f = useFormat();
  const lang = useLang();
  const { data } = useAppState();
  const demo = data?.source.kind !== "bigquery";
  const href = demo
    ? `https://github.com/analitikisler/ai-analyst/issues/new?title=${encodeURIComponent(`Metric request: ${title}`)}`
    : `mailto:hello@analitikisler.com?subject=${encodeURIComponent(t.help.subject_metric)}`;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Disclosure label={t.ask.explore.sql_label} meta={plural(lang, x.rows.length, t.ask.explore.rows, { n: f.int(x.rows.length), bytes: f.bytes(x.bytes) })} defaultOpen>
        <CodeBlock code={x.sql} language="sql" title="1 / 1" maxHeight={260} />
      </Disclosure>
      <p className="text-[13px] leading-[18px] text-text-muted">
        {t.ask.explore.not_metric}{" "}
        <a href={href} target={demo ? "_blank" : undefined} rel="noreferrer" className="font-medium text-accent hover:underline">
          {t.ask.explore.add_metric}
        </a>
        {demo && <span className="sr-only"> {t.common.opens_tab}</span>}
        {!demo && <span className="sr-only"> {t.common.opens_email}</span>}
      </p>
    </div>
  );
}

