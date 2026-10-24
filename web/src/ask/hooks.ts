// Person actions from an answer or a check, with their toasts and Undo (09-ux.md F4, F7).
import { useNavigate, useSearchParams } from "react-router";
import { useAppState, useCall } from "@/api/queries";
import type { CheckId } from "@/api/types";
import { fmt, useBilingual, useLang, useT } from "@/i18n";
import { notify } from "@/lib/notify";
import { CHECK_LABELS } from "./labels";

export function usePin() {
  const t = useT();
  const lang = useLang();
  const pick = useBilingual();
  const call = useCall();
  const navigate = useNavigate();
  const { data } = useAppState();
  return async (answerId: string, dashboardId?: string) => {
    try {
      const r = await call("pin_answer", { answer_id: answerId, dashboard_id: dashboardId });
      const dash = data?.dashboards.find((d) => d.id === r.tile.dashboard_id);
      const name = dash ? pick(dash.name) : "";
      const dashResult = await call("get_dashboard", { dashboard_id: r.tile.dashboard_id });
      const period = (t.dash.period as Record<string, string>)[dashResult.dashboard.period]?.toLocaleLowerCase(lang) ?? "";
      notify(fmt(t.ask.toast.pinned, { dashboard: name, period }), {
        type: "success",
        actions: [
          {
            label: t.common.undo,
            onClick: () => {
              if (r.activity_id) void call("undo", { activity_id: r.activity_id }).then(() => notify(fmt(t.ask.toast.unpinned, { dashboard: name })));
            },
          },
          { label: t.common.open, onClick: () => navigate(`/dashboards/${r.tile.dashboard_id}#tile-${r.tile.id}`) },
        ],
      });
    } catch {
      notify(t.err.invalid_input, { type: "error" });
    }
  };
}

export function useWatchToggle() {
  const t = useT();
  const pick = useBilingual();
  const call = useCall();
  return async (check: CheckId, watching: boolean) => {
    try {
      if (watching) {
        const r = await call("unwatch_check", { check });
        notify(fmt(t.ask.toast.unwatch, { check: pick(CHECK_LABELS[check]) }), {
          actions: r.activity_id ? [{ label: t.common.undo, onClick: () => void call("undo", { activity_id: r.activity_id! }) }] : undefined,
        });
      } else {
        const r = await call("watch_check", { check });
        notify(fmt(t.ask.toast.watch, { check: pick(CHECK_LABELS[check]) }), {
          type: "success",
          actions: r.activity_id ? [{ label: t.common.undo, onClick: () => void call("undo", { activity_id: r.activity_id! }) }] : undefined,
        });
      }
    } catch {
      notify(t.err.invalid_input, { type: "error" });
    }
  };
}

/** Opens the Ask sheet on any page (09-ux.md §1.2: `?ask=new&about=kind:id`), optionally sending a question at once. */
export function useOpenAskSheet() {
  const [params, setParams] = useSearchParams();
  return (about?: string, question?: string) => {
    const next = new URLSearchParams(params);
    next.set("ask", "new");
    if (about) next.set("about", about);
    else next.delete("about");
    if (question) next.set("q", question);
    else next.delete("q");
    setParams(next);
  };
}

/** Opens a metric's page in the data dictionary (owner round 5 replaced the metric sheet). */
export function useOpenMetric() {
  const navigate = useNavigate();
  return (metric: string) => navigate(`/metrics/${metric}`);
}
