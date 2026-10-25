// Settings › Data source › Tables the agent may read (docs/design/multi-table-queries.md). The mart is always on the
// list; the person adds datasets (every table in them, also later ones) or single tables, in the mart's location,
// removes them, confirms each table's protected columns and writes a one-line description the agent sees. Every
// change is a settings change (this machine only) and lands in Activity. AI_ANALYST_EXPLORE_ALLOW locks the list.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LockIcon } from "lucide-react";
import { api } from "@/api";
import { useCall } from "@/api/queries";
import type { AllowEntry, DescribedTable, Settings, TableListing } from "@/api/types";
import { Disclosure } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { fmt, plural, useLang, useT } from "@/i18n";
import { describeError } from "@/lib/errors";
import { useFormat } from "@/lib/format";
import { notify } from "@/lib/notify";

const GB = 1024 ** 3;
const QUESTION_CAPS = [GB, 2 * GB, 5 * GB, 10 * GB];
type Entry = Omit<AllowEntry, "meta">;
const keyOf = (e: Entry) => (e.project ? [e.project, e.dataset, e.table].filter(Boolean).join(".") : (e.table ?? e.dataset));
const same = (a: Entry, b: Entry) => keyOf(a) === keyOf(b);
const bare = (e: AllowEntry): Entry => ({ project: e.project, dataset: e.dataset, table: e.table });

export function ExploreTables({ s }: { s: Settings }) {
  const t = useT();
  const c = t.set.data.explore;
  const f = useFormat();
  const lang = useLang();
  const call = useCall();
  const ex = s.data_source.explore;
  const demo = s.data_source.kind.value === "demo";
  const locked = ex.allow_setting.locked;
  const [picker, setPicker] = useState<"dataset" | "table" | null>(null);
  const [busy, setBusy] = useState(false);
  const list = ex.allow.map(bare);
  const save = async (next: Entry[], toast: string) => {
    setBusy(true);
    try {
      await call("set_explore_tables", { allow: next });
      notify(toast, { type: "success" });
    } catch (e) {
      notify(describeError(t, e, f.bytes), { type: "error" });
    } finally {
      setBusy(false);
    }
  };
  // One click: the mart's own dataset (BigQuery), or every demo shop table.
  const bq = s.data_source.bigquery;
  const oneClick: Entry | null = demo ? ((ex.demo_tables ?? []).length > 1 ? { project: null, dataset: "demo", table: null } : null) : bq ? { project: bq.data_project, dataset: bq.dataset, table: null } : null;
  const showOneClick = oneClick && !list.some((e) => same(e, oneClick));
  const metaLine = (e: AllowEntry) => {
    const m = e.meta;
    if (!m) return null;
    if (demo) return plural(lang, m.tables, c.meta_demo, { n: f.int(m.tables), rows: f.int(m.rows) });
    return plural(lang, m.tables, c.meta, { n: f.int(m.tables), rows: f.int(m.rows), bytes: m.bytes == null ? "–" : f.bytes(m.bytes), date: m.modified ? f.date(m.modified.slice(0, 10), true) : "–", location: m.location ?? "–" });
  };

  return (
    <div className="flex flex-col gap-3">
      {locked && (
        <p className="flex items-start gap-1.5 text-2xs text-text-muted">
          <LockIcon size={12} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
          <span>{fmt(t.set.env_lock, { variable: ex.allow_setting.env ?? "AI_ANALYST_EXPLORE_ALLOW" })}</span>
        </p>
      )}
      {demo && ex.demo_tables && ex.demo_tables.length <= 1 && <p className="text-[13px] text-text-muted">{c.demo_old}</p>}
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label={c.title}>
        <li className="flex flex-wrap items-center gap-2 px-3 py-2">
          <span className="font-mono text-[13px] break-all text-text">{ex.mart ?? "daily_channel_device"}</span>
          <span className="inline-flex h-5 items-center rounded-sm border border-border bg-surface-2 px-1.5 text-2xs text-text-muted">
            {c.mart} · {c.always}
          </span>
        </li>
        {ex.allow.map((e) => {
          const name = keyOf(e);
          const meta = metaLine(e);
          return (
            <li key={name} className="flex flex-wrap items-start gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[13px] break-all text-text">
                  {name}
                  {!e.table && <span className="font-sans text-2xs text-text-muted"> · {c.dataset_all}</span>}
                </p>
                {meta && <p className="mt-0.5 font-mono text-2xs text-text-muted tnum">{meta}</p>}
              </div>
              <Button variant="ghost" size="sm" disabled={locked || busy} aria-label={fmt(c.remove_label, { name })} onClick={() => void save(list.filter((x) => !same(x, e)), fmt(c.removed, { name }))}>
                {c.remove}
              </Button>
            </li>
          );
        })}
      </ul>
      {!ex.allow.length && <p className="text-[13px] text-text-muted">{c.only_mart}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {showOneClick && (
          <Button size="sm" variant="outline" disabled={locked || busy} onClick={() => void save([...list, oneClick!], fmt(c.added, { name: keyOf(oneClick!) }))}>
            {busy && <Spinner data-icon="inline-start" />}
            {demo ? c.add_demo : c.add_this}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={locked || busy || (demo && (ex.demo_tables ?? []).length <= 1)} onClick={() => setPicker("dataset")}>
          {c.add_dataset}
        </Button>
        <Button size="sm" variant="ghost" disabled={locked || busy || (demo && (ex.demo_tables ?? []).length <= 1)} onClick={() => setPicker("table")}>
          {c.add_table}
        </Button>
      </div>
      {!demo && <p className="text-2xs text-text-muted">{c.breadth}</p>}
      {!demo && (
        <label className="flex flex-wrap items-center gap-2 text-[13px] text-text">
          <span className="font-medium">{c.question_cap}</span>
          <NativeSelect
            size="sm"
            className="w-28"
            value={String(ex.max_bytes_per_question)}
            onChange={async (e) => {
              try {
                await call("set_explore_tables", { max_bytes_per_question: Number(e.target.value) });
                notify(c.question_cap_saved, { type: "success" });
              } catch (err) {
                notify(describeError(t, err, f.bytes), { type: "error" });
              }
            }}
          >
            {[...new Set([...QUESTION_CAPS, ex.max_bytes_per_question])].sort((a, b) => a - b).map((n) => (
              <NativeSelectOption key={n} value={n}>
                {f.bytes(n)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <span className="basis-full text-2xs text-text-subtle">{c.question_cap_hint}</span>
        </label>
      )}
      <TableDetails s={s} />
      <Picker mode={picker} onClose={() => setPicker(null)} list={list} mart={ex.mart} onAdd={(e) => void save([...list, e], fmt(c.added, { name: keyOf(e) }))} />
    </div>
  );
}

/** Datasets and tables this sign-in can see; only ones in the mart's location can be added. */
function Picker({ mode, onClose, list, mart, onAdd }: { mode: "dataset" | "table" | null; onClose: () => void; list: Entry[]; mart: string | null; onAdd: (e: Entry) => void }) {
  const t = useT();
  const c = t.set.data.explore;
  const f = useFormat();
  const lang = useLang();
  const q = useQuery({ queryKey: ["action", "list_tables", "picker"], queryFn: () => api.action("list_tables", {}, lang) as Promise<TableListing>, enabled: mode !== null, staleTime: 60_000 });
  const martLoc = q.data?.location ?? "–";
  const datasetOn = (d: TableListing["datasets"][number]) => list.some((e) => same(e, { project: d.project, dataset: d.dataset, table: null }));
  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{c.picker_title}</DialogTitle>
          <DialogDescription>{c.picker_lead}</DialogDescription>
        </DialogHeader>
        {q.isLoading && (
          <p className="flex items-center gap-2 text-[13px] text-text-muted">
            <Spinner /> {c.picker_loading}
          </p>
        )}
        {q.isError && <p className="text-[13px] text-danger">{describeError(t, q.error, f.bytes)}</p>}
        {q.data && !q.data.datasets.length && <p className="text-[13px] text-text-muted">{c.picker_empty}</p>}
        <ul className="flex flex-col gap-3">
          {q.data?.datasets.map((d) => {
            const name = d.project ? `${d.project}.${d.dataset}` : d.dataset;
            const on = datasetOn(d);
            return (
              <li key={name} className="rounded-md border border-border">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[13px] break-all text-text">{name}</p>
                    <p className="text-2xs text-text-muted">
                      {plural(lang, d.tables.length, c.tables_n, { n: f.int(d.tables.length) })}
                      {d.location ? ` · ${d.location}` : ""}
                      {!d.same_location && ` · ${fmt(c.other_location, { location: d.location ?? "–", mart: martLoc })}`}
                    </p>
                  </div>
                  {mode === "dataset" &&
                    (on ? (
                      <span className="text-2xs text-text-muted">{c.on_list}</span>
                    ) : (
                      <Button size="sm" variant="outline" disabled={!d.same_location} onClick={() => (onAdd({ project: d.project, dataset: d.dataset, table: null }), onClose())}>
                        {c.add_dataset}
                      </Button>
                    ))}
                </div>
                {mode === "table" && d.same_location && d.tables.length > 0 && (
                  <ul className="divide-y divide-border border-t border-border">
                    {d.tables
                      .filter((x) => `${name}.${x.table}` !== mart && x.table !== mart)
                      .map((x) => {
                        const e: Entry = { project: d.project, dataset: d.dataset, table: x.table };
                        const listed = on || list.some((y) => same(y, e));
                        return (
                          <li key={x.table} className="flex items-center gap-2 px-3 py-1.5">
                            <span className="min-w-0 flex-1 font-mono text-2xs break-all text-text">
                              {x.table} <span className="text-text-muted">· {plural(lang, x.rows, c.rows_n, { n: f.int(x.rows) })}</span>
                            </span>
                            {listed ? (
                              <span className="text-2xs text-text-muted">{c.on_list}</span>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => (onAdd(e), onClose())}>
                                {c.add_table}
                              </Button>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** Per table: the description the agent sees and the protected columns, proposed by the server until confirmed. */
function TableDetails({ s }: { s: Settings }) {
  const t = useT();
  const c = t.set.data.explore;
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const sig = JSON.stringify([s.data_source.explore.allow.map(bare), s.data_source.explore.protected_columns, s.data_source.explore.descriptions]);
  const q = useQuery({ queryKey: ["action", "describe_tables", sig], queryFn: () => api.action("describe_tables", {}, lang), enabled: open, staleTime: 60_000 });
  const f = useFormat();
  return (
    <>
    {/* Said before the list, open or not: what reaches the model unless a column is protected. */}
    <p className="text-[13px] leading-[18px] text-text">{c.readable_note}</p>
    <Disclosure label={c.columns} onToggle={setOpen}>
      {q.isLoading && (
        <p className="flex items-center gap-2 text-[13px] text-text-muted">
          <Spinner /> {c.columns_loading}
        </p>
      )}
      {q.isError && <p className="text-[13px] text-danger">{describeError(t, q.error, f.bytes)}</p>}
      <div className="flex flex-col gap-4">
        {q.data?.tables.map((x) => <TableDetail key={x.table + JSON.stringify(x.protected_columns)} x={x} />)}
      </div>
    </Disclosure>
    </>
  );
}

function TableDetail({ x }: { x: DescribedTable }) {
  const t = useT();
  const c = t.set.data.explore;
  const f = useFormat();
  const lang = useLang();
  const call = useCall();
  const [desc, setDesc] = useState(x.description ?? "");
  const [cols, setCols] = useState<string[]>(x.protected_columns);
  const id = `tbl-${x.table.replace(/[^\w]/g, "-")}`;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      notify(ok, { type: "success" });
    } catch (e) {
      notify(describeError(t, e, f.bytes), { type: "error" });
    }
  };
  return (
    <section aria-labelledby={id} className="rounded-md border border-border p-3">
      <h4 id={id} className="font-mono text-[13px] font-medium break-all text-text-strong">
        {x.table}
      </h4>
      <p className="mt-0.5 text-2xs text-text-muted tnum">
        {x.rows != null ? plural(lang, x.rows, c.rows_n, { n: f.int(x.rows) }) : "–"}
        {x.partitioned_by ? ` · ${fmt(c.partitioned, { column: x.partitioned_by })}` : ""}
      </p>
      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor={`${id}-desc`} className="text-2xs font-medium text-text-muted">
          {c.describe}
        </label>
        <div className="flex flex-wrap gap-2">
          <Input id={`${id}-desc`} value={desc} maxLength={200} onChange={(e) => setDesc(e.target.value)} className="min-w-0 flex-1 basis-64" />
          <Button size="sm" variant="outline" disabled={desc === (x.description ?? "")} onClick={() => void run(() => call("set_table_description", { table: x.table, description: desc }), c.describe_saved)}>
            {c.describe_save}
          </Button>
        </div>
        <p className="text-2xs text-text-subtle">{c.describe_hint}</p>
      </div>
      {!x.mart && (
        <fieldset className="mt-3">
          <legend className="text-2xs font-medium text-text-muted">{c.protected}</legend>
          <p className="text-2xs text-text-subtle">{c.protected_hint}</p>
          <p className="mt-1 text-2xs text-text-muted">{x.protected_confirmed ? c.confirmed : c.proposed}</p>
          <ul className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {x.columns.map((col) => (
              <li key={col.name}>
                <label className="flex items-center gap-2 font-mono text-2xs text-text">
                  <Checkbox checked={cols.includes(col.name.toLowerCase())} onCheckedChange={(v) => setCols((p) => (v ? [...p, col.name.toLowerCase()] : p.filter((n) => n !== col.name.toLowerCase())))} />
                  <span className="break-all">
                    {col.name} <span className="text-text-muted">{col.type}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void run(() => call("set_protected_columns", { table: x.table, columns: cols }), fmt(c.protected_saved, { table: x.table }))}>
            {c.confirm}
          </Button>
        </fieldset>
      )}
    </section>
  );
}
