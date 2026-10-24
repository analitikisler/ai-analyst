// The check strip at the top of every dashboard (owner round 4): one compact row per check, failing first (verdict
// glyph and word, name, Δ, period); a watched check that changed carries a small dot. When everything adds up the
// strip is one quiet line. A row opens the check in a right sheet (`?check=`), which holds the old check page.
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { useAppState, useCall } from "@/api/queries";
import type { CheckId, CheckResult } from "@/api/types";
import { CHECK_LABELS } from "@/ask/labels";
import { InfoTip, Status } from "@/components/kit";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { fmt, plural, useBilingual, useLang, useT } from "@/i18n";
import { useFormat } from "@/lib/format";
import { CheckDetail } from "./CheckDetail";

const PACK_ORDER = ["ga4_vs_orders", "ga4_rev_vs_revenue", "meta_vs_orders", "gads_vs_orders"];
const rank = (c: CheckResult) => (c.verdict === "does_not_add_up" ? 0 : c.verdict === "insufficient_data" ? 1 : 2);
const order = (a: CheckResult, b: CheckResult) => rank(a) - rank(b) || PACK_ORDER.indexOf(a.check) - PACK_ORDER.indexOf(b.check);

/** `checks` are the dashboard's: every check over the dashboard period, the same figures as its tally tiles. */
export function CheckStrip({ checks: list }: { checks: CheckResult[] }) {
  const t = useT();
  const f = useFormat();
  const lang = useLang();
  const pick = useBilingual();
  const { data } = useAppState();
  const [params, setParams] = useSearchParams();
  const checks = [...list].sort(order);
  const changed = new Set(data?.watches.filter((w) => w.changed).map((w) => w.check));
  if (!checks.length) return null;
  const open = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("check", id);
    next.delete("run");
    setParams(next);
  };
  const allOk = checks.every((c) => c.verdict === "adds_up") && !changed.size;
  const heading = (
    <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text-strong">
      {t.dash.strip.label}
      <InfoTip content={t.dash.strip.info} label={t.dash.strip.label} />
    </h2>
  );
  if (allOk) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-muted">
        {heading}
        <Status verdict="adds_up" word={plural(lang, checks.length, t.dash.strip.all_ok, { n: checks.length })} />
      </div>
    );
  }
  return (
    <section aria-label={t.dash.strip.label} className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-3 py-2">{heading}</div>
      <ul className="divide-y divide-border">
        {checks.map((c) => (
          <li key={c.check}>
            <button
              type="button"
              onClick={() => open(c.check)}
              aria-label={fmt(t.dash.strip.open, { name: pick(c.label) })}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left outline-offset-[-2px] transition-colors hover:bg-surface-2 sm:grid-cols-[9rem_minmax(0,1fr)_4.5rem_9rem_1rem]"
            >
              {/* On a phone: verdict, delta and chevron on row 1 by explicit column (rows alone let the delta take column 1), the name on row 2. */}
              <span className="col-start-1 row-start-1 flex items-center gap-2 sm:col-start-auto sm:row-start-auto">
                <Status verdict={c.verdict} />
                {changed.has(c.check) && (
                  <span className="inline-flex items-center">
                    <span aria-hidden className="size-1.5 rounded-full bg-accent" />
                    <span className="sr-only">{t.dash.strip.changed}</span>
                  </span>
                )}
              </span>
              <span className="col-span-3 col-start-1 row-start-2 min-w-0 truncate text-[13px] text-text sm:col-span-1 sm:col-start-auto sm:row-start-auto">{pick(c.label)}</span>
              <span className="col-start-2 row-start-1 text-right font-mono text-[13px] text-text tnum sm:col-start-auto sm:row-start-auto">{f.pct(c.delta_pct, 1, true)}</span>
              <span className="hidden font-mono text-2xs text-text-muted tnum sm:block">{f.range(c.from, c.to)}</span>
              <ChevronRightIcon size={14} strokeWidth={1.75} aria-hidden className="col-start-3 row-start-1 text-text-subtle sm:col-start-auto sm:row-start-auto" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The check sheet: `?check=ga4_vs_orders` on a dashboard. Opening it clears the "changed" dots. */
export function CheckSheet({ period }: { period?: { from: string; to: string } }) {
  const t = useT();
  const pick = useBilingual();
  const call = useCall();
  const [params, setParams] = useSearchParams();
  const id = params.get("check");
  const known = !!id && id in CHECK_LABELS;
  useEffect(() => {
    if (known) void call("mark_checks_seen", {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("check");
    next.delete("run");
    setParams(next);
  };
  const ask = (question?: string) => {
    const next = new URLSearchParams(params);
    next.delete("check");
    next.delete("run");
    next.set("ask", "new");
    next.set("about", `check:${id}`);
    if (question) next.set("q", question);
    setParams(next);
  };
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className={cn("w-full gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[640px]")}>
        <SheetTitle className="sr-only">{known ? pick(CHECK_LABELS[id as CheckId]) : t.dash.strip.sheet}</SheetTitle>
        <SheetDescription className="sr-only">{t.dash.strip.label}</SheetDescription>
        {known ? <CheckDetail key={`${id}-${period?.from}-${period?.to}`} check={id as CheckId} period={period} onAsk={ask} /> : id ? <p className="p-5 text-sm text-text">{fmt(t.nf.check, { id })}</p> : null}
      </SheetContent>
    </Sheet>
  );
}
