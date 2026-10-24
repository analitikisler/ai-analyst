// Dashboards (09-ux.md S07, S08; DECISIONS.md §5): one period and one comparison per dashboard, set in the top bar;
// a 12-column grid with rows of at least 180 px; view mode has no controls; edit mode adds the drag handle and the tile menu,
// and every change is one undoable action (toast with Undo, ⌘Z, Activity).
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ChevronDownIcon, LayoutDashboardIcon, MessageSquareTextIcon, PencilIcon } from "lucide-react";
import { isApiError } from "@/api";
import { useAppState, useCall, useDashboard } from "@/api/queries";
import type { ChartType, Compare, PeriodKey, Tile, TileWidth } from "@/api/types";
import { useOpenAskSheet } from "@/ask/hooks";
import { TileDrawer } from "@/components/dashboard/TileDrawer";
import { CheckSheet, CheckStrip } from "@/components/checks/CheckStrip";
import { TileMenu } from "@/components/dashboard/TileMenu";
import { TileView } from "@/components/dashboard/Tile";
import { tileNames } from "@/components/layout/AskSheet";
import { TopBarContent, usePhoneTitle } from "@/components/layout/TopBar";
import { EmptyState, Page } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmt, plural, useBilingual, useLang, useT } from "@/i18n";
import { useFormat } from "@/lib/format";
import { notify } from "@/lib/notify";
import { NewDashboardDialog } from "./AskPage";
import { NotFoundInline } from "./NotFoundPage";

const PERIODS: PeriodKey[] = ["last_7", "last_14", "last_28", "last_90", "last_week", "this_month", "last_month"];
const COMPARES: Compare[] = ["off", "previous_period", "previous_year"];

export function DashboardsIndex() {
  const t = useT();
  const navigate = useNavigate();
  const { data } = useAppState();
  const { search } = useLocation();
  const [creating, setCreating] = useState(false);
  const empty = !!data && !data.dashboards.length;
  useEffect(() => {
    if (empty) document.title = fmt(t.app.pageTitle, { page: t.dash.title });
  }, [empty, t]);
  if (!data) return <Skeleton className="h-80 w-full rounded-lg" />;
  // An own-data workspace starts with no dashboards (the example is demo data only).
  if (!data.dashboards.length) {
    return (
      <Page className="max-w-[880px]">
        <TopBarContent />
        <EmptyState bordered icon={LayoutDashboardIcon} title={t.dash.none.title} body={t.dash.none.body} action={<Button onClick={() => setCreating(true)}>{t.dash.none.create}</Button>} />
        <NewDashboardDialog answerId={creating ? "" : null} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/dashboards/${id}`)} />
      </Page>
    );
  }
  return <Navigate to={`/dashboards/${data.dashboards[0]!.id}${search}`} replace />;
}

export default function DashboardPage() {
  const t = useT();
  const f = useFormat();
  const lang = useLang();
  const pick = useBilingual();
  const call = useCall();
  const navigate = useNavigate();
  const location = useLocation();
  const { dashboardId } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: state } = useAppState();
  const { data, isLoading, isFetching, error, refetch } = useDashboard(dashboardId);
  const openAsk = useOpenAskSheet();
  const edit = params.get("edit") === "1";
  const menuFor = params.get("menu");
  const [dialog, setDialog] = useState<null | { kind: "rename" | "delete" | "new" | "tile"; tile?: Tile }>(null);
  const [live, setLive] = useState("");
  const [lifted, setLifted] = useState<{ id: string; from: number; at: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const lastActivity = useRef<string[]>([]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const dash = data?.dashboard;
  usePhoneTitle(dash ? pick(dash.name) : t.dash.title);

  useEffect(() => {
    if (dash) {
      document.title = fmt(t.app.pageTitle, { page: `${pick(dash.name)} · ${t.dash.title}` });
      for (const tile of dash.tiles) tileNames[tile.id] = tile.title;
    }
  }, [dash, pick, t]);

  // "Open" in the pin toast: scroll the tile into view and outline it for 2 s.
  useEffect(() => {
    const m = /^#tile-(.+)$/.exec(location.hash);
    if (!m || !data) return;
    const el = document.getElementById(`tile-${m[1]}`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      setHighlight(m[1]!);
      const timer = setTimeout(() => setHighlight(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [location.hash, data]);

  // A link that opens a tile menu (?menu=) brings the tile up first, so the menu opens below its ⋯ with room to spare.
  const [menuReady, setMenuReady] = useState(() => !params.get("menu"));
  useEffect(() => {
    if (menuReady || !data) return;
    // After this commit: the shell scrolls to the top on a route change after this page's effects. The menu opens after.
    const timer = setTimeout(() => {
      if (menuFor) document.getElementById(`tile-${menuFor}`)?.scrollIntoView({ block: "start" });
      setMenuReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [menuReady, menuFor, data]);

  const setEdit = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set("edit", "1");
    else {
      next.delete("edit");
      next.delete("menu");
    }
    setParams(next);
  };

  const undo = async (activityId: string) => {
    try {
      await call("undo", { activity_id: activityId });
      notify(t.dash.toast.undone);
    } catch (e) {
      notify(isApiError(e) && e.code === "undo_gone" ? t.err.undo_gone : t.err.invalid_input, { type: "error" });
    }
  };
  const changed = (message: string, activityId?: string) => {
    if (activityId) lastActivity.current.push(activityId);
    notify(message, { type: "success", actions: activityId ? [{ label: t.common.undo, onClick: () => void undo(activityId) }] : undefined });
  };

  // ⌘Z / Ctrl+Z in edit mode undoes the last change on this dashboard; Esc leaves edit mode.
  useEffect(() => {
    if (!edit) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        const id = lastActivity.current.pop();
        if (id) {
          e.preventDefault();
          void undo(id);
        }
      }
      if (e.key === "Escape" && !document.querySelector("[data-open][role=dialog], [data-open][data-slot=popover-content]") && !lifted) setEdit(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (isLoading && !data) {
    return (
      <Page aria-busy>
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-4 md:auto-rows-[minmax(180px,auto)] md:grid-cols-6 xl:grid-cols-12">
          {[3, 3, 6, 6, 8, 4].map((w, i) => (
            <Skeleton key={i} className={`h-[180px] rounded-lg md:h-auto md:col-span-${Math.min(w, 6)} xl:col-span-${w}`} />
          ))}
        </div>
      </Page>
    );
  }
  if (error || !data || !dash) return <NotFoundInline title={t.nf.dashboard} action={t.nf.open_dashboards} to="/dashboards" />;

  const period = dash.period;
  const compare = dash.compare;
  const yoyOff = true; // the demo starts on 25 Jul 2026, so a year earlier is never in this workspace
  const setPeriod = async (p: PeriodKey | undefined, c: Compare | undefined) => {
    try {
      const r = await call("set_dashboard_period", { dashboard_id: dash.id, period: p, compare: c });
      if (p) changed(fmt(t.dash.toast.period, { period: t.dash.period[p].toLocaleLowerCase(lang) }), r.activity_id);
      if (c) changed(fmt(t.dash.toast.compare, { compare: t.dash.compare[c].toLocaleLowerCase(lang) }), r.activity_id);
      setLive(fmt(t.dash.updated_live, { name: pick(dash.name), period: t.dash.period[p ?? period].toLocaleLowerCase(lang) }));
    } catch {
      notify(t.err.invalid_input, { type: "error" });
    }
  };

  const filters = (full?: boolean) => (
    <div className={full ? "grid grid-cols-2 gap-2 px-4 pb-2.5" : "flex items-center gap-2"} role="group" aria-label={t.dash.filters}>
      <label className="flex min-w-0 flex-col">
        <span className="sr-only">{t.dash.period.label}</span>
        <NativeSelect size="sm" value={period} onChange={(e) => void setPeriod(e.target.value as PeriodKey, undefined)} className={full ? "w-full" : "w-44"}>
          {PERIODS.map((p) => (
            <NativeSelectOption key={p} value={p}>
              {t.dash.period[p]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className="flex min-w-0 flex-col">
        <span className="sr-only">{t.dash.compare.label}</span>
        <NativeSelect size="sm" value={compare} onChange={(e) => void setPeriod(undefined, e.target.value as Compare)} className={full ? "w-full" : "w-48"} aria-describedby="yoy-reason">
          {COMPARES.map((c) => (
            <NativeSelectOption key={c} value={c} disabled={c === "previous_year" && yoyOff}>
              {c === "off" ? `${t.dash.compare.label}: ${t.dash.compare.off}` : c === "previous_year" && yoyOff ? `${t.dash.compare.previous_year} · ${fmt(t.dash.compare.yoy_disabled, { date: f.date(state?.workspace.data_from ?? "2026-07-25", true) })}` : t.dash.compare[c]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <span id="yoy-reason" className="sr-only">
          {fmt(t.dash.compare.yoy_disabled, { date: f.date(state?.workspace.data_from ?? "2026-07-25", true) })}
        </span>
      </label>
    </div>
  );

  const periodLine = data.compare_from && data.compare_to && compare !== "off"
    ? fmt(t.dash.period_line, { from: f.date(data.from), to: f.date(data.to, true), pfrom: f.date(data.compare_from), pto: f.date(data.compare_to), last: f.date(data.data_to, true) })
    : fmt(t.dash.period_line_off, { from: f.date(data.from), to: f.date(data.to, true), last: f.date(data.data_to, true) });

  const tiles = dash.tiles;
  const byId = new Map(data.tiles.map((r) => [r.tile_id, r]));
  const markedId = (data.tiles.find((r) => r.check?.verdict === "does_not_add_up") ?? data.tiles[0])?.tile_id;

  const move = async (tile: Tile, to: number) => {
    const r = await call("move_tile", { tile_id: tile.id, to_index: to });
    if (r.activity_id) changed(t.dash.toast.moved, r.activity_id);
    setLive(fmt(t.dash.moved_live, { title: pick(tile.title), n: to + 1, m: tiles.length }));
  };

  const onHandleKey = (tile: Tile, index: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!lifted) {
        setLifted({ id: tile.id, from: index, at: index });
        setLive(fmt(t.dash.lifted_live, { title: pick(tile.title), n: index + 1, m: tiles.length }));
      } else {
        const to = lifted.at;
        setLifted(null);
        if (to !== lifted.from) void move(tile, to);
      }
    } else if (lifted && (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp")) {
      e.preventDefault();
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      const at = Math.max(0, Math.min(tiles.length - 1, lifted.at + step));
      setLifted({ ...lifted, at });
      setLive(fmt(t.dash.moved_live, { title: pick(tile.title), n: at + 1, m: tiles.length }));
    } else if (lifted && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setLifted(null);
      setLive(t.dash.cancel_live);
    }
  };

  // While lifted with the keyboard, show the tile at its target slot.
  const order = ordered(tiles, lifted);

  const setMenu = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("menu", id);
    else next.delete("menu");
    setParams(next, { replace: true });
  };

  const header = (
    <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<button type="button" aria-label={t.dash.switcher} className="group inline-flex min-w-0 items-center gap-1.5 rounded-md text-left" />}>
              <h1 className="truncate font-display text-2xl leading-8 font-heading tracking-[-0.012em] text-text-strong sm:text-[28px] sm:leading-[34px]">{pick(dash.name)}</h1>
              <ChevronDownIcon size={20} strokeWidth={1.75} aria-hidden className="shrink-0 text-text-muted group-hover:text-text" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-60">
              <DropdownMenuGroup>
                <DropdownMenuRadioGroup value={dash.id} onValueChange={(v) => navigate(`/dashboards/${v}`)}>
                  {state?.dashboards.map((d) => (
                    <DropdownMenuRadioItem key={d.id} value={d.id}>
                      {pick(d.name)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setDialog({ kind: "new" })}>{t.dash.new}</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {dash.example && (
            <Tooltip>
              <TooltipTrigger render={<span tabIndex={0} className="inline-flex h-5 items-center rounded-sm border border-border bg-surface-2 px-1.5 text-2xs font-medium text-text-muted" />}>{t.dash.example}</TooltipTrigger>
              <TooltipContent>{t.dash.example_tip}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <p className="mt-1 text-[13px] text-text-muted tnum">{periodLine}</p>
        {edit && <p className="mt-1 text-[13px] text-text-muted">{t.dash.edit.note}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {edit ? (
          <>
            <Button onClick={() => setEdit(false)}>{t.dash.edit.done}</Button>
            <Button variant="outline" onClick={() => setDialog({ kind: "rename" })}>
              {t.dash.edit.rename}
            </Button>
            {(state?.dashboards.length ?? 1) <= 1 ? (
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" aria-disabled className="cursor-not-allowed text-text-subtle" />}>{t.dash.edit.delete}</TooltipTrigger>
                <TooltipContent>{t.dash.delete.only_one}</TooltipContent>
              </Tooltip>
            ) : (
              <Button variant="ghost" onClick={() => setDialog({ kind: "delete" })}>
                {t.dash.edit.delete}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => openAsk(`dashboard:${dash.id}`)}>
              <MessageSquareTextIcon strokeWidth={1.75} data-icon="inline-start" />
              {t.dash.ask_dashboard}
            </Button>
            <Button variant="outline" onClick={() => setEdit(true)}>
              <PencilIcon strokeWidth={1.75} data-icon="inline-start" />
              {t.dash.edit_button}
            </Button>
          </>
        )}
      </div>
    </header>
  );

  return (
    <Page>
      <TopBarContent phone={filters(true)}>{filters()}</TopBarContent>
      {header}
      <CheckStrip checks={data.checks} />
      {tiles.length === 0 ? (
        <EmptyState bordered icon={LayoutDashboardIcon} title={t.dash.empty.title} body={t.dash.empty.body} action={<Button onClick={() => navigate("/ask")}>{t.dash.empty.action}</Button>} />
      ) : (
        <div className="grid grid-flow-row-dense grid-cols-1 gap-4 md:auto-rows-[minmax(180px,auto)] md:grid-cols-6 xl:grid-cols-12" aria-busy={isFetching || undefined}>
          {order.map((tile) => {
            const index = tiles.findIndex((x) => x.id === tile.id);
            return (
              <TileView
                key={tile.id}
                tile={tile}
                result={byId.get(tile.id)}
                compare={compare}
                edit={edit}
                busy={isFetching && !isLoading}
                marked={tile.id === markedId}
                lifted={lifted?.id === tile.id || dragging === tile.id}
                dropTarget={dropOn === tile.id && dragging !== tile.id}
                highlight={highlight === tile.id}
                onOpen={() => setParams((p) => { const n = new URLSearchParams(p); n.set("tile", tile.id); return n; })}
                onHandleKey={onHandleKey(tile, index)}
                onDragStart={(e: DragEvent) => {
                  e.dataTransfer.setData("text/plain", tile.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragging(tile.id);
                }}
                onDragOver={(e: DragEvent) => {
                  if (!dragging) return;
                  e.preventDefault();
                  setDropOn(tile.id);
                }}
                onDrop={(e: DragEvent) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  const moving = tiles.find((x) => x.id === id);
                  setDropOn(null);
                  setDragging(null);
                  if (moving && moving.id !== tile.id) void move(moving, index);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDropOn(null);
                }}
                onRetry={() => void refetch()}
                menu={
                  <TileMenu
                    tile={tile}
                    result={byId.get(tile.id)}
                    index={index}
                    count={tiles.length}
                    open={menuReady && menuFor === tile.id}
                    onOpenChange={(o) => setMenu(o ? tile.id : null)}
                    onChart={async (c: ChartType) => {
                      const r = await call("update_tile", { tile_id: tile.id, chart: c });
                      changed(fmt(t.dash.toast.chart, { chart: t.dash.chart[c].toLocaleLowerCase(lang) }), r.activity_id);
                    }}
                    onSize={async (w: TileWidth, h: 1 | 2) => {
                      const r = await call("update_tile", { tile_id: tile.id, size: { w, h } });
                      changed(fmt(t.dash.toast.size, { w, h }), r.activity_id);
                    }}
                    onRename={() => setDialog({ kind: "tile", tile })}
                    onDuplicate={async () => {
                      const r = await call("duplicate_tile", { tile_id: tile.id });
                      changed(t.dash.toast.duplicated, r.activity_id);
                    }}
                    onMove={(to) => void move(tile, to)}
                    onAsk={() => openAsk(`tile:${tile.id}`, tileQuestion(tile, lang))}
                    onRemove={async () => {
                      const r = await call("remove_tile", { tile_id: tile.id });
                      changed(t.dash.toast.removed, r.activity_id);
                    }}
                  />
                }
              />
            );
          })}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      <CheckSheet period={{ from: data.from, to: data.to }} />
      <TileDrawer result={data} onAsk={(tile) => openAsk(`tile:${tile.id}`, tileQuestion(tile, lang))} />
      <DashboardDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        dashName={pick(dash.name)}
        tileCount={tiles.length}
        onRename={async (name) => {
          const kind = dialog?.kind;
          if (kind === "tile" && dialog?.tile) {
            const r = await call("update_tile", { tile_id: dialog.tile.id, title: name });
            changed(t.dash.toast.renamed, r.activity_id);
          } else if (kind === "rename") {
            const r = await call("rename_dashboard", { dashboard_id: dash.id, name });
            changed(t.dash.toast.dash_renamed, r.activity_id);
          } else if (kind === "new") {
            const d = await call("create_dashboard", { name });
            notify(t.dash.toast.created, { type: "success" });
            navigate(`/dashboards/${d.id}`);
          }
          setDialog(null);
        }}
        onDelete={async () => {
          const r = await call("delete_dashboard", { dashboard_id: dash.id });
          setDialog(null);
          notify(t.dash.toast.deleted);
          navigate(`/dashboards/${r.next}`);
        }}
        initialName={dialog?.kind === "tile" && dialog.tile ? pick(dialog.tile.title) : dialog?.kind === "new" ? t.dash.new_dialog.default : pick(dash.name)}
        lang={lang}
      />
    </Page>
  );
}

/** The question "Ask about this tile" sends (09-ux.md S06). */
function tileQuestion(tile: Tile, lang: "en" | "tr"): string {
  const q = tile.query;
  if (q.type === "check") {
    if (q.check === "ga4_vs_orders") return lang === "tr" ? "Son 28 günde GA4 satın almaları siparişlerle tutuyor mu?" : "Do GA4 purchases match orders in the last 28 days?";
    if (q.check === "meta_vs_orders") return lang === "tr" ? "Son 28 günde Meta dönüşümleri siparişlerle tutuyor mu?" : "Do Meta conversions match orders in the last 28 days?";
    if (q.check === "gads_vs_orders") return lang === "tr" ? "Son 28 günde Google Ads dönüşümleri siparişlerle tutuyor mu?" : "Do Google Ads conversions match orders in the last 28 days?";
    return lang === "tr" ? "Son 28 günde GA4 geliri ciroyla tutuyor mu?" : "Does GA4 revenue match revenue in the last 28 days?";
  }
  if (q.type === "explore") return tile.title[lang];
  const metric: Record<string, [string, string]> = { revenue: ["Revenue", "ciro"], orders: ["Orders", "sipariş"], roas: ["ROAS", "ROAS"], sessions: ["Sessions", "oturum"], ad_spend: ["Ad spend", "reklam harcaması"], aov: ["Average order value", "sepet ortalaması"], conversion_rate: ["Conversion rate", "dönüşüm oranı"], cpa: ["Cost per order", "sipariş başı maliyet"], ga4_purchases: ["GA4 purchases", "GA4 satın alma"], ga4_revenue: ["GA4 revenue", "GA4 geliri"], platform_conversions: ["Platform conversions", "platform dönüşümü"] };
  const [en, tr] = metric[q.metric] ?? [q.metric, q.metric];
  const g = q.group_by;
  if (lang === "tr") return `Son 28 günde ${g === "channel" ? "kanallara göre " : g === "device" ? "cihaza göre " : g === "day" ? "günlük " : ""}${tr}`;
  return `${en}${g === "channel" ? " by channel" : g === "device" ? " by device" : g === "day" ? " by day" : ""} in the last 28 days`;
}

function ordered(tiles: Tile[], lifted: { id: string; at: number } | null) {
  if (!lifted) return tiles;
  const rest = tiles.filter((x) => x.id !== lifted.id);
  const moving = tiles.find((x) => x.id === lifted.id);
  if (!moving) return tiles;
  rest.splice(lifted.at, 0, moving);
  return rest;
}

function DashboardDialogs({
  dialog,
  onClose,
  onRename,
  onDelete,
  dashName,
  tileCount,
  initialName,
  lang,
}: {
  dialog: null | { kind: "rename" | "delete" | "new" | "tile"; tile?: Tile };
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  dashName: string;
  tileCount: number;
  initialName: string;
  lang: "en" | "tr";
}) {
  const t = useT();
  const [name, setName] = useState("");
  useEffect(() => {
    if (dialog) setName(initialName);
  }, [dialog, initialName]);
  const kind = dialog?.kind;
  const title = kind === "tile" ? t.dash.tile_rename.title : kind === "new" ? t.dash.new_dialog.title : kind === "delete" ? fmt(t.dash.delete.title, { name: dashName }) : t.dash.rename.title;
  return (
    <Dialog open={!!dialog} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {kind === "delete" && <DialogDescription>{plural(lang, tileCount, t.dash.delete.body, { n: tileCount })}</DialogDescription>}
          {kind === "new" && <DialogDescription>{t.dash.new_dialog.hint}</DialogDescription>}
        </DialogHeader>
        {kind === "delete" ? (
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => void onDelete()}>
              {t.dash.delete.confirm}
            </Button>
          </DialogFooter>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void onRename(name.trim());
            }}
            className="flex flex-col gap-1.5"
          >
            <label htmlFor="dash-name" className="text-2xs font-medium text-text-muted">
              {t.dash.rename.label}
            </label>
            <Input id="dash-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <DialogFooter className="mt-3">
              <Button type="button" variant="ghost" onClick={onClose}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                {kind === "new" ? t.dash.new_dialog.create : kind === "tile" ? t.dash.tile_rename.save : t.dash.rename.save}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
