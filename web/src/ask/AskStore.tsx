// The answer stream lives at app level (09-ux.md S06): closing the Ask sheet or leaving the page does not stop an
// answer; the sidebar's Ask item shows a square while one runs. The stored conversation (get_conversation) is the
// truth once a turn is done; while it streams, the live copy here is drawn after the stored turns.
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/api";
import type { Answer, AskContext, AskEvent, Proposal, Refusal, Step, Text, Turn } from "@/api/types";
import { useLang } from "@/i18n";

export interface LiveTurn {
  turnId: string | null;
  conversationId: string | null;
  question: string;
  question_text: Text | null;
  context: AskContext | null;
  steps: Step[];
  answers: Answer[];
  proposals: Proposal[];
  refusal: Refusal | null;
  text: Text | null;
  error: { code: string; message?: string } | null;
  status: Turn["status"];
  startedAt: number;
}

interface AskValue {
  live: LiveTurn | null;
  running: boolean;
  /** Starts a turn; resolves with the conversation id once the server has created it. */
  ask: (question: string, opts?: { conversationId?: string | "new"; context?: AskContext | null }) => Promise<string>;
  stop: () => Promise<void>;
  /** The last answer that arrived, for the polite live region (5.4); its text is built in the UI language. */
  announced: Answer | null;
  setAnnounced: (a: Answer | null) => void;
}

const Ctx = createContext<AskValue | null>(null);

export function AskProvider({ children }: { children: ReactNode }) {
  const lang = useLang();
  const qc = useQueryClient();
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [announced, setAnnounced] = useState<Answer | null>(null);
  const handle = useRef<ReturnType<typeof api.ask> | null>(null);

  const ask = useCallback<AskValue["ask"]>(
    (question, opts = {}) =>
      new Promise<string>((resolve, reject) => {
        const turn: LiveTurn = { turnId: null, conversationId: null, question, question_text: null, context: opts.context ?? null, steps: [], answers: [], proposals: [], refusal: null, text: null, error: null, status: "running", startedAt: Date.now() };
        setLive(turn);
        let resolved = false;
        const apply = (e: AskEvent) => {
          if (e.event === "turn" && !resolved) {
            resolved = true;
            resolve(e.data.conversation_id);
          }
          if (e.event === "error" && !resolved) {
            resolved = true;
            reject(new Error(e.data.code));
          }
          setLive((t) => {
            if (!t) return t;
            switch (e.event) {
              case "turn":
                return { ...t, turnId: e.data.turn_id, conversationId: e.data.conversation_id, question_text: e.data.question_text ?? null };
              case "step":
                return { ...t, steps: [...t.steps, e.data] };
              case "answer":
                return { ...t, answers: [...t.answers, e.data.answer] };
              case "approval":
                return { ...t, proposals: [...t.proposals, e.data.proposal] };
              case "refusal":
                return { ...t, refusal: e.data };
              case "text":
                return { ...t, text: e.data.text };
              case "error":
                return { ...t, error: e.data, status: e.data.code === "stopped" ? "stopped" : "error" };
              case "done":
                return { ...t, status: t.status === "running" ? "done" : t.status };
            }
          });
        };
        handle.current = api.ask({ question, lang, conversation_id: opts.conversationId, context: opts.context ?? undefined }, apply);
        void handle.current.done.finally(async () => {
          handle.current = null;
          await qc.invalidateQueries();
          setLive(null);
        });
      }),
    [lang, qc],
  );

  const stop = useCallback(async () => {
    await handle.current?.stop();
  }, []);

  const value = useMemo(() => ({ live, running: live?.status === "running", ask, stop, announced, setAnnounced }), [live, ask, stop, announced]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAskStore(): AskValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAskStore needs <AskProvider>.");
  return v;
}
