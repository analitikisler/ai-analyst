// Ask as a chat (owner round 3; 09-ux.md S02 to S05). Empty: a centred greeting, the composer and the suggestion chips.
// With a conversation: the thread in one 760 px column (shadcn MessageScroller), the composer docked at the bottom,
// the conversations on the left from 1280 px grouped by day (a left sheet below, `?threads=1`).
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { cn } from "cn";
import { PanelLeftIcon, SquarePenIcon } from "lucide-react";
import { useAppState, useCall, useSuggestions } from "@/api/queries";
import type { ConversationSummary } from "@/api/types";
import { useAskStore } from "@/ask/AskStore";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Composer, type ComposerHandle } from "@/components/ask/Composer";
import { ConversationThread } from "@/components/ask/Conversation";
import { TopBarContent, usePhoneTitle } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt, useBilingual, useT } from "@/i18n";
import { useFormat } from "@/lib/format";
import { usePref } from "@/lib/prefs";
import { usePin } from "@/ask/hooks";

/** Conversations grouped by Today, Yesterday and Earlier, newest first. */
function ConversationList({ items, current, onPick }: { items: ConversationSummary[]; current?: string; onPick?: () => void }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  if (!items.length) return <p className="px-2 text-[13px] text-text-muted">{t.ask.threads_empty}</p>;
  const today = f.localDay(new Date());
  const yesterday = f.localDay(new Date(Date.now() - 86400000));
  const groupOf = (c: ConversationSummary) => {
    const d = f.localDay(new Date(c.updated_at));
    return d === today ? "today" : d === yesterday ? "yesterday" : "earlier";
  };
  return (
    <div className="flex flex-col gap-4">
      {(["today", "yesterday", "earlier"] as const).map((g) => {
        const list = items.filter((c) => groupOf(c) === g);
        if (!list.length) return null;
        return (
          <section key={g} aria-label={t.ask.groups[g]}>
            <h3 className="mb-1 px-2 text-2xs font-medium text-text-subtle">{t.ask.groups[g]}</h3>
            <ul className="flex flex-col gap-px">
              {list.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/ask/${c.id}`}
                    onClick={onPick}
                    aria-current={c.id === current ? "page" : undefined}
                    title={c.title_text ? pick(c.title_text) : c.title}
                    className={cn("block truncate rounded-md px-2 py-1.5 text-[13px] leading-[18px] outline-offset-[-2px]", c.id === current ? "bg-primary-soft font-medium text-accent-ink" : "text-text hover:bg-surface-2")}
                  >
                    {c.title_text ? pick(c.title_text) : c.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default function AskPage() {
  const t = useT();
  const pick = useBilingual();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const [params, setParams] = useSearchParams();
  const { data } = useAppState();
  const { ask, stop, running } = useAskStore();
  const [collapsed, setCollapsed] = usePref("askColumnCollapsed");
  const composer = useRef<ComposerHandle>(null);
  const [newDashFor, setNewDashFor] = useState<string | null>(null);
  const conversations = data?.conversations ?? [];
  const current = conversations.find((c) => c.id === conversationId);
  const currentTitle = current ? (current.title_text ? pick(current.title_text) : current.title) : null;
  usePhoneTitle(currentTitle ?? t.ask.title);
  useEffect(() => {
    document.title = fmt(t.app.pageTitle, { page: currentTitle ?? t.ask.title });
  }, [currentTitle, t]);

  const send = async (question: string) => {
    const id = await ask(question, { conversationId: conversationId ?? "new" });
    if (id !== conversationId) navigate(`/ask/${id}`, { replace: !conversationId });
  };

  // A question passed in the link (the review menu, "Ask again") is sent once.
  const sent = useRef<string | null>(null);
  useEffect(() => {
    const q = params.get("q");
    if (q && sent.current !== q && !running) {
      sent.current = q;
      const next = new URLSearchParams(params);
      next.delete("q");
      setParams(next, { replace: true });
      void (async () => {
        const id = await ask(q, { conversationId: "new" });
        navigate(`/ask/${id}`, { replace: true });
      })();
    }
  }, [params, setParams, ask, navigate, running]);

  const showThreads = params.get("threads") === "1";
  const setThreads = (open: boolean) => {
    const next = new URLSearchParams(params);
    if (open) next.set("threads", "1");
    else next.delete("threads");
    setParams(next);
  };
  const hasThreads = conversations.length > 0;

  const header = (
    <>
      {hasThreads && (
        <Button
          variant="ghost"
          size="icon"
          className="hidden xl:inline-flex"
          aria-label={collapsed ? t.ask.threads_show : t.ask.threads_hide}
          title={collapsed ? t.ask.threads_show : t.ask.threads_hide}
          aria-pressed={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <PanelLeftIcon strokeWidth={1.75} />
        </Button>
      )}
      {hasThreads && (
        <Button variant="ghost" size="icon" className="xl:hidden" aria-label={t.ask.threads_show} onClick={() => setThreads(true)}>
          <PanelLeftIcon strokeWidth={1.75} />
        </Button>
      )}
      <span className="min-w-0 truncate text-sm font-medium text-text">{currentTitle ?? ""}</span>
      {conversationId && (
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => navigate("/ask")}>
          <SquarePenIcon strokeWidth={1.75} data-icon="inline-start" />
          {t.ask.new}
        </Button>
      )}
    </>
  );
  // Phones: the conversations toggle and New question are icon buttons in the top bar, with no second row.
  const phoneActions = (
    <>
      {hasThreads && (
        <Button variant="ghost" size="icon" className="size-10" aria-label={t.ask.threads_show} title={t.ask.threads_show} onClick={() => setThreads(true)}>
          <PanelLeftIcon strokeWidth={1.75} />
        </Button>
      )}
      {conversationId && (
        <Button variant="ghost" size="icon" className="size-10" aria-label={t.ask.new} title={t.ask.new} onClick={() => navigate("/ask")}>
          <SquarePenIcon strokeWidth={1.75} />
        </Button>
      )}
    </>
  );

  const newChat = (onDone?: () => void) => (
    <Button variant="outline" size="sm" className="mb-4 w-full justify-start" onClick={() => { onDone?.(); navigate("/ask"); }}>
      <SquarePenIcon strokeWidth={1.75} data-icon="inline-start" />
      {t.ask.new}
    </Button>
  );
  return (
    <div className="-mx-4 -my-4 flex h-[calc(100dvh-3rem-1px)] min-h-0 md:-mx-6 md:-my-6 lg:h-[calc(100dvh-3.5rem-1px)] xl:-my-8">
      <TopBarContent phoneActions={hasThreads || conversationId ? phoneActions : null}>{header}</TopBarContent>
      {hasThreads && !collapsed && (
        <aside aria-label={t.ask.threads} className="hidden w-[248px] shrink-0 overflow-y-auto border-r border-border bg-bg px-3 py-4 xl:block">
          {newChat()}
          <ConversationList items={conversations} current={conversationId} />
        </aside>
      )}
      <Sheet open={showThreads} onOpenChange={setThreads}>
        <SheetContent side="left" className="w-[280px] gap-0 p-0 data-[side=left]:w-[280px]">
          <SheetTitle className="px-4 pt-4 pb-2 text-base font-semibold">{t.ask.threads}</SheetTitle>
          <div className="overflow-y-auto px-3 pb-4">
            {newChat(() => setThreads(false))}
            <ConversationList items={conversations} current={conversationId} onPick={() => setThreads(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {conversationId ? (
          <>
            <h1 className="sr-only">{currentTitle ?? t.ask.title}</h1>
            <ConversationThread
              conversationId={conversationId}
              actions={{ onAsk: (q) => void send(q), onNewDashboard: setNewDashFor }}
              footer={
                <div className="mx-auto w-full max-w-[760px] shrink-0 px-4 pb-3 md:px-6 md:pb-4">
                  <Composer ref={composer} draftKey={conversationId} running={running} onStop={() => void stop()} onSubmit={(q) => void send(q)} escStops />
                </div>
              }
            />
          </>
        ) : (
          <EmptyAsk onAsk={(q) => void send(q)} running={running} onStop={() => void stop()} composerRef={composer} workspace={data?.workspace.name ?? ""} />
        )}
      </div>
      <NewDashboardDialog answerId={newDashFor} onClose={() => setNewDashFor(null)} />
    </div>
  );
}

/** The empty chat: a centred greeting, the composer under it, the suggestions as chips under the composer. The
 *  GA4 chip is first and carries its reason as a small second line. Nothing else. */
function EmptyAsk({ onAsk, running, onStop, composerRef, workspace }: { onAsk: (q: string) => void; running: boolean; onStop: () => void; composerRef: React.RefObject<ComposerHandle | null>; workspace: string }) {
  const t = useT();
  const pick = useBilingual();
  const { data: suggestions, isLoading, isError, refetch } = useSuggestions();
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-center overflow-y-auto px-4 py-8 md:px-6">
      <h1 className="text-center font-display text-2xl leading-8 font-heading tracking-[-0.012em] text-text-strong sm:text-[28px] sm:leading-[34px]">{fmt(t.ask.empty.heading, { workspace })}</h1>
      <Composer ref={composerRef} className="mt-6" draftKey="new" running={running} onStop={onStop} onSubmit={onAsk} escStops modelLine={false} />
      <section aria-label={t.ask.suggest.label} className="mt-4">
        {isError ? (
          <p className="flex flex-wrap items-center justify-center gap-3 text-[13px] text-text-muted">
            {t.err.suggestions}
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {t.common.try_again}
            </Button>
          </p>
        ) : isLoading || !suggestions ? (
          <div className="flex flex-wrap justify-center gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-48 rounded-md" />
            ))}
          </div>
        ) : (
          <Suggestions wrap className="justify-center">
            {suggestions.map((s, i) => (
              <Suggestion key={s.text.en} suggestion={pick(s.text)} onClick={onAsk} disabled={running} hint={i === 0 ? t.ask.empty.first_hint : s.tag === "exploratory" ? t.ask.explore.badge : undefined} className={i === 0 ? "border-border-strong" : undefined} />
            ))}
          </Suggestions>
        )}
      </section>
    </div>
  );
}

/** "New dashboard" from the Pin menu: creates it, then pins there (09-ux.md F4 alt). */
export function NewDashboardDialog({ answerId, onClose, onCreated }: { answerId: string | null; onClose: () => void; onCreated?: (id: string) => void }) {
  const t = useT();
  const call = useCall();
  const pin = usePin();
  const [name, setName] = useState("");
  const open = answerId !== null;
  useEffect(() => {
    if (open) setName(t.dash.new_dialog.default);
  }, [open, t.dash.new_dialog.default]);
  const create = async () => {
    const d = await call("create_dashboard", { name });
    if (answerId) await pin(answerId, d.id);
    onCreated?.(d.id);
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.dash.new_dialog.title}</DialogTitle>
          <DialogDescription>{t.dash.new_dialog.hint}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void create();
          }}
          className="flex flex-col gap-1.5"
        >
          <label htmlFor="new-dash-name" className="text-2xs font-medium text-text-muted">
            {t.dash.rename.label}
          </label>
          <Input id="new-dash-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <DialogFooter className="mt-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {t.dash.new_dialog.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
