// Connect BigQuery (09-ux.md S12b, F8): sign-in, projects, dataset, the six-step test, then "Use this data", which
// stays disabled until the current values passed a test. The test here is scripted (the identity can run jobs
// only in the analytics project); nothing is sent anywhere.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { cn } from "cn";
import { useAppState, useCall, useSettings } from "@/api/queries";
import type { BigQueryConfig, BqStep, BqTest } from "@/api/types";
import { StepStatus } from "@/components/kit";
import { TallyMicro } from "@/components/tally/Tally";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { fmt, plural, useLang, useT } from "@/i18n";
import { describeError } from "@/lib/errors";
import { useFormat } from "@/lib/format";
import { notify } from "@/lib/notify";

const STEP_MS = 420;

export function BigQuerySheet() {
  const t = useT();
  const f = useFormat();
  const lang = useLang();
  const call = useCall();
  const [params, setParams] = useSearchParams();
  const open = params.get("connect") === "bigquery";
  const { data: s } = useSettings();
  const { data: state } = useAppState();
  const [auth, setAuth] = useState<"adc" | "key_file">("adc");
  const [path, setPath] = useState("");
  const [impersonate, setImpersonate] = useState("");
  const [dataProject, setDataProject] = useState("");
  const [jobProject, setJobProject] = useState("");
  const [dataset, setDataset] = useState("ai_analyst");
  const [test, setTest] = useState<BqTest | null>(null);
  const [shown, setShown] = useState<BqStep[]>([]);
  const [testing, setTesting] = useState(false);
  const [live, setLive] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const jobRef = useRef<HTMLInputElement>(null);
  const dataRef = useRef<HTMLInputElement>(null);
  const datasetRef = useRef<HTMLInputElement>(null);
  const pathRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && s?.data_source.bigquery) {
      const b = s.data_source.bigquery;
      setDataProject(b.data_project);
      setJobProject(b.job_project && b.job_project !== b.data_project ? b.job_project : "");
      setDataset(b.dataset);
    }
  }, [open, s?.data_source.bigquery]);

  const values: BigQueryConfig = { data_project: dataProject.trim(), job_project: jobProject.trim() || null, dataset: dataset.trim(), location: null, auth: { kind: auth, path: auth === "key_file" ? path : null, impersonate: impersonate.trim() || null }, max_bytes: s?.data_source.max_bytes.value ?? 2 * 1024 ** 3 };
  const key = JSON.stringify(values);
  const stale = !!test && JSON.stringify(test.values) !== key;
  const passed = !!test && test.ok && !stale;

  const run = async () => {
    setTesting(true);
    setShown([]);
    setFailure(null);
    let r: Awaited<ReturnType<typeof call<"test_bigquery">>>;
    try {
      r = await call("test_bigquery", values);
    } catch (e) {
      // no_cloud, a server error or no server: nothing was tested, so no steps; the reason shows under the button.
      setTesting(false);
      setFailure(describeError(t, e, f.bytes));
      return;
    }
    setTest(r);
    for (let i = 0; i < r.steps.length; i++) {
      setShown(r.steps.slice(0, i).concat({ ...r.steps[i]!, status: "running" }));
      await new Promise((res) => setTimeout(res, STEP_MS));
      setShown(r.steps.slice(0, i + 1));
      const step = r.steps[i]!;
      setLive(fmt(t.set.bq.step_live, { n: i + 1, name: t.set.bq.step_names[step.id], status: t.set.bq[step.status === "ok" ? "ok" : step.status === "failed" ? "failed" : "skipped"] }));
    }
    setTesting(false);
  };

  const close = (saved = false) => {
    const next = new URLSearchParams(params);
    next.delete("connect");
    setParams(next);
    if (!saved && state?.source.kind === "demo" && test) notify(t.set.bq.nothing_changed);
    setTest(null);
    setShown([]);
  };

  const use = async () => {
    if (!test) return;
    await call("save_data_source", { kind: "bigquery", test_id: test.test_id });
    notify(fmt(t.set.data.toast.bq, { table: `${values.data_project}.${values.dataset}` }), { type: "success" });
    close(true);
  };

  const fieldFor = (step: BqStep) => (step.id === "jobs" ? jobRef : step.id === "dataset" ? datasetRef : step.id === "credentials" ? pathRef : dataRef);
  const stepText = (step: BqStep) => {
    const d = step.detail ?? {};
    switch (step.id) {
      case "credentials":
        return fmt(t.set.bq.steps.credentials, { identity: String(d.identity || t.set.bq.your_account), method: t.set.bq.method[(d.method as "adc" | "key_file") ?? "adc"] });
      case "jobs":
        return fmt(t.set.bq.steps.jobs, { project: String(d.project ?? values.job_project ?? values.data_project) });
      case "dataset":
        return fmt(t.set.bq.steps.dataset, { project: String(d.project ?? ""), dataset: String(d.dataset ?? ""), location: String(d.location ?? "") });
      case "table":
        return fmt(t.set.bq.steps.table, { table: String(d.table ?? ""), n: Number(d.n ?? 0), time: f.whenMid(String(d.time ?? "")) });
      case "read":
        return fmt(t.set.bq.steps.read, { from: f.date(String(d.from ?? "")), to: f.date(String(d.to ?? ""), true), rows: f.int(Number(d.rows ?? 0)) });
      case "allowed":
        return Number(d.n ?? 0) ? plural(lang, Number(d.n), t.set.bq.steps.allowed, { n: f.int(Number(d.n)) }) : t.set.bq.steps.allowed_none;
      case "cost":
        return fmt(t.set.bq.steps.cost, { bytes: f.bytes(Number(d.bytes ?? 0)), cap: f.bytes(Number(d.cap ?? 0)) });
    }
  };
  const errText = (step: BqStep) => {
    const e = step.error;
    if (!e) return "";
    // A failure the scripted demo never produces still gets the step and the server's own words.
    const tpl = (t.set.bq.err as Record<string, string>)[e.code] ?? t.set.bq.err.generic;
    const params = (e.params ?? {}) as Record<string, string>;
    // Google's own words (short, no secrets) follow the hint, so the real cause is never hidden.
    const google = params.google && e.code !== "generic" ? ` ${fmt(t.set.bq.err.google, { google: params.google })}` : "";
    return fmt(tpl, { step: t.set.bq.step_names[step.id], message: String(params.message ?? params.google ?? e.code), ...params, id: params.id || (tpl.startsWith("{id}") ? t.set.bq.your_account.charAt(0).toLocaleUpperCase() + t.set.bq.your_account.slice(1) : t.set.bq.your_account) }) + google;
  };
  const ok = test ? test.steps.filter((x) => x.status === "ok").length : 0;
  const fieldCls = "font-mono";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="text-base font-semibold">{t.set.bq.title}</SheetTitle>
          <SheetDescription>{t.set.data.bq.lead}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!testing && dataProject.trim()) void run();
            }}
            className="flex flex-col gap-5"
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold text-text-strong">{t.set.bq.signin}</legend>
              <label className="flex items-start gap-2 text-sm text-text">
                <input type="radio" name="auth" checked={auth === "adc"} onChange={() => setAuth("adc")} className="mt-1 accent-[var(--color-primary)]" />
                <span>
                  {t.set.bq.adc}
                  {s && <span className="block text-2xs text-text-muted">{fmt(t.set.bq.adc_found, { identity: s.data_source.credentials.identity ?? "" })}</span>}
                </span>
              </label>
              {auth === "adc" && (
                <div className="ml-6 flex flex-col gap-1">
                  <label htmlFor="bq-imp" className="text-2xs font-medium text-text-muted">
                    {t.set.bq.impersonate}
                  </label>
                  <Input id="bq-imp" value={impersonate} onChange={(e) => setImpersonate(e.target.value)} className={fieldCls} autoComplete="off" spellCheck={false} />
                  <p className="text-2xs text-text-subtle">{t.set.bq.impersonate_hint}</p>
                </div>
              )}
              <label className="flex items-start gap-2 text-sm text-text">
                <input type="radio" name="auth" checked={auth === "key_file"} onChange={() => setAuth("key_file")} className="mt-1 accent-[var(--color-primary)]" />
                <span>{t.set.bq.keyfile}</span>
              </label>
              {auth === "key_file" && (
                <div className="ml-6 flex flex-col gap-1">
                  <label htmlFor="bq-path" className="text-2xs font-medium text-text-muted">
                    {t.set.bq.keyfile_path}
                  </label>
                  <Input id="bq-path" ref={pathRef} value={path} onChange={(e) => setPath(e.target.value)} className={fieldCls} autoComplete="off" spellCheck={false} />
                  <p className="text-2xs text-text-subtle">{t.set.bq.keyfile_hint}</p>
                  <p className="text-2xs text-text-subtle">{t.set.bq.err.org_policy}</p>
                </div>
              )}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="bq-data" className="text-2xs font-medium text-text-muted">
                  {t.set.bq.data_project}
                </label>
                <Input id="bq-data" ref={dataRef} required value={dataProject} onChange={(e) => setDataProject(e.target.value)} className={fieldCls} autoComplete="off" spellCheck={false} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="bq-job" className="text-2xs font-medium text-text-muted">
                  {t.set.bq.job_project}
                </label>
                <Input id="bq-job" ref={jobRef} value={jobProject} placeholder={t.set.bq.job_same} onChange={(e) => setJobProject(e.target.value)} className={fieldCls} aria-describedby="bq-job-hint" autoComplete="off" spellCheck={false} />
                <p id="bq-job-hint" className="text-2xs text-text-subtle">
                  {t.set.bq.job_hint}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="bq-ds" className="text-2xs font-medium text-text-muted">
                  {t.set.bq.dataset}
                </label>
                <Input id="bq-ds" ref={datasetRef} value={dataset} onChange={(e) => setDataset(e.target.value)} className={fieldCls} autoComplete="off" spellCheck={false} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-2xs font-medium text-text-muted">{t.set.bq.location}</span>
                <span className="flex h-8 items-center rounded-md border border-border bg-surface-2 px-2.5 font-mono text-[13px] text-text">{test?.detected.location && !stale ? test.detected.location : t.set.bq.location_pending}</span>
              </div>
            </div>
            <div>
              <Button type="submit" variant="outline" disabled={testing || !dataProject.trim()}>
                {testing && <Spinner data-icon="inline-start" />}
                {testing ? t.set.bq.testing : t.set.bq.test}
              </Button>
              {failure && (
                <p className="mt-2 text-[13px] text-danger" role="alert">
                  {failure}
                </p>
              )}
            </div>
          </form>
          {test && (
            <section aria-label={t.set.bq.test} className={cn("mt-5 rounded-lg border border-border", stale && "opacity-60")}>
              <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <h3 className="text-sm font-semibold text-text-strong">{t.set.bq.test}</h3>
                {!testing && (
                  <span className="flex items-center gap-2 font-mono text-2xs text-text-muted" aria-live="polite">
                    <TallyMicro expected={7} measured={ok} verdict={ok === 7 ? "adds_up" : "does_not_add_up"} width={48} />
                    {fmt(t.set.bq.summary, { ok })}
                  </span>
                )}
              </header>
              <ol role="list" className="divide-y divide-border">
                {(["credentials", "jobs", "dataset", "table", "read", "allowed", "cost"] as const).map((id, i) => {
                  const step = shown.find((x) => x.id === id) ?? { id, status: "waiting" as const };
                  return (
                    <li key={id} role="listitem" className="px-3 py-2.5">
                      <div className="flex items-start gap-3">
                        <span className="w-4 font-mono text-2xs text-text-subtle">{i + 1}</span>
                        <span className={cn("min-w-0 flex-1 text-[13px] leading-[18px]", step.status === "waiting" ? "text-text-subtle" : "text-text")}>
                          {step.status === "ok" || (step.status === "failed" && step.detail) ? stepText(step) : t.set.bq.step_names[id]}
                        </span>
                        <span className="w-20 shrink-0 text-right">
                          <StepStatus status={step.status} />
                        </span>
                      </div>
                      {step.status === "failed" && (
                        <div className="mt-2 ml-7 rounded-md bg-danger-soft p-3 text-[13px] leading-[18px] text-text">
                          <p>{errText(step)}</p>
                          <p className="mt-1 text-text-muted">{state?.source.kind === "bigquery" ? t.set.bq.nothing_changed_bq : t.set.bq.nothing_changed}</p>
                          <Button variant="link" size="sm" className="mt-1" onClick={() => fieldFor(step).current?.focus()}>
                            {t.set.bq.fix}
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
              {!testing && !stale && (test.warnings ?? []).map((w) => (
                <p key={w.code} role="note" className="border-t border-border bg-warning-soft px-3 py-2 text-[13px] leading-[18px] text-text">
                  {plural(lang, w.params.n, t.set.bq.warn.credential_broader, { n: f.int(w.params.n), datasets: w.params.datasets })}
                </p>
              ))}
              {stale && <p className="border-t border-border px-3 py-2 text-2xs text-text-muted">{t.set.bq.stale}</p>}
              {!testing && !test.ok && !stale && (
                <p className="border-t border-border px-3 py-2 text-2xs text-text-muted">
                  {t.set.bq.m6.body}{" "}
                  <a href="https://github.com/analitikisler/ai-analyst/blob/main/docs/connecting-bigquery.md" target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                    {t.set.bq.m6.guide}
                  </a>
                  {" · "}
                  <a href={`mailto:hello@analitikisler.com?subject=${encodeURIComponent(t.help.subject_setup)}`} className="font-medium text-accent hover:underline">
                    {t.set.bq.m6.email}
                  </a>
                </p>
              )}
            </section>
          )}
          <p className="sr-only" aria-live="polite">
            {live}
          </p>
        </div>
        <SheetFooter className="flex-col gap-3 border-t border-border sm:flex-col">
          <p className="text-2xs text-text-muted">{t.set.bq.privacy}</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!passed && <span className="mr-auto text-2xs text-text-muted">{t.set.bq.use_disabled}</span>}
            <Button variant="ghost" onClick={() => close()}>
              {t.common.cancel}
            </Button>
            <Button disabled={!passed || testing} onClick={() => void use()}>
              {t.set.bq.use}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
