// Settings › Events (owner round 5): the events every time chart draws. List, add, edit and delete with Undo, and
// "Import from GTM", scripted in the prototype. `?edit=<id>` (the chart popover's Edit) opens that event.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useAppState, useCall } from "@/api/queries";
import type { ChartEvent, EventType } from "@/api/types";
import { EVENT_ICON } from "@/components/charts/events";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useBilingual, useT } from "@/i18n";
import { useFormat } from "@/lib/format";
import { notify } from "@/lib/notify";

const TYPES: EventType[] = ["release", "campaign", "tag_change", "price_change", "other"];

export function EventsList() {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const call = useCall();
  const { data } = useAppState();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<ChartEvent | "new" | null>(null);
  const events = [...(data?.events ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const editParam = params.get("edit");
  useEffect(() => {
    if (!editParam || !data) return;
    const ev = data.events.find((e) => e.id === editParam);
    if (ev) setEditing(ev);
    const next = new URLSearchParams(params);
    next.delete("edit");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, data]);
  const undoable = (title: string, activityId: string) =>
    notify(title, {
      type: "success",
      actions: [
        {
          label: t.common.undo,
          onClick: async () => {
            await call("undo", { activity_id: activityId });
            notify(t.dash.toast.undone, { type: "success" });
          },
        },
      ],
    });
  const remove = async (ev: ChartEvent) => {
    const r = await call("delete_event", { id: ev.id });
    undoable(t.events.deleted, r.activity_id);
  };
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          <PlusIcon strokeWidth={1.75} data-icon="inline-start" />
          {t.events.add}
        </Button>
      </div>
      {events.length ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {events.map((e) => {
            const Icon = EVENT_ICON[e.type];
            return (
              <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-text">
                    <Icon size={13} strokeWidth={1.75} aria-hidden className="shrink-0 text-text-muted" />
                    <span className="min-w-0">{pick(e.title)}</span>
                  </span>
                  <span className="font-mono text-2xs text-text-muted tnum">
                    {f.date(e.date, true)} · {t.events.types[e.type]} · {t.events.sources[e.source]}
                  </span>
                  {e.note && <span className="text-2xs text-text-muted">{pick(e.note)}</span>}
                </span>
                <span className="flex items-center gap-0.5">
                  <Button variant="ghost" size="icon-sm" aria-label={`${t.events.edit}: ${pick(e.title)}`} title={t.events.edit} onClick={() => setEditing(e)}>
                    <PencilIcon strokeWidth={1.75} />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`${t.events.delete}: ${pick(e.title)}`} title={t.events.delete} onClick={() => void remove(e)}>
                    <Trash2Icon strokeWidth={1.75} />
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-text-muted">{t.events.empty}</p>
      )}
      <EventDialog event={editing} onClose={() => setEditing(null)} onSaved={(id) => undoable(t.events.saved, id)} />
    </div>
  );
}

function EventDialog({ event, onClose, onSaved }: { event: ChartEvent | "new" | null; onClose: () => void; onSaved: (activityId: string) => void }) {
  const t = useT();
  const pick = useBilingual();
  const call = useCall();
  const { data: state } = useAppState();
  const lastDay = state?.workspace.data_to ?? new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(lastDay);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<EventType>("other");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (event && event !== "new") {
      setDate(event.date);
      setTitle(pick(event.title));
      setType(event.type);
      setNote(event.note ? pick(event.note) : "");
    } else if (event === "new") {
      setDate(lastDay);
      setTitle("");
      setType("other");
      setNote("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);
  const save = async () => {
    const keep = event && event !== "new" ? event : null;
    // An edited title or note replaces the text in both languages only when it changed.
    const titleText = keep && pick(keep.title) === title ? keep.title : { en: title, tr: title };
    const noteText = note ? (keep?.note && pick(keep.note) === note ? keep.note : { en: note, tr: note }) : null;
    const r = await call("save_event", { event: { id: keep?.id, date, title: titleText, type, note: noteText } });
    onSaved(r.activity_id);
    onClose();
  };
  const field = "flex flex-col gap-1.5";
  const label = "text-2xs font-medium text-text-muted";
  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{event === "new" ? t.events.new_title : t.events.edit_title}</DialogTitle>
          <DialogDescription>{t.events.lead}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && date) void save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={field}>
              <label htmlFor="ev-date" className={label}>
                {t.events.date}
              </label>
              <Input id="ev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className={field}>
              <label htmlFor="ev-type" className={label}>
                {t.events.type}
              </label>
              <NativeSelect id="ev-type" value={type} onChange={(e) => setType(e.target.value as EventType)} className="w-full">
                {TYPES.map((x) => (
                  <NativeSelectOption key={x} value={x}>
                    {t.events.types[x]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className={field}>
            <label htmlFor="ev-title" className={label}>
              {t.events.name}
            </label>
            <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className={field}>
            <label htmlFor="ev-note" className={label}>
              {t.events.note}
            </label>
            <Input id="ev-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter className="mt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={!title.trim() || !date}>
              {t.events.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
