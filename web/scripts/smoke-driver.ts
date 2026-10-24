// How the smoke flows reach a server: the mock in-process (`bun run smoke`, the default) or a running ai-analyst server
// over HTTP (`bun run smoke:http [url]`, default http://127.0.0.1:8788). Prototype-only steps (reset, the simulated
// model key and tracking fix) exist only on the mock; on HTTP they report "skip" and the checks that need them are skipped.
import { createHttpApi } from "../src/api/http";
import type { Actions, AppState, AskEvent, AskRequest, Lang } from "../src/api/types";

export interface Driver {
  kind: "fixtures" | "http";
  act<N extends keyof Actions>(name: N, input: Actions[N]["input"], lang?: Lang): Promise<Actions[N]["result"]>;
  state(lang?: Lang): Promise<AppState>;
  turn(req: AskRequest, emit: (e: AskEvent) => void): Promise<void>;
  /** Back to the first run; false when the server cannot (HTTP). */
  reset(): Promise<boolean>;
  simulateModelKey(on: boolean): Promise<boolean>;
  simulateAuditFix(on: boolean): Promise<boolean>;
  /** HTTP only: the server was started with --no-cloud (BigQuery and model calls answer no_cloud). */
  noCloud: boolean;
}

export async function mockDriver(): Promise<Driver> {
  const m = await import("../src/api/mock/server");
  return {
    kind: "fixtures",
    act: async (name, input, lang = "en") => m.callAction(name, input, lang),
    state: async () => m.getState(),
    turn: (req, emit) => m.startTurn(req, emit, new AbortController().signal),
    reset: async () => (m.resetPrototype(), true),
    simulateModelKey: async (on) => (m.simulateModelKey(on), true),
    simulateAuditFix: async (on) => (m.simulateAuditFix(on), true),
    noCloud: false,
  };
}

const CLOUD_ACTIONS = new Set<string>(["test_bigquery", "test_model_key", "save_model_key", "save_data_source"]);

/** The flows that reach BigQuery or a model run only when the server refuses them (--no-cloud). The probe itself is
 *  safe either way: an OpenAI-compatible test against a closed loopback port never leaves this machine. */
async function probeNoCloud(api: ReturnType<typeof createHttpApi>): Promise<boolean> {
  try {
    await api.action("test_model_key", { provider: "openai_compatible", key: "smoke", model: "smoke", base_url: "http://127.0.0.1:9/v1" }, "en");
    return false;
  } catch (err) {
    return (err as { code?: string }).code === "no_cloud";
  }
}

export async function httpDriver(url: string): Promise<Driver> {
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/?$/.test(url)) throw new Error("smoke:http talks only to a loopback server.");
  const api = createHttpApi(url.replace(/\/$/, ""));
  const noCloud = await probeNoCloud(api).catch(() => false);
  return {
    kind: "http",
    noCloud,
    act: (name, input, lang = "en") => {
      // These make real calls from the server (Google, Anthropic, OpenAI, Gemini) unless it refuses them.
      if (!noCloud && CLOUD_ACTIONS.has(name)) throw new Error(`smoke:http does not call ${name} on a server without --no-cloud: it reaches a cloud API.`);
      return api.action(name, input, lang);
    },
    state: (lang = "en") => api.state(lang),
    turn: async (req, emit) => {
      await api.ask(req, emit).done;
    },
    reset: async () => false,
    simulateModelKey: async () => false,
    simulateAuditFix: async () => false,
  };
}
