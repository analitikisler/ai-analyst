// Import an orders file (CONNECTORS.md §2): drop or choose a CSV or XLSX, which goes to POST /api/uploads/orders as
// the raw body; the server answers with the header, its guessed mapping, the status values with counts and a
// preview of the daily totals. Every change to the mapping, the time zone or the left-out statuses re-asks for the
// preview; Import writes the daily totals and the server deletes the file. Only daily totals are stored.
import { useEffect, useRef, useState, type DragEvent } from "react";
import { cn } from "cn";
import { FileSpreadsheetIcon, UploadIcon } from "lucide-react";
import { api } from "@/api";
import { useCall } from "@/api/queries";
import type { OrdersMapping, OrdersUpload } from "@/api/types";
import { Sparkline } from "@/components/charts/Sparkline";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { fmt, plural, useBilingual, useLang, useT } from "@/i18n";
import { useFormat } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { connErrText, useConnectedToast, useConnectParam, useOnOpen } from "./Connectors";

const REQUIRED: (keyof OrdersMapping)[] = ["created_at", "total"];
const OPTIONAL: (keyof OrdersMapping)[] = ["order_id", "status", "currency", "channel", "utm_source", "utm_medium", "device", "user_agent"];
const ZONES = ["Europe/Istanbul", "UTC", "Europe/London", "Europe/Berlin", "Europe/Amsterdam", "America/New_York", "Asia/Dubai"];
const MAX = 25 * 1024 * 1024;

export function OrdersSheet() {
  const t = useT();
  const f = useFormat();
  const lang = useLang();
  const pick = useBilingual();
  const call = useCall();
  const qc = useQueryClient();
  const { open, close } = useConnectParam("orders");
  const connectedToast = useConnectedToast();
  const [upload, setUpload] = useState<OrdersUpload | null>(null);
  const [reading, setReading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  useOnOpen(open, () => {
    setUpload(null);
    setFailure(null);
  });
  const errOf = (e: unknown) => connErrText(t, e as { code: string; params?: Record<string, string | number> });

  const send = async (file: File) => {
    setFailure(null);
    if (!/\.(csv|xlsx)$/i.test(file.name)) return setFailure(t.sources.err.upload_kind);
    if (file.size > MAX) return setFailure(t.sources.err.upload_too_large);
    setReading(true);
    try {
      setUpload(await api.uploadOrders(file, lang));
    } catch (e) {
      setFailure(errOf(e));
    } finally {
      setReading(false);
    }
  };
  const sample = async () => {
    if (!__DEMO__) return;
    const m = await import("@/api/mock/server");
    await send(new File([m.sampleOrdersFile()], "ornek-moda-siparisler.csv", { type: "text/csv" }));
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) void send(file);
  };

  /** A changed mapping, zone or status list asks the server for a new preview; the last answer wins. */
  const change = async (next: { mapping?: OrdersMapping; time_zone?: string }) => {
    if (!upload) return;
    const mine = ++seq.current;
    const optimistic = { ...upload, mapping: next.mapping ?? upload.mapping, time_zone: next.time_zone ?? upload.time_zone };
    setUpload(optimistic);
    setUpdating(true);
    setFailure(null);
    try {
      const r = await call("preview_orders_file", { upload_id: upload.upload_id, mapping: optimistic.mapping, time_zone: optimistic.time_zone });
      if (mine === seq.current) setUpload(r);
    } catch (e) {
      if (mine === seq.current) setFailure(errOf(e));
    } finally {
      if (mine === seq.current) setUpdating(false);
    }
  };
  const setField = (k: keyof OrdersMapping, v: string) => {
    if (!upload) return;
    const mapping = { ...upload.mapping, [k]: v || null } as OrdersMapping;
    if (k === "status") mapping.exclude_statuses = [];
    void change({ mapping });
  };
  const toggleStatus = (value: string, on: boolean) => {
    if (!upload) return;
    const ex = new Set(upload.mapping.exclude_statuses);
    if (on) ex.add(value);
    else ex.delete(value);
    void change({ mapping: { ...upload.mapping, exclude_statuses: [...ex] } });
  };
  const doImport = async () => {
    if (!upload) return;
    setImporting(true);
    setFailure(null);
    try {
      await call("import_orders_file", { upload_id: upload.upload_id, mapping: upload.mapping, time_zone: upload.time_zone });
      void qc.invalidateQueries();
      await connectedToast(t.sources.card.orders_file.title, fmt(t.sources.toast.imported, { orders: f.int(upload.preview.orders), days: plural(lang, upload.preview.days, t.sources.days, { n: f.int(upload.preview.days) }) }));
      close();
    } catch (e) {
      setFailure(errOf(e));
    } finally {
      setImporting(false);
    }
  };

  // Keyboard users can open the file picker from the drop zone too.
  useEffect(() => setDrag(false), [open]);
  const p = upload?.preview;
  const label = "text-2xs font-medium text-text-muted";
  const select = (k: keyof OrdersMapping, required: boolean) => (
    <div key={k} className="flex min-w-0 flex-col gap-1">
      <label htmlFor={`om-${k}`} className={label}>
        {t.sources.orders.field[k as keyof typeof t.sources.orders.field]}
        {required && <span className="ml-1 text-text-subtle">({t.sources.orders.required})</span>}
      </label>
      <NativeSelect id={`om-${k}`} size="sm" value={(upload?.mapping[k] as string | null) ?? ""} onChange={(e) => setField(k, e.target.value)} className="w-full">
        {!required && <NativeSelectOption value="">{t.sources.orders.none}</NativeSelectOption>}
        {upload?.columns.map((c) => (
          <NativeSelectOption key={c} value={c}>
            {c}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
  const zones = upload && !ZONES.includes(upload.time_zone) ? [upload.time_zone, ...ZONES] : ZONES;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[640px]">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="text-base font-semibold">{t.sources.orders.title}</SheetTitle>
          <SheetDescription>{t.sources.orders.lead}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
          <p role="note" className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] leading-[18px] text-text">
            {t.sources.orders.stored}
          </p>
          {!upload ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              className={cn("flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center", drag ? "border-accent bg-accent-soft" : "border-border-strong")}
            >
              {reading ? (
                <p className="flex items-center gap-2 text-sm text-text-muted" aria-live="polite">
                  <Spinner /> {t.sources.orders.reading}
                </p>
              ) : (
                <>
                  <UploadIcon size={20} strokeWidth={1.75} aria-hidden className="text-text-muted" />
                  <p className="text-sm text-text">{t.sources.orders.drop}</p>
                  <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
                    {t.sources.orders.choose}
                  </Button>
                  <p className="text-2xs text-text-subtle">{t.sources.orders.max}</p>
                  {__DEMO__ && (
                    <div className="mt-2 flex flex-col items-center gap-0.5">
                      <Button size="sm" variant="ghost" onClick={() => void sample()}>
                        <FileSpreadsheetIcon strokeWidth={1.75} data-icon="inline-start" />
                        {t.sources.orders.sample}
                      </Button>
                      <p className="text-2xs text-text-subtle">{t.sources.orders.sample_hint}</p>
                    </div>
                  )}
                </>
              )}
              <input
                ref={input}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                tabIndex={-1}
                aria-label={t.sources.orders.choose}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void send(file);
                }}
              />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-2 text-sm text-text">
                  <FileSpreadsheetIcon size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-text-muted" />
                  <span className="truncate font-mono text-[13px]">{fmt(t.sources.orders.file, { name: upload.file_name, kind: upload.kind.toUpperCase() })}</span>
                </p>
                <Button size="sm" variant="ghost" onClick={() => setUpload(null)}>
                  {t.sources.orders.other_file}
                </Button>
              </div>
              <section aria-labelledby="om-cols" className="flex flex-col gap-3">
                <div>
                  <h3 id="om-cols" className="text-sm font-semibold text-text-strong">
                    {t.sources.orders.columns}
                  </h3>
                  <p className="text-2xs text-text-subtle">{t.sources.orders.columns_hint}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {REQUIRED.map((k) => select(k, true))}
                  {OPTIONAL.map((k) => select(k, false))}
                  <div className="flex min-w-0 flex-col gap-1">
                    <label htmlFor="om-tz" className={label}>
                      {t.sources.orders.time_zone}
                    </label>
                    <NativeSelect id="om-tz" size="sm" value={upload.time_zone} onChange={(e) => void change({ time_zone: e.target.value })} className="w-full">
                      {zones.map((z) => (
                        <NativeSelectOption key={z} value={z}>
                          {z}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <p className="text-2xs text-text-subtle">{t.sources.orders.time_zone_hint}</p>
                  </div>
                </div>
              </section>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-semibold text-text-strong">{t.sources.orders.statuses}</legend>
                <p className="text-2xs text-text-subtle">{t.sources.orders.statuses_hint}</p>
                {upload.statuses.length ? (
                  <ul className="flex flex-col gap-1.5">
                    {upload.statuses.map((st) => (
                      <li key={st.value}>
                        <label className="flex items-center gap-2 text-[13px] text-text">
                          <Checkbox checked={upload.mapping.exclude_statuses.includes(st.value)} onCheckedChange={(on) => toggleStatus(st.value, !!on)} />
                          <span className="min-w-0 flex-1 truncate">{st.value || t.format.dash}</span>
                          <span className="font-mono text-2xs text-text-muted tnum">{plural(lang, st.count, t.sources.orders.count, { n: f.int(st.count) })}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-2xs text-text-muted">{t.sources.orders.no_status}</p>
                )}
              </fieldset>
              {p && (
                <section aria-labelledby="om-prev" aria-busy={updating} className={cn("flex flex-col gap-3 rounded-lg border border-border p-3", updating && "opacity-70")}>
                  <h3 id="om-prev" className="flex items-center gap-2 text-sm font-semibold text-text-strong">
                    {t.sources.orders.preview}
                    {updating && (
                      <span className="flex items-center gap-1 text-2xs font-normal text-text-muted">
                        <Spinner className="size-3" /> {t.sources.orders.updating}
                      </span>
                    )}
                  </h3>
                  {p.days ? (
                    <>
                      <p className="font-mono text-[13px] text-text tnum" aria-live="polite">
                        {fmt(t.sources.orders.totals, { orders: plural(lang, p.orders, t.sources.orders.count, { n: f.int(p.orders) }), revenue: f.money(p.revenue), range: p.from && p.to ? `${f.range(p.from, p.to)} · ${plural(lang, p.days, t.sources.days, { n: f.int(p.days) })}` : t.format.dash })}
                      </p>
                      <div>
                        <p className="mb-1 text-2xs text-text-muted">{t.sources.orders.chart}</p>
                        <Sparkline values={p.daily.map((d) => d.orders)} width={300} height={48} area label={t.sources.orders.chart} className="max-w-full" />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Breakdown title={t.sources.orders.by_channel} rows={p.channels.map((c) => [(t.dimensions.channel as Record<string, string>)[c.key] ?? c.key, c.orders])} total={p.orders} />
                        <Breakdown title={t.sources.orders.by_device} rows={p.devices.map((c) => [(t.dimensions.device as Record<string, string>)[c.key] ?? c.key, c.orders])} total={p.orders} />
                      </div>
                    </>
                  ) : (
                    <p className="text-[13px] text-text-muted">{t.sources.orders.empty}</p>
                  )}
                  <p className="text-2xs text-text-muted">{fmt(t.sources.orders.excluded, { status: f.int(p.excluded.status), no_date: f.int(p.excluded.no_date), bad_total: f.int(p.excluded.bad_total) })}</p>
                  {p.warnings.map((w, i) => (
                    <p key={i} role="note" className="rounded-md bg-warning-soft px-2 py-1.5 text-2xs leading-4 text-text">
                      {pick(w)}
                    </p>
                  ))}
                </section>
              )}
            </>
          )}
          {failure && (
            <p className="text-[13px] text-danger" role="alert">
              {failure}
            </p>
          )}
        </div>
        <SheetFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t border-border">
          <Button variant="ghost" onClick={close}>
            {t.common.cancel}
          </Button>
          <Button disabled={!p?.days || updating || importing} onClick={() => void doImport()}>
            {importing && <Spinner data-icon="inline-start" />}
            {importing ? t.sources.orders.importing : t.sources.orders.import}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Breakdown({ title, rows, total }: { title: string; rows: [string, number][]; total: number }) {
  const f = useFormat();
  return (
    <div>
      <p className="mb-1 text-2xs font-medium text-text-muted">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map(([k, n]) => (
          <li key={k} className="flex items-center gap-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate text-text">{k}</span>
            <span className="font-mono text-2xs text-text-muted tnum">{f.pct(total ? n / total : 0, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
