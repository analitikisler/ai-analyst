// Settings (09-ux.md S12, S13; DECISIONS.md §2, §3): one page, six sections in a fixed order. The page lead says
// where settings are saved; only Language and theme carries a badge ("This browser only"). Every control works now: BigQuery is tested before it is
// used, a model key is tested before it is saved, chat-app snippets copy, and nothing is sent anywhere.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { cn } from "cn";
import { ExternalLinkIcon, LockIcon, MailIcon } from "lucide-react";
import { useAppState, useCall, useChatCalls, useChatSetup, useSettings, useSources } from "@/api/queries";
import type { ChatAppCall, ChatClient, ProviderId, ProviderStatus, Settings } from "@/api/types";
import { CHECK_PLATFORM } from "@/ask/labels";
import { BigQuerySheet } from "@/components/settings/BigQuerySheet";
import { KeySheet } from "@/components/settings/KeySheet";
import { ConnectorCards, WaitlistCards } from "@/components/settings/Connectors";
import { Ga4Sheet } from "@/components/settings/Ga4Sheet";
import { OrdersSheet } from "@/components/settings/OrdersSheet";
import { ShopSheet } from "@/components/settings/ShopSheet";
import { ExploreTables } from "@/components/settings/ExploreTables";
import { ActivityList } from "@/components/activity/ActivityList";
import { EventsList } from "@/components/settings/EventsSection";
import { Switch } from "@/components/ui/switch";
import { TopBarContent, usePhoneTitle } from "@/components/layout/TopBar";
import { CodeBlock, CopyButton, Disclosure, PageHeader, SegmentedControl } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { fmt, LANGS, useBilingual, useLang, useT } from "@/i18n";
import { StatusGlyph } from "@/components/art/StatusGlyph";
import { describeError, sourceUnavailableSentence } from "@/lib/errors";
import { useFormat } from "@/lib/format";
import { notify } from "@/lib/notify";
import { usePref } from "@/lib/prefs";
import { useTheme, type ThemePref } from "@/lib/theme";

export const SECTIONS = ["sources", "events", "model", "chat-apps", "language", "help", "activity", "about"] as const;
export type Section = (typeof SECTIONS)[number];
const CLIENTS: ChatClient[] = ["claude-desktop", "claude-code", "cursor", "codex"];
const PROVIDERS: ProviderId[] = ["anthropic", "openai", "gemini", "openai_compatible"];
const GB = 1024 ** 3;
const CAPS = [2 * GB, GB, 512 * 1024 ** 2, 100 * 1024 ** 2];
const PROVIDER_NAME: Record<ProviderId, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Google Gemini", openai_compatible: "OpenAI-compatible" };

function Card({ id, title, lead, scope, children }: { id: Section; title: string; lead: string; scope?: "browser"; children: React.ReactNode }) {
  const t = useT();
  return (
    <section id={`set-${id}`} aria-labelledby={`set-${id}-title`} className="scroll-mt-[72px] overflow-hidden rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id={`set-${id}-title`} tabIndex={-1} className="text-base font-semibold text-text-strong outline-offset-2">
            {title}
          </h2>
          <p className="mt-0.5 text-[13px] text-text-muted">{lead}</p>
        </div>
        {scope && <span className="inline-flex h-5 shrink-0 items-center rounded-sm border border-border-strong px-1.5 text-2xs text-text-muted">{t.set.scope[scope]}</span>}
      </header>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

/** "Set on the server by AI_ANALYST_…": a field an environment variable locks. */
function EnvLock({ value }: { value: { locked: boolean; env?: string } }) {
  const t = useT();
  if (!value.locked) return null;
  return (
    <p className="mb-2 flex items-start gap-1.5 text-2xs text-text-muted">
      <LockIcon size={12} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
      <span>{fmt(t.set.env_lock, { variable: value.env ?? "" })}</span>
    </p>
  );
}

function Row({ label, hint, children, className }: { label: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-x-6 gap-y-2 px-4 py-3 md:grid-cols-[15rem_minmax(0,1fr)]", className)}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-text">{label}</div>
        {hint && <p className="mt-0.5 text-2xs text-text-subtle">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { section: sectionParam, client } = useParams();
  const section = client ? "chat-apps" : sectionParam;
  const active: Section = (SECTIONS as readonly string[]).includes(section ?? "") ? (section as Section) : "sources";
  const { data: s } = useSettings();
  const loaded = !!s;
  usePhoneTitle(t.set.title);
  useEffect(() => {
    document.title = fmt(t.app.pageTitle, { page: `${t.set.nav[active]} · ${t.set.title}` });
  }, [active, t]);
  // A deep link (/settings/model, Make it yours › Add a model) scrolls its section into view and focuses the heading.
  // It runs after this commit: the shell's own route effect scrolls to the top after this page's effects have run.
  useEffect(() => {
    if (!section || !loaded) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`set-${active}`);
      if (!el) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      document.getElementById(`set-${active}-title`)?.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [active, section, loaded]);
  return (
    <div className="mx-auto w-full max-w-[1024px]">
      <TopBarContent />
      <PageHeader title={t.set.title} subtitle={t.set.lead} documentTitle={false} />
      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label={t.set.title} className="lg:sticky lg:top-20 lg:self-start">
          <label className="lg:hidden">
            <span className="mb-1 block text-2xs font-medium text-text-muted">{t.set.jump}</span>
            <NativeSelect value={active} onChange={(e) => navigate(`/settings/${e.target.value}`)} className="w-full">
              {SECTIONS.map((x) => (
                <NativeSelectOption key={x} value={x}>
                  {t.set.nav[x]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <ul className="hidden flex-col gap-px lg:flex">
            {SECTIONS.map((x) => (
              <li key={x}>
                <Link to={x === "chat-apps" ? `/settings/chat-apps/${client ?? "claude-desktop"}` : `/settings/${x}`} aria-current={active === x ? "location" : undefined} className={cn("flex h-8 items-center rounded-md px-2 text-sm font-medium", active === x ? "bg-primary-soft text-accent-ink" : "text-text-muted hover:bg-surface-2 hover:text-text")}>
                  {t.set.nav[x]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col gap-6">
          {s && !s.server.loopback && (
            <p role="note" className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning-soft px-4 py-3 text-[13px] leading-[18px] text-text">
              <LockIcon size={14} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
              {t.set.readonly}
            </p>
          )}
          {!s ? (
            <Skeleton className="h-96 w-full rounded-lg" />
          ) : (
            <>
              {/* Off loopback the data source and model controls are disabled; the server refuses those changes too. */}
              <fieldset disabled={!s.server.loopback} className="m-0 min-w-0 border-0 p-0">
                <DataSection s={s} />
              </fieldset>
              <Card id="events" title={t.set.nav.events} lead={t.events.lead}>
                <EventsList />
              </Card>
              <fieldset disabled={!s.server.loopback} className="m-0 min-w-0 border-0 p-0">
                <ModelSection s={s} />
              </fieldset>
              <ChatSection client={(CLIENTS as string[]).includes(client ?? "") ? (client as ChatClient) : "claude-desktop"} />
              <LanguageSection />
              <HelpSection s={s} />
              <Card id="activity" title={t.set.nav.activity} lead={t.activity.lead}>
                <ActivityList />
              </Card>
              <AboutSection s={s} />
            </>
          )}
        </div>
      </div>
      <BigQuerySheet />
      <Ga4Sheet />
      <OrdersSheet />
      <ShopSheet />
      <KeySheet />
    </div>
  );
}

function DataSection({ s }: { s: Settings }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const call = useCall();
  const [, setParams] = useSearchParams();
  const { data: state } = useAppState();
  const { data: sources } = useSources();
  const [confirm, setConfirm] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const kind = s.data_source.kind.value;
  const demo = kind === "demo";
  const bq = s.data_source.bigquery;
  const connected = (state?.connectors ?? []).filter((c) => c.status !== "not_connected");
  const froms = connected.map((c) => c.last_sync?.from).filter((x): x is string => !!x).sort();
  const tos = connected.map((c) => c.last_sync?.to).filter((x): x is string => !!x).sort();
  const localRange = froms.length && tos.length ? f.range(froms[0]!, tos[tos.length - 1]!) : t.format.dash;
  const rebuild = async () => {
    setRebuilding(true);
    await call("rebuild_demo", {});
    setRebuilding(false);
    setConfirm(false);
    notify(t.set.data.rebuilt_toast, { type: "success" });
  };
  return (
    <Card id="sources" title={t.set.nav.sources} lead={t.sources.lead}>
      <Row label={t.sources.active}>
        <EnvLock value={s.data_source.kind} />
        {demo ? (
          <>
            <p className="text-sm text-text">{t.set.data.demo_name}</p>
            <p className="mt-0.5 font-mono text-2xs text-text-muted tnum">{fmt(t.set.data.demo_meta, { from: f.date(state?.workspace.data_from), to: f.date(state?.workspace.data_to, true), rows: f.int(state?.workspace.rows), time: f.whenMid(state?.workspace.refreshed_at) })}</p>
            <Disclosure label={t.set.data.demo_contents} className="mt-1">
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {sources?.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-text">{pick(x.name)}</span>
                    <span className="font-mono text-2xs text-text-muted">{x.detail}</span>
                    <span className="inline-flex h-5 items-center rounded-sm border border-border bg-surface-2 px-1.5 text-2xs text-text-muted">{t.set.data.demo_tag}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-2xs text-text-muted">{t.set.data.demo_note}</p>
            </Disclosure>
          </>
        ) : kind === "local" ? (
          <>
            <p className="text-sm text-text">{t.sources.kind.local}</p>
            <p className="mt-0.5 font-mono text-2xs text-text-muted tnum">
              {connected.length ? fmt(t.sources.local_meta, { range: localRange, sources: connected.map((c) => pick(c.name)).join(", ") }) : t.sources.local_none}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-text">{fmt(t.set.data.bq.in_use_name, { table: bq ? `${bq.data_project}.${bq.dataset}` : (state?.source.table ?? state?.source.project ?? "–"), location: bq?.location ?? "–" })}</p>
            <p className="mt-0.5 font-mono text-2xs text-text-muted tnum">{fmt(t.set.data.bq.in_use_meta, { time: f.whenMid(s.data_source.checked_at) })}</p>
          </>
        )}
        {sourceUnavailableSentence(t, state?.source.error) && (
          <p role="status" className="mt-2 flex items-start gap-1.5 text-[13px] leading-[18px] text-danger">
            <StatusGlyph tone="bad" size={12} className="mt-[3px] shrink-0" />
            {sourceUnavailableSentence(t, state?.source.error)}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!demo && (
            <Button
              variant="outline"
              size="sm"
              disabled={s.data_source.kind.locked}
              onClick={async () => {
                await call("save_data_source", { kind: "demo" });
                notify(t.sources.demo_toast, { type: "success" });
              }}
            >
              {t.sources.use_demo}
            </Button>
          )}
          {kind !== "local" && connected.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={s.data_source.kind.locked}
              onClick={async () => {
                await call("save_data_source", { kind: "local" });
                notify(t.sources.local_toast, { type: "success" });
              }}
            >
              {t.sources.use_local}
            </Button>
          )}
          {demo && (
            <Button variant="ghost" size="sm" onClick={() => setConfirm(true)} disabled={rebuilding}>
              {rebuilding && <Spinner data-icon="inline-start" />}
              {rebuilding ? t.set.data.rebuilding : t.set.data.rebuild}
            </Button>
          )}
        </div>
      </Row>
      <div className="flex flex-col gap-3 px-4 py-4">
        <div>
          <h3 className="text-sm font-semibold text-text-strong">{t.sources.connect_title}</h3>
          <p className="mt-0.5 text-[13px] text-text-muted">{t.sources.connect_lead}</p>
          {__DEMO__ && <p className="mt-0.5 text-2xs text-text-subtle">{t.sources.simulated}</p>}
        </div>
        <ConnectorCards />
      </div>
      <Row label={t.sources.card.bigquery.title} hint={t.sources.card.bigquery.lead}>
        <div className="flex flex-wrap items-center gap-3">
          {kind === "bigquery" && <span className="inline-flex h-6 items-center rounded-sm border border-accent/40 bg-accent-soft px-2 text-xs font-medium text-accent-ink">{t.set.data.in_use}</span>}
          <Button variant="outline" size="sm" disabled={s.data_source.kind.locked} onClick={() => setParams({ connect: "bigquery" })}>
            {kind === "bigquery" ? t.set.data.bq.change : t.set.data.bq.connect}
          </Button>
          <a href="https://github.com/analitikisler/ai-analyst/blob/main/docs/connecting-bigquery.md" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
            {t.set.data.bq.guide}
            <ExternalLinkIcon size={14} strokeWidth={1.75} aria-hidden />
            <span className="sr-only">{t.common.opens_tab}</span>
          </a>
        </div>
      </Row>
      <Row label={t.set.data.cap} hint={t.set.data.cap_hint}>
        <EnvLock value={s.data_source.max_bytes} />
        <NativeSelect
          size="sm"
          disabled={s.data_source.max_bytes.locked}
          value={String(s.data_source.max_bytes.value)}
          onChange={async (e) => {
            await call("set_bytes_cap", { max_bytes: Number(e.target.value) });
            notify(t.set.data.cap_saved, { type: "success" });
          }}
          className="w-36"
          aria-label={t.set.data.cap}
        >
          {CAPS.map((c) => (
            <NativeSelectOption key={c} value={c}>
              {f.bytes(c)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <Row label={t.set.data.currency} hint={t.set.data.currency_hint}>
        <EnvLock value={s.data_source.currency} />
        <CurrencyPicker value={s.data_source.currency.value} locked={s.data_source.currency.locked} />
      </Row>
      <Row label={t.set.data.explore.title} hint={t.set.data.explore.hint}>
        <ExploreTables s={s} />
      </Row>
      <div className="flex flex-col gap-3 px-4 py-4">
        <div>
          <h3 className="text-sm font-semibold text-text-strong">{t.sources.waitlist.title}</h3>
          <p className="mt-0.5 text-[13px] text-text-muted">{t.sources.waitlist.lead}</p>
        </div>
        <WaitlistCards />
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.set.data.rebuild_confirm.title}</DialogTitle>
            <DialogDescription>{t.set.data.rebuild_confirm.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => void rebuild()} disabled={rebuilding}>
              {t.set.data.rebuild_confirm.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ModelSection({ s }: { s: Settings }) {
  const t = useT();
  const call = useCall();
  const f = useFormat();
  const [, setParams] = useSearchParams();
  const [removing, setRemoving] = useState<ProviderId | null>(null);
  const [testing, setTesting] = useState<ProviderId | null>(null);
  const [tested, setTested] = useState<Record<string, string>>({});
  const active = s.model.provider.value;
  const set = s.model.providers.filter((p) => p.set);
  const status =
    active === "planner"
      ? t.set.model.status_planner
      : fmt(t.set.model.status_key, { provider: PROVIDER_NAME[active], model: s.model.providers.find((p) => p.id === active)?.model ?? "" });
  const also = set.filter((p) => p.id !== active).map((p) => PROVIDER_NAME[p.id]);
  const test = async (p: ProviderStatus) => {
    setTesting(p.id);
    let r: Awaited<ReturnType<typeof call<"test_model_key">>>;
    try {
      r = await call("test_model_key", { provider: p.id, model: p.model ?? "" });
    } catch (e) {
      // no_cloud, a server error or no server: the reason goes where the result would have.
      setTesting(null);
      setTested((x) => ({ ...x, [p.id]: describeError(t, e, f.bytes) }));
      return;
    }
    setTesting(null);
    setTested((x) => ({ ...x, [p.id]: r.ok ? fmt(t.set.model.test_ok, { model: r.model, s: f.dec(r.seconds ?? 1, 1) }) : r.error && r.error.code !== "key_rejected" ? fmt(t.set.key.err[r.error.code], { provider: PROVIDER_NAME[p.id], model: r.model, url: p.base_url ?? "" }) : fmt(t.set.model.test_failed, { provider: PROVIDER_NAME[p.id] }) }));
  };
  return (
    <Card id="model" title={t.set.nav.model} lead={t.set.model.lead}>
      <div className="px-4 py-3">
        <p className="text-sm text-text">{status}</p>
        {also.length > 0 && <p className="mt-0.5 text-2xs text-text-muted">{fmt(t.set.model.also_set, { providers: also.join(", ") })}</p>}
      </div>
      {PROVIDERS.map((id) => {
        const p = s.model.providers.find((x) => x.id === id)!;
        return (
          <Row
            key={id}
            label={
              <span className="flex flex-wrap items-center gap-2">
                {t.set.model.providers[id]}
                {active === id && <span className="inline-flex h-5 items-center rounded-sm border border-accent/40 bg-accent-soft px-1.5 text-2xs font-medium text-accent-ink">{t.set.model.in_use}</span>}
              </span>
            }
            hint={id === "openai_compatible" ? t.set.model.compat_hint : undefined}
          >
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-1.5 text-[13px] text-text-muted">
                <LockIcon size={14} strokeWidth={1.75} aria-hidden />
                {p.set ? (p.hint ? fmt(t.set.model.saved, { hint: p.hint }) : fmt(t.set.model.saved_nohint, { url: p.base_url ?? "" })) : t.set.model.not_set}
                {p.set && p.model && <span className="font-mono text-2xs">· {p.model}</span>}
              </p>
              <EnvLock value={p} />
              <div className="flex flex-wrap gap-2">
                {!p.set ? (
                  <Button variant="outline" size="sm" disabled={p.locked} onClick={() => setParams({ provider: id })}>
                    {t.set.model.add_key}
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" size="sm" onClick={() => void test(p)} disabled={testing === id}>
                      {testing === id && <Spinner data-icon="inline-start" />}
                      {testing === id ? t.set.model.testing : t.set.model.test}
                    </Button>
                    {active !== id && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={s.model.provider.locked}
                        onClick={async () => {
                          await call("set_model_provider", { provider: id });
                          notify(fmt(t.set.model.use_toast, { provider: PROVIDER_NAME[id] }), { type: "success" });
                        }}
                      >
                        {t.set.model.use}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" disabled={p.locked} onClick={() => setRemoving(id)}>
                      {t.set.model.remove}
                    </Button>
                  </>
                )}
              </div>
              {tested[id] && <p className="text-2xs text-text-muted" aria-live="polite">{tested[id]}</p>}
            </div>
          </Row>
        );
      })}
      <ExploreRow active={active !== "planner"} />
      <Row label={t.set.model.planner.split(" · ")[0]!}>
        <p className="text-[13px] text-text-muted">{t.set.model.planner}</p>
        {active !== "planner" && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={async () => {
              await call("set_model_provider", { provider: "planner" });
              notify(fmt(t.set.model.use_toast, { provider: t.shell.status.planner }), { type: "success" });
            }}
          >
            {t.set.model.use}
          </Button>
        )}
      </Row>
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{removing ? fmt(t.set.model.remove_dialog.title, { provider: PROVIDER_NAME[removing] }) : ""}</DialogTitle>
            <DialogDescription>{t.set.model.remove_dialog.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={async () => {
                if (!removing) return;
                await call("remove_model_key", { provider: removing });
                notify(fmt(t.set.model.removed_toast, { provider: PROVIDER_NAME[removing] }));
                setRemoving(null);
              }}
            >
              {t.set.model.remove_dialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Exploratory answers: on by default once a model is set; disabled, with the reason, while only the planner answers. */
function ExploreRow({ active }: { active: boolean }) {
  const t = useT();
  const call = useCall();
  const { data } = useAppState();
  const on = active && data?.preferences.exploratory !== "off";
  const x = t.set.model.explore;
  return (
    <Row label={<label htmlFor="explore-switch">{x.label}</label>} hint={active ? x.hint : x.disabled}>
      <div className="flex flex-col gap-3">
        <span className="flex items-center gap-2">
          <Switch
            id="explore-switch"
            checked={on}
            disabled={!active}
            aria-describedby="explore-reason"
            onCheckedChange={async (v) => {
              await call("set_preference", { key: "exploratory", value: v ? "on" : "off" });
              notify(v ? x.on : x.off, { type: "success" });
            }}
          />
          <span id="explore-reason" className="text-[13px] text-text-muted">
            {active ? (on ? x.on : x.off) : x.disabled}
          </span>
        </span>
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-2xs text-text-muted">
          {x.safety.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </Row>
  );
}

function ChatSection({ client }: { client: ChatClient }) {
  const t = useT();
  const f = useFormat();
  const navigate = useNavigate();
  const lang = useLang();
  const { data: setup } = useChatSetup(client);
  const { data: calls } = useChatCalls();
  const name = t.set.chat.tab[client];
  const steps = client === "claude-desktop" ? t.set.chat.claude_desktop : client === "cursor" ? t.set.chat.cursor : { ...t.set.chat.command, step3: fmt(t.set.chat.command.step3, { client: name }) };
  const question = lang === "tr" ? "Son 14 günde GA4 satın almaları siparişlerle tutuyor mu?" : "Do GA4 purchases match orders in the last 14 days?";
  const last = calls?.[0];
  const toolWords = (c: ChatAppCall) => {
    const words = t.set.chat.tools;
    if (c.tool === "reconcile") return fmt(words.reconcile, { check: c.check ? CHECK_PLATFORM[c.check] : "GA4" });
    return c.tool in words ? words[c.tool as keyof typeof words] : words.other;
  };
  return (
    <Card id="chat-apps" title={t.set.nav["chat-apps"]} lead={t.set.chat.lead}>
      <div className="px-4 py-3">
        <p className="text-[13px] text-text-muted">{t.set.chat.what}</p>
        <div role="tablist" aria-label={t.set.chat.tabs_label} className="mt-3 flex gap-1 overflow-x-auto border-b border-border scrollbar-none">
          {CLIENTS.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={c === client}
              tabIndex={c === client ? 0 : -1}
              onClick={() => navigate(`/settings/chat-apps/${c}`, { replace: true })}
              onKeyDown={(e) => {
                const i = CLIENTS.indexOf(client);
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const n = CLIENTS[(i + (e.key === "ArrowRight" ? 1 : CLIENTS.length - 1)) % CLIENTS.length]!;
                  navigate(`/settings/chat-apps/${n}`, { replace: true });
                }
              }}
              className={cn("-mb-px h-9 shrink-0 border-b-2 px-3 text-sm font-medium whitespace-nowrap outline-offset-[-2px]", c === client ? "border-accent text-text-strong" : "border-transparent text-text-muted hover:text-text")}
            >
              {t.set.chat.tab[c]}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={name} className="mt-4 flex flex-col gap-4">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-text">
            <li>{steps.step1}</li>
            <li>{steps.step2}</li>
            <li>{steps.step3}</li>
          </ol>
          {setup ? (
            <div className="flex flex-col gap-2">
              <CodeBlock code={setup.snippet} language={setup.kind === "config" ? "json" : "shell"} wrap={setup.kind === "command"} copy={false} />
              <div>
                <CopyButton text={setup.snippet} label={setup.kind === "config" ? t.set.chat.copy_config : t.set.chat.copy_command} showLabel />
              </div>
            </div>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
          {setup?.config_path && (
            <div className="text-[13px]">
              <p className="text-2xs font-medium text-text-muted">{t.set.chat.config_file}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-2xs text-text-muted">{t.set.chat.config_mac}</span>
                <code className="rounded-sm bg-well px-1.5 py-0.5 font-mono text-2xs text-text">{setup.config_path.mac}</code>
                <CopyButton text={setup.config_path.mac} label={t.set.chat.copy_path} />
              </p>
              {setup.config_path.windows && (
                <p className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-2xs text-text-muted">{t.set.chat.config_windows}</span>
                  <code className="rounded-sm bg-well px-1.5 py-0.5 font-mono text-2xs text-text">{setup.config_path.windows}</code>
                  <CopyButton text={setup.config_path.windows} label={t.set.chat.copy_path} />
                </p>
              )}
            </div>
          )}
          <div className="text-[13px]">
            <p className="text-text-muted">{fmt(t.set.chat.try, { client: name })}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-text">{question}</span>
              <CopyButton text={question} label={t.common.copy} />
            </p>
          </div>
          <div className="rounded-md bg-surface-2 px-3 py-2 text-[13px]" aria-live="polite">
            {last ? (
              <>
                <p className="text-text">{fmt(t.set.chat.status_last, { client: last.client, time: f.time(last.at), tool: toolWords(last) })}</p>
                {calls!.length > 1 && (
                  <>
                    <p className="mt-2 text-2xs font-medium text-text-muted">{t.set.chat.recent}</p>
                    <ul className="mt-1 flex flex-col gap-0.5 font-mono text-2xs text-text-muted">
                      {calls!.map((c, i) => (
                        <li key={i}>
                          {f.time(c.at)} · {c.client} · {toolWords(c)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            ) : (
              <p className="text-text-muted">{t.set.chat.status_none}</p>
            )}
          </div>
          <p className="text-2xs text-text-muted">{t.set.chat.note}</p>
        </div>
      </div>
    </Card>
  );
}

function LanguageSection() {
  const t = useT();
  const lang = useLang();
  const [, setLangPref] = usePref("lang");
  const { pref, setPref } = useTheme();
  return (
    <Card id="language" title={t.set.nav.language} lead={t.set.lang.hint} scope="browser">
      <Row label={t.set.lang.language}>
        <SegmentedControl label={t.set.lang.language} size="md" value={lang} onChange={(v) => setLangPref(v)} options={LANGS.map((l) => ({ value: l, label: l === "en" ? t.set.lang.english : t.set.lang.turkish }))} />
      </Row>
      <Row label={t.set.theme.label} hint={t.set.theme.hint}>
        <SegmentedControl<ThemePref>
          label={t.set.theme.label}
          size="md"
          value={pref}
          onChange={setPref}
          options={[
            { value: "system", label: t.shell.themes.system },
            { value: "dark", label: t.shell.themes.dark },
            { value: "light", label: t.shell.themes.light },
          ]}
        />
      </Row>
    </Card>
  );
}

const mailto = (to: string, subject: string) => `mailto:${to}?subject=${encodeURIComponent(subject)}`;

function HelpSection({ s }: { s: Settings }) {
  const t = useT();
  const call = useCall();
  return (
    <Card id="help" title={t.set.nav.help} lead={t.help.mit}>
      <div className="flex flex-col gap-3 px-4 py-3 text-sm text-text">
        <p className="max-w-[72ch]">{t.help.cloud}</p>
        <p className="max-w-[72ch]">{t.help.help}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" render={<a href={mailto(s.help.email, t.help.subject_cloud)} />} nativeButton={false}>
            <MailIcon strokeWidth={1.75} data-icon="inline-start" />
            {t.help.button_cloud}
            <span className="sr-only">{t.common.opens_email}</span>
          </Button>
          <Button variant="outline" size="sm" render={<a href={mailto(s.help.email, t.help.subject_help)} />} nativeButton={false}>
            <MailIcon strokeWidth={1.75} data-icon="inline-start" />
            {t.help.button_help}
            <span className="sr-only">{t.common.opens_email}</span>
          </Button>
        </div>
        <p className="text-2xs text-text-muted">{fmt(t.help.meta, { address: s.help.email })}</p>
        {s.preferences.make_it_yours === "hidden" && (
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await call("set_preference", { key: "make_it_yours", value: "shown" });
                notify(t.help.card_shown, { type: "success" });
              }}
            >
              {t.help.show_card}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function AboutSection({ s }: { s: Settings }) {
  const t = useT();
  const rows: [string, string][] = [
    [t.about.address, s.server.address],
    [t.about.data, s.server.data_dir],
    [t.about.config, s.server.config_file],
    [t.about.pack, s.server.pack_dir],
  ];
  const keys: [string, string][] = [
    ["⌘K / Ctrl K", t.about.keys.ask],
    ["/", t.about.keys.slash],
    ["Enter", t.about.keys.enter],
    ["Esc", t.about.keys.esc],
    ["⌘Z / Ctrl Z", t.about.keys.undo],
  ];
  return (
    <Card id="about" title={t.set.nav.about} lead={t.about.privacy}>
      <div className="flex flex-col gap-4 px-4 py-3 text-[13px]">
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-text">
          <span className="font-mono">{fmt(t.about.version, { v: s.server.version })}</span>
          <a href="https://github.com/analitikisler/ai-analyst" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
            {t.about.licence}
            <ExternalLinkIcon size={14} strokeWidth={1.75} aria-hidden />
            <span className="sr-only">{t.common.opens_tab}</span>
          </a>
        </p>
        <div>
          <h3 className="text-2xs font-medium text-text-muted">{t.about.this_copy}</h3>
          <dl className="mt-1 flex flex-col divide-y divide-border">
            {rows.map(([k, v]) => (
              <div key={k} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <dt className="w-32 text-text-muted">{k}</dt>
                <dd className="flex min-w-0 flex-1 items-center gap-2">
                  <code className="min-w-0 truncate font-mono text-2xs text-text">{v}</code>
                  <CopyButton text={v} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h3 className="text-2xs font-medium text-text-muted">{t.about.keyboard}</h3>
          <dl className="mt-1 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            {keys.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-2xs text-text">{k}</dt>
                <dd className="text-text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-text">
          {t.about.contact}:{" "}
          <a href="mailto:hello@analitikisler.com" className="font-medium text-accent hover:underline">
            hello@analitikisler.com
          </a>
        </p>
      </div>
    </Card>
  );
}

const CURRENCIES = ["TRY", "USD", "EUR", "GBP"];
const OTHER = "other";

/** The workspace currency: the four common ones, or any valid ISO 4217 code typed in. */
function CurrencyPicker({ value, locked }: { value: string; locked: boolean }) {
  const t = useT();
  const call = useCall();
  const [other, setOther] = useState(!CURRENCIES.includes(value));
  const [code, setCode] = useState(CURRENCIES.includes(value) ? "" : value);
  const save = async (next: string) => {
    try {
      await call("set_currency", { currency: next });
      notify(t.set.data.currency_saved, { type: "success" });
    } catch (err) {
      notify(describeError(t, err), { type: "error" });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        size="sm"
        disabled={locked}
        value={other ? OTHER : value}
        onChange={(e) => {
          if (e.target.value === OTHER) return setOther(true);
          setOther(false);
          void save(e.target.value);
        }}
        className="w-36"
        aria-label={t.set.data.currency}
      >
        {CURRENCIES.map((c) => (
          <NativeSelectOption key={c} value={c}>
            {c}
          </NativeSelectOption>
        ))}
        <NativeSelectOption value={OTHER}>{t.set.data.currency_other}</NativeSelectOption>
      </NativeSelect>
      {other && !locked && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const c = code.trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(c)) {
              notify(t.set.data.currency_invalid, { type: "error" });
              return;
            }
            void save(c);
          }}
        >
          <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={3} placeholder={t.set.data.currency_placeholder} aria-label={t.set.data.currency_code} className="h-8 w-20 uppercase" />
          <Button type="submit" variant="outline" size="sm">
            {t.set.data.currency_set}
          </Button>
        </form>
      )}
    </div>
  );
}
