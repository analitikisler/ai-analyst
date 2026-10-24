// Activity (09-ux.md S11), now a section of Settings (owner round 4): only real actions by a person, the agent, AI
// Analyst itself or a chat app; what waits for a decision at the top; grouped by day; Undo where it applies.
import { useSearchParams } from "react-router";
import { HistoryIcon } from "lucide-react";
import { isApiError } from "@/api";
import { useAppState, useCall } from "@/api/queries";
import type { Activity } from "@/api/types";
import { ApprovalCard } from "@/components/ask/Thread";
import { EmptyState, ErrorState, SegmentedControl } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmt, useBilingual, useT } from "@/i18n";
import { useFormat } from "@/lib/format";
import { notify } from "@/lib/notify";

export function ActivityList() {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const call = useCall();
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useAppState();
  const filter = params.get("filter") === "waiting" ? "waiting" : "all";
  const pending = data?.proposals.filter((p) => p.status === "pending") ?? [];
  const undo = async (a: Activity) => {
    try {
      await call("undo", { activity_id: a.id });
      notify(t.dash.toast.undone, { type: "success" });
    } catch (e) {
      notify(isApiError(e) && e.code === "undo_gone" ? t.err.undo_gone : t.err.invalid_input, { type: "error" });
    }
  };
  const actor = (a: Activity) => (a.actor === "chat_app" ? fmt(t.activity.actor.chat_app, { name: a.client ?? "" }) : t.activity.actor[a.actor]);
  const groups = new Map<string, Activity[]>();
  for (const a of data?.activity ?? []) {
    const day = f.localDay(new Date(a.at));
    groups.set(day, [...(groups.get(day) ?? []), a]);
  }
  const today = f.localDay(new Date());
  const yesterday = f.localDay(new Date(Date.now() - 86400000));
  return (
    <div className="flex flex-col gap-5 px-4 py-4">
      <div>
          <SegmentedControl
            label={t.activity.filter.label}
            size="md"
            value={filter}
            onChange={(v) => {
              const next = new URLSearchParams(params);
              if (v === "waiting") next.set("filter", "waiting");
              else next.delete("filter");
              setParams(next, { replace: true });
            }}
            options={[
              { value: "all", label: t.activity.filter.all },
              { value: "waiting", label: fmt(t.activity.filter.waiting, { n: pending.length }) },
            ]}
          />
      </div>
      {isLoading && <Skeleton className="h-48 w-full rounded-lg" />}
      {error && <ErrorState title={t.err.generic} onRetry={() => void refetch()} />}
      {data && (pending.length > 0 || filter === "waiting") && (
        <section aria-labelledby="waiting-title" className="flex flex-col gap-3">
          <h3 id="waiting-title" className="text-sm font-semibold text-text-strong">
            {t.activity.waiting}
          </h3>
          {pending.length ? pending.map((p) => <ApprovalCard key={p.id} proposal={p} where="activity" />) : <p className="text-[13px] text-text-muted">{t.activity.waiting_empty}</p>}
        </section>
      )}
      {data && filter === "all" && data.activity.length === 0 && <EmptyState bordered icon={HistoryIcon} title={t.activity.empty.title} body={t.activity.empty.body} />}
      {data && filter === "all" && data.activity.length > 0 && (
        <div className="flex flex-col gap-6">
          {[...groups.entries()].map(([day, rows]) => (
            <section key={day} aria-label={day === today ? t.common.today : day === yesterday ? t.common.yesterday : f.date(day, true)}>
              <h3 className="mb-2 text-2xs font-medium text-text-muted">{day === today ? t.common.today : day === yesterday ? t.common.yesterday : f.date(day, true)}</h3>
              <ul className="overflow-hidden rounded-lg border border-border bg-surface">
                {rows.map((a) => (
                  <li key={a.id} className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5 last:border-0 sm:grid-cols-[3.5rem_9rem_minmax(0,1fr)_auto]">
                    <span className="font-mono text-2xs text-text-muted tnum">{f.time(a.at)}</span>
                    <span className="order-first col-span-3 text-2xs text-text-muted sm:order-none sm:col-span-1 sm:text-[13px]">{actor(a)}</span>
                    <span className="min-w-0 text-sm text-text">{pick(a.detail)}</span>
                    <span className="flex justify-end">
                      {a.undo &&
                        (a.undone ? (
                          <span className="text-2xs text-text-muted">{t.activity.undone}</span>
                        ) : a.undo_gone ? (
                          <Tooltip>
                            <TooltipTrigger render={<Button variant="ghost" size="xs" aria-disabled className="cursor-not-allowed text-text-subtle" />}>{t.activity.undo}</TooltipTrigger>
                            <TooltipContent>{t.activity.undo_gone}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Button variant="ghost" size="xs" onClick={() => void undo(a)}>
                            {t.activity.undo}
                          </Button>
                        ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
