// One check (09-ux.md S10, F7), shown in the check sheet on a dashboard (owner round 4: Checks moved into the
// dashboard). Verdict and Δ with the section's mark (here the tally is the figure), since-date, the difference-by-day
// chart with the lead-in, the tally and device table, the linked finding, by week, runs, and how it is worked out.
// "Watch this check" is in-app only and says nothing is emailed; "Ask about this" opens the Ask sheet on the check.
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EyeIcon, MessageSquareTextIcon, RotateCcwIcon, ScanSearchIcon } from "lucide-react";
import { useOpenAudit } from "./AuditSheet";
import { useAppState, useCall, useCheck } from "@/api/queries";
import type { CheckId } from "@/api/types";
import { useOpenMetric, useWatchToggle } from "@/ask/hooks";
import { CHECK_LABELS } from "@/ask/labels";
import { CheckEvidenceChart, DataTable, NoDeviceSplit } from "@/components/charts";
import { CodeBlock, Disclosure, Panel, PanelHeader, Status } from "@/components/kit";
import { Tally } from "@/components/tally/Tally";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt, plural, useBilingual, useLang, useT } from "@/i18n";
import { daysBetween } from "@/lib/dates";
import { useFormat } from "@/lib/format";
import { notify } from "@/lib/notify";

/** `period` is the dashboard's: the sheet opens on it, so it shows the same figures as the strip and the tiles. */
export function CheckDetail({ check, period, onAsk }: { check: CheckId; period?: { from: string; to: string }; onAsk: (question?: string) => void }) {
  const t = useT();
  const f = useFormat();
  const lang = useLang();
  const pick = useBilingual();
  const call = useCall();
  const [params, setParams] = useSearchParams();
  const runId = params.get("run") ?? undefined;
  const { data: state } = useAppState();
  const [choice, setChoice] = useState<"dashboard" | 7 | 14 | 28 | 90>(period ? "dashboard" : (state?.check_run?.days as 7 | 14 | 28 | 90 | undefined) ?? 14);
  const days = choice === "dashboard" ? (state?.check_run?.days ?? 14) : choice;
  const { data, isLoading, isFetching } = useCheck(check, choice === "dashboard" && period ? period : { days: choice === "dashboard" ? 14 : choice }, runId);
  const openMetric = useOpenMetric();
  const toggleWatch = useWatchToggle();
  const openAudit = useOpenAudit();
  const title = pick(CHECK_LABELS[check]);
  const watching = !!state?.watches.some((w) => w.check === check);
  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-4 p-4" aria-busy>
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    );
  }
  const c = data.result;
  const why = lang === "tr" ? `${f.range(c.from, c.to)} döneminde GA4 satın almaları neden sipariş panelindeki siparişlerle tutmuyor?` : `Why do GA4 purchases not match back-office orders for ${f.range(c.from, c.to)}?`;
  const sinceDays = c.out_of_tolerance_since ? daysBetween(c.out_of_tolerance_since, c.to) + 1 : 0;
  const runAgain = async () => {
    const r = await call("run_all_checks", { days });
    notify(fmt(t.checks.last_run, { time: f.whenMid(r.created_at), n: r.results.length, bad: r.results.filter((x) => x.verdict === "does_not_add_up").length, from: f.date(r.from), to: f.date(r.to, true) }), { type: "success" });
  };
  const runRun = runId ? data.runs.find((r) => r.id === runId) : null;
  // A failing GA4 check whose finding points to the purchase journey can start an ai tag debugger audit.
  const journey = c.verdict === "does_not_add_up" && c.findings.some((x) => x.since) && (check === "ga4_vs_orders" || check === "ga4_rev_vs_revenue");
  const lastAudit = state?.audits.find((a) => a.check === check) ?? null;
  const runLink = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("run", id);
    return next.toString();
  };
  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      <header className="flex flex-col gap-3 pr-10">
        <h2 className="text-lg leading-6 font-semibold text-text-strong">{title}</h2>
        <div className="flex flex-wrap gap-2">
          {journey && (
            <Button size="sm" onClick={() => openAudit(lastAudit && (lastAudit.status === "handoff" || lastAudit.result?.ok === false) && !state?.audit_fixed ? { run: lastAudit.id } : { check })}>
              <ScanSearchIcon strokeWidth={1.75} data-icon="inline-start" />
              {lastAudit && !state?.audit_fixed ? t.audit.open_result : lastAudit ? t.audit.again : t.audit.action}
            </Button>
          )}
          <Button variant="outline" size="sm" aria-pressed={watching} className={watching ? "bg-surface-2" : undefined} onClick={() => void toggleWatch(check, watching)}>
            <EyeIcon strokeWidth={1.75} data-icon="inline-start" />
            {watching ? t.ask.watching : journey ? t.audit.watch_until : t.ask.watch}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onAsk(c.verdict === "does_not_add_up" && check === "ga4_vs_orders" ? why : undefined)}>
            <MessageSquareTextIcon strokeWidth={1.75} data-icon="inline-start" />
            {t.check.ask_about}
          </Button>
          <label className="flex items-center">
            <span className="sr-only">{t.check.period_label}</span>
            <NativeSelect size="sm" value={String(choice)} onChange={(e) => setChoice(e.target.value === "dashboard" ? "dashboard" : (Number(e.target.value) as 7 | 14 | 28 | 90))} className="w-auto max-w-full">
              {period && <NativeSelectOption value="dashboard">{fmt(t.check.period_dashboard, { range: f.range(period.from, period.to) })}</NativeSelectOption>}
              {([7, 14, 28, 90] as const).map((d) => (
                <NativeSelectOption key={d} value={d}>
                  {t.checks.period[`last_${d}`]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <Button variant="ghost" size="sm" onClick={() => void runAgain()} disabled={isFetching}>
            <RotateCcwIcon strokeWidth={1.75} data-icon="inline-start" />
            {t.check.run_again}
          </Button>
        </div>
      </header>
      {watching && <p className="-mt-2 max-w-[72ch] text-[13px] text-text-muted">{t.check.watch_line}</p>}
      {runRun && (
        <p className="flex flex-wrap items-center gap-3 rounded-md bg-surface-2 px-3 py-2 text-[13px] text-text-muted">
          {fmt(t.check.run_view, { time: f.whenMid(runRun.created_at) })}
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete("run");
              setParams(next, { replace: true });
            }}
          >
            {t.check.show_today}
          </Button>
        </p>
      )}
      <Panel className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Status verdict={c.verdict} size="lg" />
          <span className="font-mono text-[13px] text-text-muted tnum">{f.range(c.from, c.to)}</span>
          {c.out_of_tolerance_since && c.verdict === "does_not_add_up" && <span className="text-[13px] text-text-muted">{plural(lang, sinceDays, t.check.since, { date: f.since(c.out_of_tolerance_since), n: sinceDays })}</span>}
        </div>
        <div className="mt-6 grid gap-6">
          <div className="order-2 min-w-0">
            <CheckEvidenceChart result={c} height={240} />
            <p className="mt-2 text-2xs text-text-muted">{fmt(t.check.chart_context, { n: 14 })}</p>
          </div>
          <div className="order-1 flex min-w-0 flex-col gap-5">
            <Tally result={c} mark play />
            {data.previous && <p className="text-2xs text-text-muted">{fmt(t.check.previous, { delta: f.pct(data.previous.delta_pct, 1, true), verdict: t.ask.verdict[data.previous.verdict] })}</p>}
          </div>
        </div>
        <div className="mt-6 border-t border-border pt-4">
          {c.breakdown_available === false ? (
            <NoDeviceSplit />
          ) : (
            <DataTable
              label={t.ask.by_device}
              dense
              rows={c.breakdown}
              columns={[
                { key: "k", label: t.ask.by_device, render: (b) => (t.dimensions.device as Record<string, string>)[b.key] ?? b.key },
                { key: "e", label: pick(c.expected.label), num: true, render: (b) => f.value(b.expected, c.unit) },
                { key: "m", label: pick(c.measured.label), num: true, render: (b) => f.value(b.measured, c.unit) },
                { key: "d", label: t.tally.difference, num: true, render: (b) => f.pct(b.delta_pct, 1, true) },
                { key: "v", label: t.checks.col.verdict, render: (b) => <Status verdict={b.verdict} /> },
              ]}
            />
          )}
        </div>
      </Panel>
      {c.findings.map((fd) => (
        <Panel key={fd.id} padded>
          <h2 className="text-base font-semibold text-text-strong">{t.check.finding_title}</h2>
          <p className="mt-1 text-sm text-text">{pick(fd.text)}</p>
          {fd.since && <p className="mt-1 font-mono text-2xs text-text-muted">{fmt(t.check.finding_meta, { source: fd.source, date: f.since(fd.since), release: "v4.12" })}</p>}
          {fd.confirmed && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[13px] text-text">
              <ScanSearchIcon size={14} strokeWidth={1.75} aria-hidden className="text-text-muted" />
              {fmt(t.audit.confirmed, { time: f.when(fd.confirmed.at) })}
              <button type="button" onClick={() => openAudit({ run: fd.confirmed!.audit_id })} className="rounded-sm font-medium text-accent hover:underline">
                {t.audit.open_result}
              </button>
            </p>
          )}
        </Panel>
      ))}
      {c.verdict === "does_not_add_up" && !c.findings.length && (
        <Panel padded>
          <p className="text-[13px] text-text-muted">{t.check.no_finding}</p>
          <CodeBlock code={`npx -y @analitikisler/ai-tag-debugger run --site ${state?.workspace.demo === false ? "your-site.example" : "ornekmoda.example"} --journey purchase`} className="mt-2" />
        </Panel>
      )}
      <Panel>
        <PanelHeader title={t.check.weeks_title} subtitle={t.check.weeks_lead} />
        <div className="p-4">
          <DataTable
            label={t.check.weeks_title}
            rows={data.weeks}
            columns={[
              { key: "w", label: t.check.weeks_col.week, render: (w) => <span className="font-mono tnum">{f.range(w.from, w.to)}</span> },
              { key: "e", label: pick(c.expected.label), num: true, render: (w) => f.value(w.expected, c.unit) },
              { key: "m", label: pick(c.measured.label), num: true, render: (w) => f.value(w.measured, c.unit) },
              { key: "d", label: t.tally.difference, num: true, render: (w) => f.pct(w.delta_pct, 1, true) },
              { key: "v", label: t.checks.col.verdict, render: (w) => <Status verdict={w.verdict} /> },
            ]}
          />
        </div>
      </Panel>
      <Panel>
        <PanelHeader title={t.check.runs_title} />
        <ul className="p-4 pt-2">
          {data.runs.map((r) => (
            <li key={r.id} className="border-b border-border py-2 last:border-0">
              <Link to={`?${runLink(r.id)}`} replace className="flex flex-wrap items-center gap-x-3 rounded-sm text-[13px] text-text hover:underline">
                <span className="font-mono tnum">{f.when(r.created_at)}</span>
                <span className="text-text-muted">{r.actor === "person" ? t.activity.actor.person : t.activity.actor.system}</span>
                <Status verdict={r.verdict} />
                <span className="font-mono tnum">{f.pct(r.delta_pct, 1, true)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel className="px-4">
        <Disclosure label={t.check.how}>
          <div className="flex flex-col gap-3 text-[13px]">
            <p className="text-text">{fmt(t.check.rule, { t: f.pct(c.tolerance, 0), expected: pick(c.expected.label).toLocaleLowerCase(lang) })}</p>
            <p className="flex flex-wrap gap-2">
              {[c.expected.metric, c.measured.metric].map((m) => (
                <Button key={m} variant="outline" size="xs" onClick={() => openMetric(m)}>
                  {m === c.expected.metric ? pick(c.expected.label) : pick(c.measured.label)}
                </Button>
              ))}
            </p>
            <CodeBlock code={c.sql.expected} language="sql" title={`SQL ${1} / ${2}`} maxHeight={220} />
            <CodeBlock code={c.sql.measured} language="sql" title={`SQL ${2} / ${2}`} maxHeight={220} />
          </div>
        </Disclosure>
      </Panel>
    </div>
  );
}
