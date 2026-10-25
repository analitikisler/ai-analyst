// "Test the purchase journey" (owner round 5): an ai tag debugger audit started from a failing tracking check. The
// sheet lives on every page (`?audit=new:<check>` for the form, `?audit=<run id>` for a result). In the prototype the run
// is simulated: the steps stream with the hits each sent, then the result links back to the tracking check.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CheckIcon, EyeIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useAppState, useAudit, useCall } from "@/api/queries";
import type { AuditPlatform, AuditRun, CheckId } from "@/api/types";
import { useWatchToggle } from "@/ask/hooks";
import { CHECK_LABELS } from "@/ask/labels";
import { CodeBlock, CopyButton, Status } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useBilingual, useT } from "@/i18n";
import { useFormat } from "@/lib/format";
import { notify } from "@/lib/notify";

const PLATFORMS: AuditPlatform[] = ["ga4", "google_ads", "meta", "tiktok"];

/** On own data the server hands the audit to ai tag debugger instead of simulating it: the MCP steps to run and,
 *  when its app is installed, a deep link with the journey prefilled. result and finished_at are null meanwhile. */
type Handoff = NonNullable<AuditRun["handoff"]>;
type AuditFinding = NonNullable<AuditRun["result"]>;
const STEP_MS = 520;

/** Opens the audit sheet for a check (the form) or for a finished run. */
export function useOpenAudit() {
  const [params, setParams] = useSearchParams();
  return (target: { check: CheckId } | { run: string }) => {
    const next = new URLSearchParams(params);
    next.set("audit", "check" in target ? `new:${target.check}` : target.run);
    setParams(next);
  };
}

export function AuditSheet() {
  const t = useT();
  const pick = useBilingual();
  const [params, setParams] = useSearchParams();
  const param = params.get("audit");
  const isNew = !!param?.startsWith("new:");
  const check = (isNew ? param!.slice(4) : null) as CheckId | null;
  const runId = param && !isNew ? param : null;
  const { data: run } = useAudit(runId);
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("audit");
    setParams(next);
  };
  const checkId = check ?? run?.check ?? null;
  const { data: state } = useAppState();
  const demo = state?.workspace.demo !== false;
  return (
    <Sheet open={!!param} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="text-base font-semibold">{t.audit.title}</SheetTitle>
          <SheetDescription>{checkId ? pick(CHECK_LABELS[checkId]) : ""}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isNew && check ? <AuditForm check={check} onStarted={(id) => setParams((p) => { const n = new URLSearchParams(p); n.set("audit", id); return n; }, { replace: true })} /> : run ? <AuditResult run={run} /> : null}
        </div>
        {demo && !(run && run.status === "handoff") && (
          <SheetFooter className="border-t border-border">
            <p className="text-2xs text-text-muted">{t.audit.simulated}</p>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Runs started in this session stream their steps once. */
const streamed = new Set<string>();

function AuditForm({ check, onStarted }: { check: CheckId; onStarted: (id: string) => void }) {
  const t = useT();
  const call = useCall();
  const { data: state } = useAppState();
  // The demo shop's address on demo data; on own data the person types the site.
  const demo = state?.workspace.demo !== false;
  const [url, setUrl] = useState(state && !demo ? "" : "ornekmoda.example");
  // The app state can arrive after the sheet opened (a reload on an audit link): clear the demo address then.
  useEffect(() => {
    if (!demo) setUrl((u) => (u === "ornekmoda.example" ? "" : u));
  }, [demo]);
  const [platforms, setPlatforms] = useState<AuditPlatform[]>(["ga4"]);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const run = await call("start_tracking_audit", { check, url, device: "mobile_safari", platforms });
      onStarted(run.id);
    } finally {
      setBusy(false);
    }
  };
  const row = "flex flex-col gap-1.5";
  const label = "text-2xs font-medium text-text-muted";
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (platforms.length && url.trim()) void start();
      }}
    >
      <p className="text-[13px] leading-[18px] text-text">
        {t.audit.lead} {demo ? t.audit.lead_demo : t.audit.lead_own}
      </p>
      <div className={row}>
        <span className={label}>{t.audit.journey}</span>
        <span className="text-sm text-text">{t.audit.journey_purchase}</span>
      </div>
      <div className={row}>
        <span className={label}>{t.audit.device}</span>
        <span className="text-sm text-text">{t.audit.device_value}</span>
      </div>
      <div className={row}>
        <label htmlFor="audit-url" className={label}>
          {t.audit.url}
        </label>
        <Input id="audit-url" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <fieldset className={row}>
        <legend className={`${label} mb-1.5`}>{t.audit.platforms}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm text-text">
              <Checkbox checked={platforms.includes(p)} onCheckedChange={(v) => setPlatforms((x) => (v ? [...x, p] : x.filter((y) => y !== p)))} />
              {t.audit.platform[p]}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <Button type="submit" disabled={busy || !platforms.length || !url.trim()}>
          {busy && <Spinner data-icon="inline-start" />}
          {t.audit.start}
        </Button>
      </div>
    </form>
  );
}

function AuditResult({ run }: { run: AuditRun }) {
  const t = useT();
  if (run.status === "handoff" && run.handoff) return <AuditHandoff run={run} handoff={run.handoff} />;
  if (run.result) return <AuditSimulated run={run} result={run.result} />;
  // A handoff whose finding is on its way back (handoff cleared, result not attached yet).
  return (
    <p className="flex items-center gap-2 text-[13px] text-text-muted">
      <Spinner className="size-3.5" />
      {t.audit.handoff_waiting}
    </p>
  );
}

/** The handoff: the MCP steps with copy buttons, the app link, and what happens next. No simulated run. */
function AuditHandoff({ run, handoff }: { run: AuditRun; handoff: Handoff }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-text-strong">{t.audit.handoff_title}</h3>
      <p className="text-[13px] leading-[18px] text-text">{handoff.deep_link ? t.audit.handoff_lead_app : t.audit.handoff_lead}</p>
      <p className="font-mono text-2xs text-text-muted">
        {run.url} · {t.audit.device_value} · {run.platforms.map((p) => t.audit.platform[p]).join(", ")}
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs font-medium text-text-muted">{t.audit.handoff_steps}</p>
          <CopyButton text={handoff.mcp_steps.join("\n\n")} label={t.audit.copy_all} showLabel />
        </div>
        <ol className="flex flex-col gap-2">
          {handoff.mcp_steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-2 w-4 shrink-0 font-mono text-2xs text-text-subtle">{i + 1}</span>
              <CodeBlock code={step} wrap className="min-w-0 flex-1" />
            </li>
          ))}
        </ol>
      </div>
      {handoff.deep_link && (
        <div>
          <Button variant="outline" size="sm" render={<a href={handoff.deep_link} target="_blank" rel="noreferrer" />} nativeButton={false}>
            {t.audit.open_app}
            <span className="sr-only">{t.common.opens_tab}</span>
          </Button>
        </div>
      )}
      <p className="flex items-center gap-2 text-[13px] text-text-muted">
        <Spinner className="size-3.5" />
        {t.audit.handoff_waiting}
      </p>
    </div>
  );
}

function AuditSimulated({ run, result }: { run: AuditRun; result: AuditFinding }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const { data: state } = useAppState();
  const toggleWatch = useWatchToggle();
  const open = useOpenAudit();
  const fresh = !streamed.has(run.id);
  const [shown, setShown] = useState(fresh ? 0 : run.steps.length + 1);
  useEffect(() => {
    if (!fresh) return;
    const timer = setInterval(() => {
      setShown((n) => {
        if (n > run.steps.length) {
          clearInterval(timer);
          return n;
        }
        if (n === run.steps.length) streamed.add(run.id);
        return n + 1;
      });
    }, STEP_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);
  const done = shown > run.steps.length;
  useEffect(() => {
    if (fresh && done) notify(result.ok ? t.audit.passed_toast : t.audit.done_toast, { type: "success" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  const watching = !!state?.watches.some((w) => w.check === run.check);
  return (
    <div className="flex flex-col gap-5">
      <p className="font-mono text-2xs text-text-muted tnum">
        {run.url} · {t.audit.device_value} · {f.when(run.started_at)}
      </p>
      <ol className="flex flex-col gap-3" aria-live="polite">
        {run.steps.slice(0, Math.min(shown, run.steps.length)).map((s, i) => (
          <li key={i} className="flex flex-col gap-1 animate-[aia-fade-in_160ms_var(--ease-out)]">
            <p className="flex items-center gap-2 text-[13px] font-medium text-text">
              <span className="w-4 font-mono text-2xs text-text-subtle">{i + 1}</span>
              {pick(s.name)}
              <span className="truncate font-mono text-2xs font-normal text-text-muted">{s.url.replace(/^https:\/\//, "")}</span>
            </p>
            <ul className="ml-6 flex flex-wrap gap-1.5">
              {s.hits.map((h) => (
                <li key={h.platform} className={h.status === "missing" ? "inline-flex h-5 items-center gap-1 rounded-sm border border-danger/50 bg-danger-soft px-1.5 text-2xs text-text" : "inline-flex h-5 items-center gap-1 rounded-sm border border-border bg-surface-2 px-1.5 text-2xs text-text"}>
                  {h.status === "missing" ? <XIcon size={11} strokeWidth={2} aria-hidden className="text-danger" /> : <CheckIcon size={11} strokeWidth={2} aria-hidden className="text-success" />}
                  {t.audit.platform[h.platform]} · <span className="font-mono">{h.event}</span> · {h.status === "missing" ? t.audit.missing : t.audit.sent}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {!done && (
        <p className="flex items-center gap-2 text-[13px] text-text-muted">
          <Spinner className="size-3.5" />
          <span className="shimmer">{t.audit.running}</span>
        </p>
      )}
      {done && (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 animate-[aia-fade-in_220ms_var(--ease-out)]">
          <h3 className="text-sm font-semibold text-text-strong">{t.audit.result}</h3>
          <p className="flex flex-wrap items-center gap-2">
            <Status verdict={result.ok ? "adds_up" : "does_not_add_up"} word={result.ok ? t.audit.sent : t.audit.missing} />
            <span className="text-2xs text-text-muted">
              {t.audit.severity_label}: {t.audit.severity[result.severity]}
            </span>
          </p>
          <p className="text-sm text-text">{pick(result.title)}</p>
          <div className="flex flex-col gap-1">
            <p className="text-2xs font-medium text-text-muted">{t.audit.evidence}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] leading-[18px] text-text">
              {result.evidence.map((e, i) => (
                <li key={i}>{pick(e)}</li>
              ))}
            </ul>
          </div>
          {result.console && <CodeBlock code={result.console} title={t.audit.console} wrap />}
          <div className="flex flex-col gap-1">
            <p className="text-2xs font-medium text-text-muted">{t.audit.fix}</p>
            <p className="text-[13px] leading-[18px] text-text">{pick(result.fix)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!result.ok &&
              (watching ? (
                <Button variant="outline" size="sm" render={<Link to={`/dashboards?check=${run.check}`} />} nativeButton={false} className="bg-surface-2">
                  <EyeIcon strokeWidth={1.75} data-icon="inline-start" />
                  {t.ask.watching}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => void toggleWatch(run.check, false)}>
                  <EyeIcon strokeWidth={1.75} data-icon="inline-start" />
                  {t.audit.watch_until}
                </Button>
              ))}
            {state?.audit_fixed && !run.fixed && (
              <Button variant="outline" size="sm" onClick={() => open({ check: run.check })}>
                <RotateCcwIcon strokeWidth={1.75} data-icon="inline-start" />
                {t.audit.again}
              </Button>
            )}
            <Button variant="ghost" size="sm" render={<Link to={`/dashboards?check=${run.check}`} />} nativeButton={false}>
              {t.check.finding_title}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
