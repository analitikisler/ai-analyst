// "Ask about this" (09-ux.md S06): the agent in a right sheet on any page but Ask, closed by default. The URL
// carries it: `?ask=new&about=check:ga4_vs_orders` opens a new conversation with a context chip; once the turn
// starts the param becomes the conversation id. A passed question (`q`) is sent at once. Closing the sheet does
// not stop the answer (the stream lives in AskStore).
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { Maximize2Icon, XIcon } from "lucide-react";
import { useAppState } from "@/api/queries";
import type { AskContext, CheckId, Text } from "@/api/types";
import { useAskStore } from "@/ask/AskStore";
import { CHECK_LABELS } from "@/ask/labels";
import { METRIC_LABELS } from "@/components/dashboard/metricLabels";
import { Composer, type ComposerHandle } from "@/components/ask/Composer";
import { ConversationThread } from "@/components/ask/Conversation";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useBilingual, useT } from "@/i18n";

export function contextFrom(about: string | null, dashboards: { id: string; name: Text }[] | undefined, tiles?: Record<string, Text>): AskContext | null {
  if (!about) return null;
  const [kind, id] = about.split(":") as [AskContext["kind"], string];
  if (kind === "check" && id in CHECK_LABELS) return { view: "check", kind, id, name: CHECK_LABELS[id as CheckId] };
  if (kind === "dashboard") {
    const d = dashboards?.find((x) => x.id === id);
    return { view: "dashboard", kind, id, name: d?.name ?? { en: id, tr: id } };
  }
  if (kind === "tile") return { view: "dashboard", kind, id, name: tiles?.[id] ?? { en: id, tr: id } };
  if (kind === "metric") return { view: "metric", kind, id, name: METRIC_LABELS[id as keyof typeof METRIC_LABELS] ?? { en: id, tr: id } };
  return null;
}

/** Tile titles known to the page, so the sheet can name a tile context. */
export const tileNames: Record<string, Text> = {};

export function AskSheet() {
  const t = useT();
  const pick = useBilingual();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data } = useAppState();
  const { ask, stop, running } = useAskStore();
  const param = params.get("ask");
  const open = !!param && !pathname.startsWith("/ask");
  const [context, setContext] = useState<AskContext | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const sentFor = useRef<string | null>(null);
  const conversationId = param && param !== "new" ? param : null;

  useEffect(() => {
    if (open && param === "new") setContext(contextFrom(params.get("about"), data?.dashboards, tileNames));
  }, [open, param, params, data?.dashboards]);

  // Opening moves focus to the sheet's composer (09-ux.md §5.2), unless a question was passed and is being sent.
  useEffect(() => {
    if (!open || params.get("q")) return;
    const timer = setTimeout(() => composer.current?.focus(), 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const send = async (question: string) => {
    const conv = await ask(question, { conversationId: conversationId ?? "new", context: conversationId ? null : context });
    const next = new URLSearchParams(params);
    next.set("ask", conv);
    next.delete("q");
    setParams(next, { replace: true });
  };

  // A question passed with the link (Ask why, Ask about this tile) is sent at once.
  useEffect(() => {
    const q = params.get("q");
    if (open && q && param === "new" && sentFor.current !== q && context) {
      sentFor.current = q;
      void send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, param, context]);

  const close = () => {
    const next = new URLSearchParams(params);
    ["ask", "about", "q"].forEach((k) => next.delete(k));
    setParams(next);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <SheetTitle className="flex-1 text-base font-semibold text-text-strong">{t.sheet.title}</SheetTitle>
          <SheetDescription className="sr-only">{context?.name ? pick(context.name) : t.sheet.title}</SheetDescription>
          <Button variant="ghost" size="icon" aria-label={t.sheet.full_page} title={t.sheet.full_page} disabled={!conversationId} onClick={() => conversationId && navigate(`/ask/${conversationId}`)}>
            <Maximize2Icon strokeWidth={1.75} />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t.sheet.close} title={t.sheet.close} onClick={close}>
            <XIcon strokeWidth={1.75} />
          </Button>
        </div>
        <ConversationThread
          conversationId={conversationId}
          actions={{ onAsk: (q) => void send(q), narrow: true }}
          contentClassName="px-4 md:px-4"
          footer={
            <div className="shrink-0 px-4 pb-4">
              <Composer
                ref={composer}
                draftKey={`sheet-${conversationId ?? "new"}`}
                running={running}
                onStop={() => void stop()}
                onSubmit={(q) => void send(q)}
                context={!conversationId && context?.name ? pick(context.name) : null}
                onRemoveContext={() => setContext(null)}
              />
            </div>
          }
        />
      </SheetContent>
    </Sheet>
  );
}
