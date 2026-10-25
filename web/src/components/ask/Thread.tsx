// One turn of the chat (owner round 3, on shadcn's chat primitives): the person's question right-aligned in a
// filled bubble; the reply unboxed at full column width, with the agent steps folded above it like a tool-use row
// ("Checked 2 sources · 3 steps", the live step shimmering while it runs), then the answer, the refusal or the
// approval, the message actions, and the follow-up chips after the last reply only.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRightIcon, ListChecksIcon, RotateCcwIcon } from "lucide-react";
import { useAppState, useCall } from "@/api/queries";
import type { Answer, Proposal, Refusal, Step, Text, Turn } from "@/api/types";
import type { LiveTurn } from "@/ask/AskStore";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Disclosure } from "@/components/kit";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Message, MessageContent } from "@/components/ui/message";
import { MessageScrollerItem } from "@/components/ui/message-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { fmt, plural, useBilingual, useLang, useT } from "@/i18n";
import { bytesCapSentence } from "@/lib/errors";
import { useFormat } from "@/lib/format";
import { notify } from "@/lib/notify";
import { AnswerCard, MessageActions } from "./AnswerCard";
import { ModelText } from "./ModelText";

export interface ThreadActions {
  onAsk: (question: string) => void;
  onNewDashboard?: (answerId: string) => void;
  narrow?: boolean;
}

export function UserMessage({ text, context }: { text: string; context?: Text | null }) {
  const t = useT();
  const pick = useBilingual();
  return (
    <Message align="end">
      <MessageContent className="items-end gap-1">
        {context && <p className="text-2xs text-text-muted">{fmt(t.ask.context_chip, { name: pick(context) })}</p>}
        <Bubble variant="muted" align="end">
          <BubbleContent className="rounded-lg px-3.5 py-2.5 text-[15px] leading-[22px] text-text-strong">{text}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

/** The agent's steps as one folded row above the reply (shadcn Trace; the AI Elements chain-of-thought pattern). */
export function StepsTrace({ steps, seconds, running, sources }: { steps: Step[]; seconds: number; running?: boolean; sources: number }) {
  const t = useT();
  const lang = useLang();
  const f = useFormat();
  const pick = useBilingual();
  if (running) {
    const last = steps[steps.length - 1];
    return (
      <Trace aria-live="polite">
        <TraceLine status="running">
          <TraceIcon>
            <Spinner className="size-3.5" />
          </TraceIcon>
          <TraceTitle>{last ? pick(last.summary) : t.ask.trace.reading}</TraceTitle>
          <TraceDescription>{fmt(t.ask.steps.running, { n: Math.max(1, steps.length + 1) })}</TraceDescription>
        </TraceLine>
      </Trace>
    );
  }
  if (!steps.length) return null;
  const stepsText = plural(lang, steps.length, t.ask.trace.steps, { n: steps.length });
  const title = sources > 0 ? fmt(t.ask.trace.checked, { sources: plural(lang, sources, t.ask.trace.sources, { n: sources }), steps: stepsText }) : stepsText;
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <ListChecksIcon strokeWidth={1.75} />
            </TraceIcon>
            <TraceTitle>{title}</TraceTitle>
            <TraceDescription>{f.dec(seconds, 1)} {lang === "tr" ? "sn" : "s"}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <ol className="flex flex-col gap-1.5 text-[13px] leading-[18px] text-text">
            {steps.map((s, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                <span>{pick(s.summary)}</span>
                <code className="rounded-sm bg-well px-1 font-mono text-2xs text-text-muted">{s.tool}</code>
              </li>
            ))}
          </ol>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** Follow-up chips after the last reply (AI Elements Suggestion), at most 3. */
export function FollowUps({ items, onAsk }: { items: Text[]; onAsk: (q: string) => void }) {
  const t = useT();
  const pick = useBilingual();
  if (!items.length) return null;
  return (
    <nav aria-label={t.ask.followups} className="min-w-0">
      <Suggestions wrap className="max-sm:flex-col max-sm:items-stretch">
        {items.slice(0, 3).map((q) => (
          <Suggestion key={q.en} suggestion={pick(q)} onClick={onAsk} className="max-sm:justify-start" />
        ))}
      </Suggestions>
    </nav>
  );
}

/** The planner cannot answer: said in prose, similar questions as chips, the ways to a full answer as links. */
export function RefusalMessage({ refusal: r, onAsk }: { refusal: Refusal; onAsk: (q: string) => void }) {
  const t = useT();
  const { data } = useAppState();
  const pick = useBilingual();
  const navigate = useNavigate();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-[15px] leading-6 font-semibold text-text-strong">{pick(r.heading)}</p>
      <p className="max-w-[68ch] text-[15px] leading-6 text-text">{pick(r.body)}</p>
      {r.nearest.length > 0 && (
        <>
          <p className="text-2xs font-medium text-text-muted">{t.ask.refusal.similar}</p>
          <Suggestions wrap className="max-sm:flex-col max-sm:items-stretch">
            {r.nearest.map((q) => (
              <Suggestion key={q.en} suggestion={pick(q)} onClick={onAsk} className="max-sm:justify-start" />
            ))}
          </Suggestions>
        </>
      )}
      {r.code === "metric_proposed" && r.metric_id && (
        <div className="-ml-2 flex flex-wrap gap-1">
          <Button variant="link" size="sm" render={<Link to={`/metrics/${r.metric_id}`} />} nativeButton={false}>
            {t.metrics.title} › {pick(r.heading).split(": ").slice(1).join(": ")}
            <ArrowRightIcon strokeWidth={1.75} data-icon="inline-end" />
          </Button>
        </div>
      )}
      {r.code === "metric_howto" && (
        <div className="-ml-2 flex flex-wrap gap-1">
          <Button variant="link" size="sm" render={<a href="https://github.com/analitikisler/ai-analyst/blob/main/docs/metrics.md" target="_blank" rel="noreferrer" />} nativeButton={false}>
            {t.ask.refusal.guide}
            <ArrowRightIcon strokeWidth={1.75} data-icon="inline-end" />
            <span className="sr-only">{t.common.opens_tab}</span>
          </Button>
          {data?.source.kind === "bigquery" && (
            <Button variant="link" size="sm" render={<a href={`mailto:hello@analitikisler.com?subject=${encodeURIComponent(t.help.subject_metric)}`} />} nativeButton={false}>
              {t.ask.refusal.email}
              <span className="sr-only">{t.common.opens_email}</span>
            </Button>
          )}
        </div>
      )}
      {r.code === "planner_unknown" && (
        <div className="flex flex-col gap-1">
          <p className="text-[13px] text-text-muted">{t.ask.refusal.routes}</p>
          <div className="-ml-2 flex flex-wrap gap-1">
            <Button variant="link" size="sm" onClick={() => navigate("/settings/model")}>
              {t.ask.refusal.add_model}
              <ArrowRightIcon strokeWidth={1.75} data-icon="inline-end" />
            </Button>
            <Button variant="link" size="sm" onClick={() => navigate("/settings/chat-apps/claude-desktop")}>
              {t.ask.refusal.chat_app}
              <ArrowRightIcon strokeWidth={1.75} data-icon="inline-end" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The agent wants to write: one plain sentence, Approve and Decline, nothing changes until it is approved. */
export function ApprovalCard({ proposal: p, where = "ask" }: { proposal: Proposal; where?: "ask" | "activity" }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const call = useCall();
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await call("decide_proposal", { proposal_id: p.id, approve, where });
    } catch {
      notify(t.err.invalid_input, { type: "error" });
    } finally {
      setBusy(false);
    }
  };
  if (p.status !== "pending") {
    return (
      <p tabIndex={-1} className="rounded-lg border border-border bg-surface px-4 py-3 text-[13px] leading-[18px] text-text-muted">
        {p.status === "approved" ? fmt(t.ask.approval.approved, { time: f.time(p.decided_at), what: pick(p.title) }) : t.ask.approval.declined}
        {p.decided_in === "activity" && where === "ask" ? ` · ${t.ask.approval.elsewhere}` : ""}
        {p.status === "approved" && p.kind === "watch" && p.payload.check && (
          <>
            {" · "}
            <Link to={`/dashboards?check=${p.payload.check}`} className="font-medium text-accent hover:underline">
              {t.ask.approval.open_check}
            </Link>
          </>
        )}
      </p>
    );
  }
  return (
    <article className="overflow-hidden rounded-lg border border-border-strong bg-surface">
      <p className="border-b border-border bg-primary-soft px-4 py-2 text-2xs font-medium text-accent-ink">{t.ask.approval.eyebrow}</p>
      <div className="p-4">
        <h3 className="text-sm font-semibold text-text-strong">{pick(p.title)}</h3>
        <p className="mt-1 max-w-[66ch] text-sm text-text">{pick(p.body)}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button size="sm" disabled={busy} onClick={() => void decide(true)}>
            {t.ask.approval.approve}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void decide(false)}>
            {t.ask.approval.decline}
          </Button>
        </div>
        <p className="mt-3 text-2xs text-text-subtle">{t.ask.approval.undo_note}</p>
      </div>
    </article>
  );
}


function AnswerSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-9 w-36" />
      <Skeleton className="h-4 w-full max-w-[60ch]" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

const sourcesOf = (answers: Answer[]) => new Set(answers.flatMap((a) => a.metrics.map((m) => m.source))).size;

/** The two rows of one turn, each its own MessageScrollerItem (the question anchors the scroll). */
export function TurnView({ turn, live, fresh, last, actions, contextName }: { turn: Turn | LiveTurn; live?: boolean; fresh?: boolean; last?: boolean; actions: ThreadActions; contextName?: Text | null }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const { data } = useAppState();
  const running = live && (turn as LiveTurn).status === "running";
  const answers: Answer[] = turn.answers;
  const proposalIds = live ? (turn as LiveTurn).proposals.map((p) => p.id) : (turn as Turn).approvals;
  const proposals = proposalIds.map((id) => data?.proposals.find((p) => p.id === id) ?? (live ? (turn as LiveTurn).proposals.find((p) => p.id === id) : undefined)).filter(Boolean) as Proposal[];
  const seconds = live ? (Date.now() - (turn as LiveTurn).startedAt) / 1000 : (turn as Turn).seconds;
  const status = live ? (turn as LiveTurn).status : (turn as Turn).status;
  const error = turn.error;
  const question = turn.question_text ? pick(turn.question_text) : turn.question;
  const key = live ? ((turn as LiveTurn).turnId ?? "live") : (turn as Turn).id;
  const followups = last && !running ? (answers[answers.length - 1]?.followups ?? []) : [];
  return (
    <>
      <MessageScrollerItem messageId={`${key}-q`} scrollAnchor>
        <UserMessage text={question} context={contextName} />
      </MessageScrollerItem>
      <MessageScrollerItem messageId={`${key}-a`}>
        <Message align="start" aria-busy={running || undefined}>
          <MessageContent className="gap-4">
            <StepsTrace steps={turn.steps} seconds={seconds} running={running} sources={sourcesOf(answers)} />
            {running && !answers.length && !turn.refusal && !proposals.length && !turn.text && <AnswerSkeleton />}
            {answers.map((a, i) => (
              <div key={a.id} id={`answer-${a.id}`} className="scroll-mt-20">
                <AnswerCard
                  answer={a}
                  fresh={fresh}
                  narrow={actions.narrow}
                  actions={
                    !running && (
                      <>
                        <MessageActions answer={a} question={question} always={last} onAsk={actions.onAsk} onNewDashboard={actions.onNewDashboard} />
                        {i === answers.length - 1 && followups.length > 0 && <FollowUps items={followups} onAsk={actions.onAsk} />}
                      </>
                    )
                  }
                />
              </div>
            ))}
            {turn.refusal && <RefusalMessage refusal={turn.refusal} onAsk={actions.onAsk} />}
            {proposals.map((p) => (
              <ApprovalCard key={p.id} proposal={p} />
            ))}
            {proposals.some((p) => p.status === "pending") && turn.text && <p className="text-[13px] text-text-muted">{pick(turn.text)}</p>}
            {turn.text && !proposals.length && !answers.some((a) => a.created_by === "planner") && (
              <ModelText text={pick(turn.text)} className={answers.length ? "flex max-w-[68ch] flex-col gap-2 text-[13px] leading-[18px] text-text-muted" : undefined} />
            )}
            {status === "stopped" && (
              <div className="flex flex-wrap items-center gap-3 text-[13px] text-text-muted">
                <span>{t.err.stopped}</span>
                <Button variant="outline" size="sm" onClick={() => actions.onAsk(question)}>
                  <RotateCcwIcon strokeWidth={1.75} data-icon="inline-start" />
                  {t.ask.again}
                </Button>
              </div>
            )}
            {status === "error" && error && error.code !== "stopped" && (
              <div role="alert" className="text-sm text-text">
                <p>{bytesCapSentence(t, f.bytes, error) ?? (error.code === "rate_limited" ? t.err.rate_limited : error.code === "network" ? t.err.network.body : error.code === "no_cloud" ? fmt(t.err.no_cloud, { service: String(("params" in error && error.params?.service) || "–") }) : t.err.agent_stop)}</p>
                <Disclosure label={t.common.details}>
                  <code className="font-mono text-2xs text-text-muted">{fmt(t.err.details, { code: error.code })}</code>
                </Disclosure>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => actions.onAsk(question)}>
                  {t.common.try_again}
                </Button>
              </div>
            )}
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    </>
  );
}

