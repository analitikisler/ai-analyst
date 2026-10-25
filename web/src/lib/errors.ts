// One sentence for an error the server or the network returned, in the UI language. Used by the toasts for actions
// nobody else handled, and by forms that show the reason under a field.
import { isApiError } from "@/api";
import { fmt, type Copy } from "@/i18n";

/** The bytes cap refusal, with the figures the server sends ({ bytes, cap }); null for any other error. */
export function bytesCapSentence(t: Copy, bytes: (n: number) => string, err: { code: string; params?: Record<string, string | number> } | null | undefined): string | null {
  if (!err || err.code !== "bytes_cap") return null;
  const n = (k: string) => (typeof err.params?.[k] === "number" ? bytes(err.params[k] as number) : String(err.params?.[k] ?? "–"));
  return fmt(t.err.bytes_cap, { bytes: n("bytes"), cap: n("cap") });
}

/** The warehouse cannot be read with the saved connection ({ service, reason, status? }); null for anything else. */
export function sourceUnavailableSentence(t: Copy, err: { code: string; params?: Record<string, string | number> } | null | undefined): string | null {
  if (!err || err.code !== "source_unavailable") return null;
  return fmt(t.err.source_unavailable, { service: String(err.params?.service ?? "BigQuery"), reason: String(err.params?.reason ?? err.params?.status ?? "–") });
}

export function describeError(t: Copy, err: unknown, bytes: (n: number) => string = String): string {
  if (!isApiError(err)) return err instanceof TypeError ? t.err.network.body : t.err.generic;
  if (err.code === "network") return t.err.network.body;
  if (err.status === 401 || err.code === "unauthorized") return t.err.unauthorized.body;
  if (err.code === "not_loopback" || err.code === "forbidden") return t.err.not_loopback;
  if (err.code === "locked") return fmt(t.err.locked, { variable: String(err.params?.env ?? err.params?.variable ?? "") });
  if (err.code === "undo_gone") return t.err.undo_gone;
  if (err.code === "rate_limited") return t.err.rate_limited;
  if (err.code === "source_unavailable") return sourceUnavailableSentence(t, err)!;
  if (err.code === "no_cloud") return fmt(t.err.no_cloud, { service: String(err.params?.service ?? "–") });
  if (err.code === "bytes_cap") return bytesCapSentence(t, bytes, err)!;
  if (err.status >= 500 || err.code === "http_error") return `${t.err.server.body} ${fmt(t.err.details, { code: `${err.code} ${err.status || ""}`.trim() })}`;
  return fmt(t.err.action_failed, { message: err.message || err.code });
}
