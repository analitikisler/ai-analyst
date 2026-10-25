// TanStack Query hooks, one per endpoint (the Overt pattern). Writes refetch what they can change, and previous
// data stays on screen while a new period loads (`placeholderData`), so a filter change never blanks a page.
import { keepPreviousData, QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/i18n";
import { setCurrency } from "@/lib/format";
import { api, isApiError } from ".";
import type { ActionName, Actions, CheckId, ChatClient, MetricId } from "./types";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => !(isApiError(err) && err.status >= 400 && err.status < 500) && count < 1,
      },
    },
  });
}

export const keys = {
  state: () => ["state"] as const,
  action: (name: ActionName, input: unknown) => ["action", name, input] as const,
};

/** GET /api/state (B02). Server strings are bilingual, so the key does not carry the language. */
export function useAppState() {
  const lang = useLang();
  return useQuery({ queryKey: keys.state(), queryFn: () => api.state(lang).then((s) => (setCurrency(s.currency), s)) });
}

function useRead<N extends ActionName>(name: N, input: Actions[N]["input"], opts: { enabled?: boolean; keepPrevious?: boolean; refetchInterval?: number } = {}) {
  const lang = useLang();
  return useQuery({
    queryKey: keys.action(name, input),
    queryFn: () => api.action(name, input, lang),
    enabled: opts.enabled ?? true,
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
    refetchInterval: opts.refetchInterval,
  });
}

export const useSources = () => useRead("list_sources", {});
export const useSuggestions = () => useRead("list_suggestions", {});
export const useMetricExplanation = (metric: MetricId | null) => useRead("explain_metric", { metric: metric ?? "orders" }, { enabled: !!metric });
export const useMetricEntries = () => useRead("list_metric_entries", {});
export const useMetric = (id: string) => useRead("get_metric", { metric: id });
export const useAudit = (id: string | null) => useRead("get_audit", { id: id ?? "" }, { enabled: !!id });
export const useDashboard = (id: string | undefined) => useRead("get_dashboard", { dashboard_id: id ?? "" }, { enabled: !!id, keepPrevious: true });
/** One check, over a dashboard period (`from`, `to`) or the last `days`. */
export const useCheck = (check: CheckId, period: { days?: number; from?: string; to?: string }, run_id?: string) => useRead("get_check", { check, ...period, run_id }, { keepPrevious: true });
export const useConversation = (id: string | undefined) => useRead("get_conversation", { conversation_id: id ?? "" }, { enabled: !!id && id !== "new" });
export const useSettings = () => useRead("get_settings", {});
export const useChatSetup = (client: ChatClient) => useRead("get_chat_app_setup", { client });
/** Polls every 5 s while the Chat apps tab is open (09-ux.md F10). */
export const useChatCalls = () => useRead("list_chat_app_calls", {}, { refetchInterval: 5000 });

/** A write action. Afterwards every cached read is refetched: the mock is local, and the screens stay in step. */
export function useAction<N extends ActionName>(name: N) {
  const lang = useLang();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Actions[N]["input"]) => api.action(name, input, lang),
    onSettled: () => qc.invalidateQueries(),
  });
}

/** Imperative call for event handlers that chain writes (undo from a toast). */
export function useCall() {
  const lang = useLang();
  const qc = useQueryClient();
  return async <N extends ActionName>(name: N, input: Actions[N]["input"]): Promise<Actions[N]["result"]> => {
    try {
      return await api.action(name, input, lang);
    } finally {
      void qc.invalidateQueries();
    }
  };
}
