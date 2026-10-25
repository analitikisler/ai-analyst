// Connect GA4 (CONNECTORS.md §2): the property id, the sign-in (Google sign-in on this machine, a key file, or
// impersonating a service account), the six-step test, the history, then Connect, which stays disabled until the
// current values passed a test. Steps show one at a time; a failed step says what to fix and where.
import { useRef, useState } from "react";
import { useCall, useSettings } from "@/api/queries";
import type { BigQueryConfig, ConnectorTest, ConnStep } from "@/api/types";
import { SegmentedControl } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { fmt, useBilingual, useT } from "@/i18n";
import { describeError } from "@/lib/errors";
import { useFormat } from "@/lib/format";
import { ConnSteps, useConnectedToast, useConnectParam, useOnOpen, useStepReveal } from "./Connectors";

const IDS = ["credentials", "property", "report", "range", "flags", "quota"];
type Signin = "adc" | "key_file" | "impersonate";

export function Ga4Sheet() {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const call = useCall();
  const { open, close } = useConnectParam("ga4");
  const connectedToast = useConnectedToast();
  const { data: s } = useSettings();
  const [property, setProperty] = useState("");
  const [signin, setSignin] = useState<Signin>("adc");
  const [path, setPath] = useState("");
  const [impersonate, setImpersonate] = useState("");
  const [history, setHistory] = useState<90 | 400>(90);
  const [test, setTest] = useState<ConnectorTest | null>(null);
  const [tested, setTested] = useState("");
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { shown, setShown, reveal } = useStepReveal();
  const propRef = useRef<HTMLInputElement>(null);
  const pathRef = useRef<HTMLInputElement>(null);
  useOnOpen(open, () => {
    setTest(null);
    setShown([]);
    setFailure(null);
  });

  const auth: BigQueryConfig["auth"] = { kind: signin === "key_file" ? "key_file" : "adc", path: signin === "key_file" ? path.trim() : null, impersonate: signin === "impersonate" ? impersonate.trim() || null : null };
  const key = JSON.stringify([property.trim(), auth]);
  const stale = !!test && tested !== key;
  const passed = !!test?.ok && !stale && !testing;

  const run = async () => {
    setTesting(true);
    setFailure(null);
    setShown([]);
    try {
      const r = await call("test_ga4", { property_id: property.trim(), auth });
      setTest(r);
      setTested(key);
      await reveal(r.steps);
    } catch (e) {
      setFailure(describeError(t, e, f.bytes));
    } finally {
      setTesting(false);
    }
  };
  const connect = async () => {
    if (!test) return;
    setBusy(true);
    try {
      await call("connect_ga4", { test_id: test.test_id, history_days: history });
      await connectedToast(t.sources.card.ga4.title);
      close();
    } catch (e) {
      setFailure(describeError(t, e, f.bytes));
    } finally {
      setBusy(false);
    }
  };
  const done = (step: ConnStep) => {
    const d = step.detail ?? {};
    const D = t.sources.ga4.done;
    switch (step.id) {
      case "credentials":
        return fmt(D.credentials, { identity: String(d.identity ?? t.set.bq.your_account), method: t.set.bq.method[(d.method as "adc" | "key_file") ?? "adc"] });
      case "property":
        return fmt(D.property, { property: String(d.property ?? property), name: String(d.name ?? "") });
      case "report":
        return fmt(D.report, { date: f.date(String(d.date ?? ""), true), sessions: f.int(Number(d.sessions ?? 0)) });
      case "range":
        return fmt(D.range, { from: f.date(String(d.from ?? ""), true), to: f.date(String(d.to ?? ""), true) });
      case "flags":
        return step.status === "warning" ? D.flags_warning : D.flags;
      case "quota":
        return fmt(D.quota, { left: f.int(Number(d.left ?? 0)), per_day: f.int(Number(d.per_day ?? 0)) });
      default:
        return step.id;
    }
  };
  const field = "font-mono";
  const radio = (value: Signin, label: string, extra?: React.ReactNode) => (
    <>
      <label className="flex items-start gap-2 text-sm text-text">
        <input type="radio" name="ga4-auth" checked={signin === value} onChange={() => setSignin(value)} className="mt-1 accent-[var(--color-primary)]" />
        <span>{label}</span>
      </label>
      {signin === value && extra}
    </>
  );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="text-base font-semibold">{t.sources.ga4.title}</SheetTitle>
          <SheetDescription>{t.sources.ga4.lead}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!testing && property.trim()) void run();
            }}
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="ga4-prop" className="text-2xs font-medium text-text-muted">
                {t.sources.ga4.property}
              </label>
              <Input id="ga4-prop" ref={propRef} required inputMode="numeric" value={property} onChange={(e) => setProperty(e.target.value)} className={field} autoComplete="off" spellCheck={false} aria-describedby="ga4-prop-hint" />
              <p id="ga4-prop-hint" className="text-2xs text-text-subtle">
                {t.sources.ga4.property_hint}
              </p>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold text-text-strong">{t.sources.ga4.signin}</legend>
              {radio("adc", t.set.bq.adc, s && <p className="ml-6 text-2xs text-text-muted">{fmt(t.set.bq.adc_found, { identity: s.data_source.credentials.identity ?? "" })}</p>)}
              {radio(
                "impersonate",
                t.set.bq.impersonate,
                <div className="ml-6 flex flex-col gap-1">
                  <Input aria-label={t.set.bq.impersonate} value={impersonate} onChange={(e) => setImpersonate(e.target.value)} className={field} autoComplete="off" spellCheck={false} />
                  <p className="text-2xs text-text-subtle">{t.set.bq.impersonate_hint}</p>
                </div>,
              )}
              {radio(
                "key_file",
                t.set.bq.keyfile,
                <div className="ml-6 flex flex-col gap-1">
                  <label htmlFor="ga4-path" className="text-2xs font-medium text-text-muted">
                    {t.set.bq.keyfile_path}
                  </label>
                  <Input id="ga4-path" ref={pathRef} value={path} onChange={(e) => setPath(e.target.value)} className={field} autoComplete="off" spellCheck={false} />
                  <p className="text-2xs text-text-subtle">{t.set.bq.keyfile_hint}</p>
                </div>,
              )}
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <span className="text-2xs font-medium text-text-muted">{t.sources.history.label}</span>
              <SegmentedControl
                label={t.sources.history.label}
                value={history}
                onChange={setHistory}
                options={[
                  { value: 90, label: t.sources.history.d90 },
                  { value: 400, label: t.sources.history.d400 },
                ]}
              />
              <p className="text-2xs text-text-subtle">{t.sources.history.hint}</p>
            </div>
            <div>
              <Button type="submit" variant="outline" disabled={testing || !property.trim()}>
                {testing && <Spinner data-icon="inline-start" />}
                {testing ? t.sources.testing : test ? t.sources.retest : t.sources.test}
              </Button>
              {failure && (
                <p className="mt-2 text-[13px] text-danger" role="alert">
                  {failure}
                </p>
              )}
            </div>
          </form>
          {(test || shown.length > 0) && (
            <div className="mt-5 flex flex-col gap-2">
              <ConnSteps ids={IDS} names={t.sources.ga4.steps} shown={shown} doneText={done} stale={stale} onFix={(st) => (st.id === "credentials" ? pathRef : propRef).current?.focus()} />
              {!testing && !stale && test?.warnings.map((w, i) => (
                <p key={i} role="note" className="rounded-md bg-warning-soft px-3 py-2 text-[13px] leading-[18px] text-text">
                  {pick(w)}
                </p>
              ))}
            </div>
          )}
        </div>
        <SheetFooter className="flex-col gap-3 border-t border-border sm:flex-col">
          <p className="text-2xs text-text-muted">{t.set.bq.privacy}</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!passed && <span className="mr-auto text-2xs text-text-muted">{t.sources.test_first}</span>}
            <Button variant="ghost" onClick={close}>
              {t.common.cancel}
            </Button>
            <Button disabled={!passed || busy} onClick={() => void connect()}>
              {busy && <Spinner data-icon="inline-start" />}
              {t.sources.ga4.connect}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
