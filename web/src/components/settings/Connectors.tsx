// Settings › Sources (CONNECTORS.md §4): the connectors as cards (GA4, the orders file, Shopify or WooCommerce)
// with their status, target, last sync and range, warnings and errors with the fix, Sync now and Disconnect; then
// the Cloud waitlist, each a mailto. Plus the pieces the connector sheets share: the stepwise test list and the
// error sentence for every connector code.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { cn } from "cn";
import { ExternalLinkIcon, MailIcon, RefreshCwIcon } from "lucide-react";
import { api } from "@/api";
import { useAppState, useCall } from "@/api/queries";
import type { ConnectorId, ConnectorState, ConnStep, WaitlistItem } from "@/api/types";
import { StatusGlyph } from "@/components/art/StatusGlyph";
import { StepStatus } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { fmt, plural, useBilingual, useLang, useT, type Copy } from "@/i18n";
import { describeError, sourceUnavailableSentence } from "@/lib/errors";
import { useFormat } from "@/lib/format";
import { notify } from "@/lib/notify";

export const STEP_MS = 380;

/** The sheet each connector opens with (?connect=). */
export const SHEET_OF: Record<ConnectorId, string> = { ga4: "ga4", orders_file: "orders", shopify: "shopify", woocommerce: "woocommerce" };

/** One sentence for a connector error code, with its params; the shared codes reuse the app's own copy. */
export function connErrText(t: Copy, e: { code: string; params?: Record<string, string | number> } | null | undefined, step?: string): string {
  if (!e) return "";
  const p = Object.fromEntries(Object.entries(e.params ?? {}).map(([k, v]) => [k, String(v)]));
  const own = (t.sources.err as Record<string, string>)[e.code];
  if (own) return fmt(own, { host: "–", property: "–", scope: "–", currency: "–", path: "–", service: "–", project: "–", ...p });
  if (e.code === "no_cloud") return fmt(t.err.no_cloud, { service: p.service ?? "–" });
  // Google sign-in codes are the BigQuery test's own (the same credentials and key files).
  const google = (t.set.bq.err as Record<string, string>)[e.code];
  if (google && /^(no_credentials|keyfile_|impersonat)/.test(e.code)) return fmt(google, { path: "–", id: "–", ...p });
  if (e.code === "source_unavailable") return sourceUnavailableSentence(t, e) ?? "";
  return fmt(t.sources.err.generic, { step: step ?? e.code, message: p.message ?? p.google ?? e.code });
}

/** The Google Cloud console page that enables an API, only when the server's link really points there. */
export function enableLink(e: { code: string; params?: Record<string, string | number> } | null | undefined): string | null {
  const link = e?.code === "api_disabled" ? String(e.params?.link ?? "") : "";
  return link.startsWith("https://console.cloud.google.com/") ? link : null;
}

export function EnableApiButton({ error }: { error: { code: string; params?: Record<string, string | number> } | null | undefined }) {
  const t = useT();
  const link = enableLink(error);
  if (!link) return null;
  return (
    <Button variant="outline" size="sm" className="mt-2" render={<a href={link} target="_blank" rel="noreferrer" />} nativeButton={false}>
      {t.sources.err.enable_api}
      <ExternalLinkIcon strokeWidth={1.75} data-icon="inline-end" />
      <span className="sr-only">{t.common.opens_tab}</span>
    </Button>
  );
}

/** Steps appear one at a time, as in the BigQuery test, so a long test reads as progress. */
export function useStepReveal() {
  const [shown, setShown] = useState<(ConnStep | { id: string; status: "running" })[]>([]);
  const reveal = async (steps: ConnStep[]) => {
    for (let i = 0; i < steps.length; i++) {
      setShown([...steps.slice(0, i), { id: steps[i]!.id, status: "running" }]);
      await new Promise((res) => setTimeout(res, STEP_MS));
      setShown(steps.slice(0, i + 1));
    }
  };
  return { shown, setShown, reveal };
}

/** The numbered test steps: waiting, running, ok, warning, failed with its fix, skipped. */
export function ConnSteps({ ids, names, shown, doneText, onFix, stale }: { ids: string[]; names: Record<string, string>; shown: (ConnStep | { id: string; status: "running" })[]; doneText: (s: ConnStep) => string; onFix?: (s: ConnStep) => void; stale?: boolean }) {
  const t = useT();
  const ok = shown.filter((s) => s.status === "ok" || s.status === "warning").length;
  const finished = shown.length === ids.length && !shown.some((s) => s.status === "running");
  return (
    <section aria-label={t.sources.test} className={cn("rounded-lg border border-border", stale && "opacity-60")}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold text-text-strong">{t.sources.test}</h3>
        {finished && (
          <span className="font-mono text-2xs text-text-muted" aria-live="polite">
            {fmt(t.sources.summary, { ok, n: ids.length })}
          </span>
        )}
      </header>
      <ol className="divide-y divide-border">
        {ids.map((id, i) => {
          const step = shown.find((x) => x.id === id) ?? { id, status: "waiting" as const };
          const real = step.status !== "running" && step.status !== "waiting" ? (step as ConnStep) : null;
          return (
            <li key={id} className="px-3 py-2.5">
              <div className="flex items-start gap-3">
                <span className="w-4 font-mono text-2xs text-text-subtle">{i + 1}</span>
                <span className={cn("min-w-0 flex-1 text-[13px] leading-[18px]", step.status === "waiting" ? "text-text-subtle" : "text-text")}>{real && (real.status === "ok" || real.status === "warning") ? doneText(real) : names[id]}</span>
                <span className="w-20 shrink-0 text-right">
                  {step.status === "warning" ? (
                    <span className="inline-flex items-center gap-1 font-mono text-2xs font-medium text-warning">
                      <StatusGlyph tone="warn" size={12} />
                      {t.sources.warning}
                    </span>
                  ) : (
                    <StepStatus status={step.status} />
                  )}
                </span>
              </div>
              {real?.status === "failed" && (
                <div className="mt-2 ml-7 rounded-md bg-danger-soft p-3 text-[13px] leading-[18px] text-text">
                  <p>{connErrText(t, real.error, names[id])}</p>
                  <EnableApiButton error={real.error} />
                  <p className="mt-1 text-text-muted">{t.sources.nothing_changed}</p>
                  {onFix && (
                    <Button variant="link" size="sm" className="mt-1" onClick={() => onFix(real)}>
                      {t.sources.fix}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {stale && <p className="border-t border-border px-3 py-2 text-2xs text-text-muted">{t.sources.stale}</p>}
    </section>
  );
}

const PILL: Record<ConnectorState["status"], string> = {
  not_connected: "border-border text-text-muted",
  connected: "border-success/40 text-success",
  syncing: "border-accent/40 text-accent-ink",
  error: "border-danger/50 text-danger",
};

function StatusPill({ status }: { status: ConnectorState["status"] }) {
  const t = useT();
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-2xs font-medium", PILL[status])}>
      {status === "syncing" ? <Spinner className="size-3" /> : status === "connected" ? <StatusGlyph tone="ok" size={11} /> : status === "error" ? <StatusGlyph tone="bad" size={11} /> : null}
      {t.sources.status[status]}
    </span>
  );
}

/** One connector, or for the shop card the "Shopify or WooCommerce" slot when neither is connected. */
function ConnectorCard({ c, title, lead, onOpen }: { c: ConnectorState; title: string; lead: string; onOpen: (sheet: string) => void }) {
  const t = useT();
  const f = useFormat();
  const lang = useLang();
  const pick = useBilingual();
  const call = useCall();
  const [syncing, setSyncing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const status = syncing ? "syncing" : c.status;
  const file = c.id === "orders_file";
  const range = c.last_sync?.from && c.last_sync.to ? `${f.range(c.last_sync.from, c.last_sync.to)} · ${plural(lang, c.last_sync.days, t.sources.days, { n: f.int(c.last_sync.days) })}` : t.format.dash;
  const sync = async () => {
    setSyncing(true);
    try {
      await call("sync_sources", { connector: c.id });
      notify(t.sources.toast.synced, { type: "success" });
    } catch (e) {
      notify(connErrText(t, e as { code: string; params?: Record<string, string | number> }) || describeError(t, e, f.bytes), { type: "error" });
    } finally {
      setSyncing(false);
    }
  };
  const disconnect = async () => {
    setConfirm(false);
    const r = await call("disconnect_source", { connector: c.id });
    // The server says when the source changed with it (back to demo) or was kept (set by an environment variable).
    notify(r.warnings.length ? r.warnings.map(pick).join(" ") : fmt(t.sources.toast.disconnected, { name: pick(c.name) }), { type: "success" });
  };
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface p-3" aria-label={title}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 text-sm font-semibold text-text-strong">{title}</h3>
        <StatusPill status={status} />
      </header>
      <p className="text-[13px] leading-[18px] text-text-muted">{lead}</p>
      <p className="text-2xs text-text-subtle">{fmt(t.sources.fills, { columns: c.fills.map((x) => t.sources.col[x]).join(", ") })}</p>
      {c.target && <p className="truncate font-mono text-2xs text-text" title={c.target}>{c.target}</p>}
      {c.last_sync && (
        <p className="font-mono text-2xs text-text-muted tnum">{fmt(file ? t.sources.imported_at : t.sources.last_sync, { time: f.whenMid(c.last_sync.at), range })}</p>
      )}
      {c.last_sync && !c.last_sync.ok && <p className="text-2xs text-warning">{t.sources.sync_failed}</p>}
      {status === "syncing" && (
        <p className="flex items-center gap-2 text-2xs text-text-muted" aria-live="polite">
          <Spinner className="size-3" />
          {t.sources.syncing_note}
        </p>
      )}
      {c.warnings.map((w, i) => (
        <p key={i} role="note" className="rounded-md bg-warning-soft px-2 py-1.5 text-2xs leading-4 text-text">
          {pick(w)}
        </p>
      ))}
      {c.error && (
        <div role="alert" className="rounded-md bg-danger-soft px-2 py-1.5 text-[13px] leading-[18px] text-text">
          <p>{connErrText(t, c.error)}</p>
          <EnableApiButton error={c.error} />
          <Button variant="link" size="sm" className="-ml-2" onClick={() => onOpen(SHEET_OF[c.id])}>
            {t.sources.fix}
          </Button>
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {c.status === "not_connected" ? (
          <Button size="sm" variant="outline" onClick={() => onOpen(SHEET_OF[c.id])}>
            {file ? t.sources.import_file : t.sources.connect}
          </Button>
        ) : (
          <>
            {file ? (
              <Button size="sm" variant="outline" onClick={() => onOpen("orders")}>
                {t.sources.import_again}
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={status === "syncing"} onClick={() => void sync()}>
                {status === "syncing" ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon strokeWidth={1.75} data-icon="inline-start" />}
                {status === "syncing" ? t.sources.syncing : t.sources.sync}
              </Button>
            )}
            {!file && (
              <Button size="sm" variant="ghost" onClick={() => onOpen(SHEET_OF[c.id])}>
                {t.sources.change}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
              {t.sources.disconnect}
            </Button>
          </>
        )}
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{fmt(t.sources.disconnect_confirm.title, { name: pick(c.name) })}</DialogTitle>
            <DialogDescription>{t.sources.disconnect_confirm.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={() => void disconnect()}>
              {t.sources.disconnect_confirm.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

export function ConnectorCards() {
  const t = useT();
  const pick = useBilingual();
  const { data } = useAppState();
  const [, setParams] = useSearchParams();
  const open = (sheet: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    n.set("connect", sheet);
    return n;
  });
  const list = data?.connectors ?? [];
  const by = (id: ConnectorId) => list.find((c) => c.id === id);
  const shops = (["shopify", "woocommerce"] as const).map(by).filter((c): c is ConnectorState => !!c && c.status !== "not_connected");
  const ordersSources = list.filter((c) => c.fills.includes("orders") && c.status !== "not_connected").length;
  const ga4 = by("ga4");
  const file = by("orders_file");
  const shopSlot = by("shopify");
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ga4 && <ConnectorCard c={ga4} title={t.sources.card.ga4.title} lead={t.sources.card.ga4.lead} onOpen={open} />}
        {file && <ConnectorCard c={file} title={t.sources.card.orders_file.title} lead={t.sources.card.orders_file.lead} onOpen={open} />}
        {shops.length
          ? shops.map((c) => <ConnectorCard key={c.id} c={c} title={pick(c.name)} lead={t.sources.card.shop.lead} onOpen={open} />)
          : shopSlot && <ConnectorCard c={{ ...shopSlot, name: { en: t.sources.card.shop.title, tr: t.sources.card.shop.title } }} title={t.sources.card.shop.title} lead={t.sources.card.shop.lead} onOpen={() => open("shopify")} />}
      </div>
      {ordersSources > 1 && (
        <p role="note" className="rounded-md bg-warning-soft px-3 py-2 text-[13px] leading-[18px] text-text">
          {t.sources.one_orders}
        </p>
      )}
    </div>
  );
}

export function WaitlistCards() {
  const t = useT();
  const pick = useBilingual();
  const { data } = useAppState();
  const items: WaitlistItem[] = data?.waitlist ?? [];
  if (!items.length) return null;
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((w) => (
        <li key={w.id} className="flex flex-col items-start gap-1 rounded-lg border border-dashed border-border px-3 py-2">
          {/* Name above the button: no name is cut off at any width or language. */}
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium break-words text-text">{pick(w.name)}</span>
            <span className="text-2xs text-text-muted">{t.sources.waitlist.badge}</span>
          </span>
          <Button size="sm" variant="ghost" className="-ml-2" render={<a href={w.mailto} />} nativeButton={false} aria-label={`${t.sources.waitlist.join}: ${pick(w.name)}`}>
            <MailIcon strokeWidth={1.75} data-icon="inline-start" />
            {t.sources.waitlist.join}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** After a connect or an import: the toast, which says so when the active source did not switch (from BigQuery or a
 *  source an environment variable locks, the person switches by hand). */
export function useConnectedToast() {
  const t = useT();
  const lang = useLang();
  return async (name: string, text?: string) => {
    const st = await api.state(lang).catch(() => null);
    if (st && st.source.kind !== "local") notify(fmt(t.sources.toast.connected_manual, { name, source: t.sources.kind[st.source.kind] }), { type: "success" });
    else notify(text ?? fmt(t.sources.toast.connected, { name }), { type: "success" });
  };
}

/** Closes a connector sheet by removing ?connect=. */
export function useConnectParam(name: string) {
  const [params, setParams] = useSearchParams();
  const open = params.get("connect") === name;
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("connect");
    setParams(next);
  };
  return { open, close };
}

/** Re-runs a callback when the sheet opens, to reset its fields. */
export function useOnOpen(open: boolean, fn: () => void) {
  useEffect(() => {
    if (open) fn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
