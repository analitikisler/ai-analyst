// The ai-analyst server (src/server.js), same origin, per docs/CONTRACT.md 0.2. In dev, Vite proxies /api to API_URL
// (http://127.0.0.1:8788). A server that is not running surfaces as ApiError "network", one that answers with HTML or
// nothing as "http_error" with its status, so every screen can say which it is.
import { ApiError, type Api, type AskHandle } from "./client";
import type { ActionResponse, AppState, AskEvent, AskRequest } from "./types";

const JSON_HEADERS = { "Content-Type": "application/json" };

/** fetch, with a server that cannot be reached turned into ApiError("network"). Cookies go along (the access token). */
async function request(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { credentials: "same-origin", ...init });
  } catch (err) {
    if (init.signal?.aborted) throw err;
    throw new ApiError("network", err instanceof Error ? err.message : String(err), 0);
  }
}

async function readError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ActionResponse<unknown>;
    if (!body.ok) return new ApiError(body.error.code, body.error.message ?? body.error.code, res.status, body.error.params);
  } catch {
    /* not JSON */
  }
  return new ApiError("http_error", `The server answered ${res.status}.`, res.status);
}

/** Splits a text/event-stream body into events. */
async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (e: AskEvent) => void, signal: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event) onEvent({ event, data: data ? JSON.parse(data) : {} } as AskEvent);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function createHttpApi(base = ""): Api {
  return {
    kind: "http",

    async state(lang) {
      const res = await request(`${base}/api/state?lang=${lang}`, { headers: { "Accept-Language": lang } });
      if (!res.ok) throw await readError(res);
      return (await res.json()) as AppState;
    },

    async action(name, input, lang) {
      const res = await request(`${base}/api/actions/${name}`, {
        method: "POST",
        headers: { ...JSON_HEADERS, "Accept-Language": lang },
        body: JSON.stringify(input ?? {}),
      });
      const body = (await res.json().catch(() => null)) as ActionResponse<never> | null;
      if (!body) throw new ApiError("http_error", `The server answered ${res.status}.`, res.status);
      if (!body.ok) throw new ApiError(body.error.code, body.error.message ?? body.error.code, res.status, body.error.params);
      return body.result;
    },

    ask(req: AskRequest, onEvent): AskHandle {
      const controller = new AbortController();
      let turnId: string | null = null;
      const relay = (e: AskEvent) => {
        if (e.event === "turn") turnId = e.data.turn_id;
        onEvent(e);
      };
      const done = (async () => {
        try {
          const res = await request(`${base}/api/ask`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify(req),
            signal: controller.signal,
          });
          if (!res.ok || !res.body) {
            const err = await readError(res);
            relay({ event: "error", data: { code: err.code, message: err.message, params: err.params } });
            return;
          }
          await readEvents(res.body, relay, controller.signal);
        } catch (err) {
          if (controller.signal.aborted) return;
          relay({ event: "error", data: { code: err instanceof ApiError ? err.code : "network", message: err instanceof Error ? err.message : String(err), params: err instanceof ApiError ? err.params : undefined } });
        }
      })();
      return {
        done,
        async stop() {
          if (turnId) await request(`${base}/api/turns/${turnId}/stop`, { method: "POST" }).catch(() => undefined);
          controller.abort();
        },
      };
    },

  };
}
