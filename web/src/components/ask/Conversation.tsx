// The chat thread, used by the full Ask page and the Ask sheet: stored turns from get_conversation, then the live
// turn while it streams. shadcn MessageScroller owns the scrolling: it follows the reply while it streams, lets go
// the moment the person scrolls up, anchors each question, and shows "Scroll to the latest" when away from the end.
// A new answer does not take focus; it is announced in the UI language (09-ux.md §5.4).
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "cn";
import { MessageSquareOffIcon } from "lucide-react";
import { useConversation } from "@/api/queries";
import type { Answer, Text } from "@/api/types";
import { useAskStore } from "@/ask/AskStore";
import { EmptyState } from "@/components/kit";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt, useBilingual, useT } from "@/i18n";
import { TurnView, type ThreadActions } from "./Thread";

export function ConversationThread({ conversationId, actions, onNotFound, footer, className, contentClassName }: { conversationId: string | null; actions: ThreadActions; onNotFound?: () => void; footer?: ReactNode; className?: string; contentClassName?: string }) {
  const t = useT();
  const pick = useBilingual();
  const { live, announced } = useAskStore();
  const { data, isLoading, error } = useConversation(conversationId ?? undefined);
  const liveHere = live && (live.conversationId === conversationId || (!live.conversationId && !conversationId) || (live.conversationId && !data));
  const freshIds = useRef(new Set<string>());
  if (liveHere && live?.turnId) freshIds.current.add(live.turnId);
  const turns = data?.turn_list.filter((tt) => !(liveHere && tt.id === live?.turnId)) ?? [];

  if (conversationId && error) {
    onNotFound?.();
    return <EmptyState icon={MessageSquareOffIcon} title={t.nf.conversation} />;
  }
  const contextName = (c: unknown): Text | null => ((c as { name?: Text } | null)?.name ? (c as { name: Text }).name : null);
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
      <MessageScroller className={cn("min-h-0 flex-1", className)}>
        <MessageScrollerViewport>
          <MessageScrollerContent className={cn("mx-auto w-full max-w-[760px] gap-6 px-4 pt-6 pb-10 md:px-6", contentClassName)}>
            {conversationId && isLoading && !liveHere ? (
              <div className="flex flex-col gap-4" aria-busy>
                <Skeleton className="ml-auto h-10 w-2/3 rounded-lg" />
                <Skeleton className="h-64 w-full rounded-lg" />
              </div>
            ) : (
              <>
                {turns.map((turn, i) => (
                  <TurnView key={turn.id} turn={turn} actions={actions} fresh={freshIds.current.has(turn.id)} last={!liveHere && i === turns.length - 1} contextName={contextName(turn.context)} />
                ))}
                {liveHere && live && <TurnView key={live.turnId ?? "live"} turn={live} live fresh last actions={actions} contextName={contextName(live.context)} />}
              </>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
        <p className="sr-only" aria-live="polite">
          {announced ? liveText(announced, pick(announced.sentence), announced.check ? t.ask.verdict[announced.check.verdict] : null, t.ask.live.answer) : ""}
        </p>
        {liveHere && live?.answers[0] && <LiveAnnounce answer={live.answers[0]} />}
      </MessageScroller>
      {footer}
    </MessageScrollerProvider>
  );
}

const capitalise = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);
/** "Does not add up. Yes. On mobile…", without saying the verdict twice when the sentence starts with it. */
function liveText(a: Answer, sentence: string, verdict: string | null, template: string) {
  if (!a.check || !verdict || sentence.toLocaleLowerCase().startsWith(verdict.toLocaleLowerCase())) return sentence;
  return fmt(template, { verdict: capitalise(verdict), sentence });
}

function LiveAnnounce({ answer }: { answer: Answer }) {
  const { setAnnounced } = useAskStore();
  useEffect(() => setAnnounced(answer), [answer, setAnnounced]);
  return null;
}
