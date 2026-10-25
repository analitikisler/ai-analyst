// The one interface every screen talks to. Two implementations: `fixtures.ts` (the prototype's mock server on the
// real demo mart, the default) and `http.ts` (a running ai-analyst server). Pick one in `index.ts`.
import type { ActionName, Actions, AppState, AskEvent, AskRequest, Lang, OrdersUpload } from "./types";

export interface AskHandle {
  /** Resolves when the stream ends (after `done`, an `error`, or a stop). */
  done: Promise<void>;
  /** POST /api/turns/:id/stop, then end the stream. */
  stop(): Promise<void>;
}

export interface Api {
  readonly kind: "http" | "fixtures";
  state(lang: Lang): Promise<AppState>;
  action<N extends ActionName>(name: N, input: Actions[N]["input"], lang: Lang): Promise<Actions[N]["result"]>;
  /** Streams the agent's turn. `onEvent` gets every event in order. */
  ask(req: AskRequest, onEvent: (e: AskEvent) => void): AskHandle;
  /** POST /api/uploads/orders: the raw CSV or XLSX as the body; the answer is the header, a guessed mapping and the
   *  preview of daily totals. */
  uploadOrders(file: File, lang: Lang): Promise<OrdersUpload>;
}

/** Orders files the server reads, by extension. */
export const ORDERS_FILE_TYPES: Record<"csv" | "xlsx", string> = { csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
export const ordersKindOf = (name: string): "csv" | "xlsx" | null => (/\.csv$/i.test(name) ? "csv" : /\.xlsx$/i.test(name) ? "xlsx" : null);

/** A failed call, with the server's code and its plain-words message (the UI shows its own copy per code, B21). */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly params: Record<string, string | number>;
  constructor(code: string, message: string, status = 0, params: Record<string, string | number> = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.params = params;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;
