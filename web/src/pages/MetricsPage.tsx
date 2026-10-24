// Metrics, the data dictionary (owner round 5): every metric in the pack (metrics/*.yaml) with its definition, unit,
// source, version and the tracking checks that use it, searchable and filterable by source; and one page per metric
// (definition in plain words and in full, the compiled SQL, the last 90 days, its tracking checks, where it is used,
// its version history, Ask about this metric). Metrics proposed from exploratory answers wait here for Accept or
// Decline; an accepted one stays not checked.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { cn } from "cn";
import { BookOpenTextIcon, ChevronRightIcon, MessageSquareTextIcon, SearchIcon } from "lucide-react";
import { useAppState, useCall, useMetric, useMetricEntries } from "@/api/queries";
import type { MetricEntry } from "@/api/types";
import { useOpenAskSheet } from "@/ask/hooks";
import { TrendChart } from "@/components/charts";
import { CodeBlock, EmptyState, Page, PageHeader, Panel, PanelHeader, Status } from "@/components/kit";
import { TopBarContent, usePhoneTitle } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt, plural, useBilingual, useLang, useT } from "@/i18n";
import { useFormat } from "@/lib/format";
import { notify } from "@/lib/notify";
import { NotFoundInline } from "./NotFoundPage";

type SourceFilter = "all" | "backoffice" | "ga4" | "google_ads" | "meta" | "tiktok";
const matchesSource = (e: MetricEntry, f: SourceFilter) => f === "all" || (f === "backoffice" || f === "ga4" ? e.source.split("+").includes(f) : e.source.split("+").includes("ads"));

export default function MetricsPage() {
  const { metricId } = useParams();
  return metricId ? <MetricDetail id={metricId} /> : <MetricList />;
}

function useSourceName() {
  const t = useT();
  return (s: string) =>
    s === "model"
      ? t.ask.explore.sql_label
      : s
          .split("+")
          .map((x) => (t.metric.sources as Record<string, string>)[x] ?? x)
          .join(", ");
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" | "accent" }) {
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 text-2xs font-medium", tone === "warn" ? "border-warning/50 bg-warning-soft text-text" : tone === "accent" ? "border-accent/40 bg-accent-soft text-accent-ink" : "border-border bg-surface-2 text-text-muted")}>
      {children}
    </span>
  );
}

function MetricList() {
  const t = useT();
  const pick = useBilingual();
  const lang = useLang();
  const sourceName = useSourceName();
  const { data, isLoading } = useMetricEntries();
  const { data: state } = useAppState();
  const [q, setQ] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  usePhoneTitle(t.metrics.title);
  const rows = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase(lang);
    return (data ?? []).filter((e) => matchesSource(e, source) && (!needle || `${pick(e.label)} ${pick(e.description)} ${e.id}`.toLocaleLowerCase(lang).includes(needle)));
  }, [data, q, source, lang, pick]);
  const checkName = (id: string) => pick(state?.checks.find((c) => c.check === id)?.label ?? { en: id, tr: id });
  return (
    <Page className="max-w-[1080px]">
      <TopBarContent />
      <PageHeader title={t.metrics.title} subtitle={t.metrics.lead} />
      {!!state?.metric_proposals && <p className="-mt-2 text-[13px] text-text">{plural(lang, state.metric_proposals, t.metrics.proposals, { n: state.metric_proposals })}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t.metrics.search}</span>
          <SearchIcon size={14} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-subtle" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.metrics.search} className="pl-8" />
        </label>
        <label>
          <span className="sr-only">{t.metrics.col.source}</span>
          <NativeSelect value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} className="w-full sm:w-48">
            <NativeSelectOption value="all">{t.metrics.source_all}</NativeSelectOption>
            {(["backoffice", "ga4", "google_ads", "meta", "tiktok"] as const).map((s) => (
              <NativeSelectOption key={s} value={s}>
                {t.metrics.sources_filter[s]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      {isLoading && <Skeleton className="h-80 w-full rounded-lg" />}
      {data && !rows.length && <EmptyState bordered icon={BookOpenTextIcon} title={t.metrics.empty} />}
      {rows.length > 0 && (
        <ul className="overflow-hidden rounded-lg border border-border bg-surface">
          {rows.map((e) => (
            <li key={e.id} className="border-b border-border last:border-0">
              <Link to={`/metrics/${e.id}`} className="grid grid-cols-[minmax(0,1fr)_1rem] items-start gap-x-3 gap-y-1 px-4 py-3 outline-offset-[-2px] transition-colors hover:bg-surface-2">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-text-strong">{pick(e.label)}</span>
                    <span className="font-mono text-2xs text-text-muted">v{e.version}</span>
                    {e.status === "proposed" && <Badge tone="accent">{t.metrics.proposed}</Badge>}
                    {e.status === "accepted" && <Badge>{t.metrics.accepted}</Badge>}
                  </span>
                  <span className="line-clamp-2 text-[13px] leading-[18px] text-text-muted">{pick(e.description)}</span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-text-muted">
                    <span>{t.metric.units[e.unit]}</span>
                    <span>{sourceName(e.source)}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {e.checks.length ? e.checks.map((c) => <Badge key={c}>{checkName(c)}</Badge>) : <Badge tone="warn">{t.metrics.not_checked}</Badge>}
                    </span>
                  </span>
                </span>
                <ChevronRightIcon size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 text-text-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

function MetricDetail({ id }: { id: string }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const call = useCall();
  const sourceName = useSourceName();
  const openAsk = useOpenAskSheet();
  const { data: state } = useAppState();
  const { data, isLoading, error } = useMetric(id);
  const [busy, setBusy] = useState(false);
  usePhoneTitle(data ? pick(data.entry.label) : t.metrics.title);
  if (error) return <NotFoundInline title={fmt(t.metrics.not_found, { id })} action={t.metrics.back} to="/metrics" />;
  if (isLoading || !data) {
    return (
      <Page className="max-w-[1080px]" aria-busy>
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </Page>
    );
  }
  const e = data.entry;
  const decide = async (accept: boolean) => {
    setBusy(true);
    try {
      await call("decide_metric", { metric: e.id, accept });
      notify(accept ? t.metrics.accepted_toast : t.metrics.declined_toast, { type: "success" });
    } finally {
      setBusy(false);
    }
  };
  const demo = state?.source.kind !== "bigquery";
  return (
    <Page className="max-w-[1080px] min-w-0 overflow-x-clip">
      <TopBarContent />
      <PageHeader
        title={pick(e.label)}
        breadcrumbs={[{ label: t.metrics.title, to: "/metrics" }, { label: pick(e.label) }]}
        titleAddon={e.status === "proposed" ? <Badge tone="accent">{t.metrics.proposed}</Badge> : e.status === "accepted" ? <Badge>{t.metrics.accepted}</Badge> : <span className="font-mono text-2xs text-text-muted">v{e.version}</span>}
        actions={
          <Button variant="outline" onClick={() => openAsk(`metric:${e.id}`)}>
            <MessageSquareTextIcon strokeWidth={1.75} data-icon="inline-start" />
            {t.metrics.ask}
          </Button>
        }
      />
      <p className="-mt-3 max-w-[72ch] text-base leading-6 text-text">{pick(e.description)}</p>
      {e.status === "proposed" && (
        <Panel padded className="flex flex-col gap-3 border-accent/40">
          {data.proposal && (
            <p className="text-[13px] text-text-muted">
              {fmt(t.metrics.from_answer, { q: data.proposal.question })}
              {data.proposal.conversation_id && (
                <>
                  {" · "}
                  <Link to={`/ask/${data.proposal.conversation_id}`} className="font-medium text-accent hover:underline">
                    {t.metrics.open_answer}
                  </Link>
                </>
              )}
            </p>
          )}
          <p className="text-[13px] text-text">{!__DEMO__ ? t.metrics.proposal_note_server : demo ? t.metrics.proposal_note_demo : t.metrics.proposal_note_own}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void decide(true)}>
              {t.metrics.accept}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void decide(false)}>
              {t.metrics.decline}
            </Button>
          </div>
        </Panel>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {data.series && (
            <Panel padded>
              <h2 className="mb-2 text-sm font-semibold text-text-strong">{t.metrics.last_90}</h2>
              <TrendChart query={data.series} type="line" title={pick(e.label)} height={200} showPrevious={false} />
            </Panel>
          )}
          <Panel>
            <PanelHeader title={t.metrics.working} subtitle={`${t.metric.unit}: ${t.metric.units[e.unit]} · ${t.metric.source}: ${sourceName(e.source)}`} />
            <dl className="grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 p-4 text-[13px] leading-[18px]">
              {data.definition.map((row) => (
                <div key={row.label.en} className="contents">
                  <dt className="text-text-muted">{pick(row.label)}</dt>
                  <dd className="min-w-0 text-text">{pick(row.value)}</dd>
                </div>
              ))}
            </dl>
            <div className="px-4 pb-4">
              <CodeBlock code={data.sql} language="sql" title={e.status === "active" ? t.metrics.sql : t.metrics.sql_model} maxHeight={260} />
            </div>
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Panel>
            <PanelHeader title={t.metrics.checks_title} />
            <div className="p-4 pt-2">
              {data.checks.length ? (
                <ul className="flex flex-col divide-y divide-border">
                  {data.checks.map((c) => (
                    <li key={c.id} className="py-2">
                      <Link to={`/dashboards?check=${c.id}`} className="flex flex-col gap-0.5 rounded-sm hover:underline">
                        <span className="flex flex-wrap items-center gap-2 text-[13px] text-text">
                          <Status verdict={c.verdict} />
                          <span className="font-mono tnum">{f.pct(c.delta_pct, 1, true)}</span>
                        </span>
                        <span className="text-[13px] text-text">{pick(c.label)}</span>
                        <span className="text-2xs text-text-muted">
                          {t.metrics.role[c.role]} · <span className="font-mono tnum">{f.range(c.from, c.to)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex flex-col gap-2 text-[13px] text-text-muted">
                  <Badge tone="warn">{t.metrics.not_checked}</Badge>
                  {t.metrics.checks_none}
                </p>
              )}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title={t.metrics.used_in} />
            <div className="p-4 pt-2 text-[13px]">
              {data.used_in.length ? (
                <ul className="flex flex-col gap-1.5">
                  {data.used_in.map((u) => (
                    <li key={u.tile_id}>
                      <Link to={`/dashboards/${u.dashboard_id}#tile-${u.tile_id}`} className="font-medium text-accent hover:underline">
                        {pick(u.dashboard)} › {pick(u.title)}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-text-muted">{t.metrics.used_none}</p>
              )}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title={t.metrics.history} />
            <ol className="flex flex-col gap-3 p-4 pt-2 text-[13px] leading-[18px]">
              {data.history.map((h, i) => (
                <li key={i} className="flex flex-col gap-0.5">
                  <span className="font-mono text-2xs text-text-muted tnum">
                    {h.version > 0 ? `v${h.version} · ` : ""}
                    {f.date(h.date, true)} · {pick(h.actor)}
                  </span>
                  <span className="text-text">{pick(h.change)}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </Page>
  );
}
