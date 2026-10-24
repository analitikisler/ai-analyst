// The fixture API: the same interface as http.ts, answered by the prototype's mock server (mock/server.ts), which
// runs the server's rules on the real demo mart and keeps this session's writes. The mock is its own chunk,
// loaded on the first call, so the first paint stays small.
import type { Api, AskHandle } from "./client";
import type { AskEvent, AskRequest } from "./types";

type Mock = typeof import("./mock/server");
let mock: Promise<Mock> | null = null;
export const loadMock = () => (mock ??= import("./mock/server"));

/** A little latency, so loading states are seen in the prototype too. */
const LATENCY_MS = 90;
const later = <T>(fn: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => {
  try {
    resolve(fn());
  } catch (err) {
    reject(err);
  }
}, LATENCY_MS));

export function createFixtureApi(): Api {
  return {
    kind: "fixtures",
    async state() {
      const m = await loadMock();
      return later(() => m.getState());
    },
    async action(name, input, lang) {
      const m = await loadMock();
      return later(() => structuredClone(m.callAction(name, input, lang)));
    },
    ask(req: AskRequest, onEvent: (e: AskEvent) => void): AskHandle {
      const controller = new AbortController();
      const done = loadMock().then((m) => m.startTurn(req, onEvent, controller.signal)).catch((err: unknown) => {
        onEvent({ event: "error", data: { code: (err as { code?: string }).code ?? "internal", message: String(err) } });
        onEvent({ event: "done", data: {} });
      });
      return {
        done,
        async stop() {
          controller.abort();
          await done;
        },
      };
    },
  };
}
