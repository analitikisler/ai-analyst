// Events on time charts (owner round 5): every time chart draws the events in its range (Settings › Events) as small
// markers on the x-axis, one neutral style with a type glyph, stacked when they share a day, each with a popover
// (title, type, date, note, source, Edit). A legend toggle per chart hides them. No new colours.
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { BadgePercentIcon, CircleDotIcon, MegaphoneIcon, RocketIcon, TagIcon, type LucideIcon } from "lucide-react";
import { ReferenceLine } from "recharts";
import { cn } from "cn";
import { useAppState } from "@/api/queries";
import type { ChartEvent, EventType } from "@/api/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmt, useBilingual, useT } from "@/i18n";
import { useFormat } from "@/lib/format";

export const EVENT_ICON: Record<EventType, LucideIcon> = { release: RocketIcon, campaign: MegaphoneIcon, tag_change: TagIcon, price_change: BadgePercentIcon, other: CircleDotIcon };

export interface EventGroup {
  /** The x key the events sit on (the day, or the week or month that holds them). */
  key: string;
  events: ChartEvent[];
}

/** Events that fall in a chart's keys. Daily keys match the day; week and month keys take the events inside them. */
export function groupEvents(events: ChartEvent[], keys: string[], grain: "day" | "week" | "month" = "day"): EventGroup[] {
  if (!keys.length) return [];
  const sorted = [...keys].sort();
  const end = (k: string) => {
    if (grain === "day") return k;
    const d = new Date(`${k}T00:00:00Z`);
    if (grain === "week") d.setUTCDate(d.getUTCDate() + 6);
    else d.setUTCMonth(d.getUTCMonth() + 1, 0);
    return d.toISOString().slice(0, 10);
  };
  const out = new Map<string, ChartEvent[]>();
  for (const e of events) {
    const k = grain === "day" ? (keys.includes(e.date) ? e.date : undefined) : [...sorted].reverse().find((x) => x <= e.date && e.date <= end(x));
    if (k) out.set(k, [...(out.get(k) ?? []), e]);
  }
  return [...out.entries()].map(([key, evs]) => ({ key, events: evs })).sort((a, b) => a.key.localeCompare(b.key));
}

/** The events for one chart, with its own show/hide toggle. */
export function useChartEvents(keys: string[], grain: "day" | "week" | "month" = "day") {
  const { data } = useAppState();
  const [on, setOn] = useState(true);
  const all = useMemo(() => groupEvents(data?.events ?? [], keys, grain), [data?.events, keys, grain]);
  return { groups: on ? all : [], count: all.reduce((n, g) => n + g.events.length, 0), on, setOn };
}

/** The legend toggle: "Events" with the count, pressed while shown. */
export function EventsToggle({ count, on, onChange }: { count: number; on: boolean; onChange: (v: boolean) => void }) {
  const t = useT();
  if (!count) return null;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cn("inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-2xs transition-colors", on ? "border-border-strong text-text" : "border-dashed border-border text-text-muted")}
    >
      <CircleDotIcon size={11} strokeWidth={1.75} aria-hidden />
      {t.charts.events}
      <span className="font-mono tnum text-text-muted">{count}</span>
    </button>
  );
}

/** The dashed day line and its marker, as ReferenceLines for a Recharts chart (call it as a function inside the chart). */
export function eventLines(groups: EventGroup[]) {
  return groups.map((g) => <ReferenceLine key={`ev-${g.key}`} x={g.key} stroke="var(--color-border-strong)" strokeDasharray="2 3" ifOverflow="extendDomain" label={<EventMarker group={g} />} />);
}

function EventMarker({ group, viewBox }: { group: EventGroup; viewBox?: { x: number; y: number; height: number } }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  if (!viewBox) return null;
  const first = group.events[0]!;
  const Icon = group.events.length > 1 ? null : EVENT_ICON[first.type];
  const label = group.events.map((e) => `${f.date(e.date)} · ${pick(e.title)}`).join("; ");
  return (
    <foreignObject x={viewBox.x - 9} y={viewBox.y + viewBox.height - 9} width={18} height={18} style={{ overflow: "visible" }}>
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={120}
          aria-label={fmt(t.charts.event_label, { events: label })}
          className="flex size-[18px] items-center justify-center rounded-sm border border-border-strong bg-surface font-mono text-[10px] leading-none text-text hover:bg-surface-2"
        >
          {Icon ? <Icon size={11} strokeWidth={1.75} aria-hidden /> : group.events.length}
        </PopoverTrigger>
        <PopoverContent side="top" className="w-72 gap-3 p-3">
          {group.events.map((e) => {
            const I = EVENT_ICON[e.type];
            return (
              <div key={e.id} className="flex flex-col gap-1 text-[13px] leading-[18px]">
                <p className="flex items-center gap-1.5 font-medium text-text-strong">
                  <I size={13} strokeWidth={1.75} aria-hidden />
                  {pick(e.title)}
                </p>
                <p className="font-mono text-2xs text-text-muted tnum">
                  {t.events.types[e.type]} · {f.date(e.date, true)} · {t.events.sources[e.source]}
                </p>
                {e.note && <p className="text-text">{pick(e.note)}</p>}
                <Link to={`/settings/events?edit=${e.id}`} className="w-fit text-2xs font-medium text-accent hover:underline">
                  {t.events.edit}
                </Link>
              </div>
            );
          })}
        </PopoverContent>
      </Popover>
    </foreignObject>
  );
}
