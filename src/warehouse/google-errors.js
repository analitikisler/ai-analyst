// Google's error, made safe to show and log: the first line of its message, with anything that looks like a token
// or key hidden, at most 200 characters. Never the request config or headers, which gaxios errors carry.
import { AppError } from "../errors.js";

/**
 * Google's own words for a failed call, short and safe to show: the first line, no tokens or secrets, under 200
 * characters. null when there is nothing to say.
 */
export function safeGoogleMessage(err) {
  const raw = err?.errors?.[0]?.message || err?.response?.data?.error?.message || err?.message;
  if (!raw || typeof raw !== "string") return null;
  let m = raw.split("\n")[0];
  m = m
    .replace(/Bearer\s+\S+/gi, "Bearer [hidden]")
    .replace(/\b(access_token|refresh_token|id_token|client_secret|private_key|api[_-]?key|token)\b(["']?\s*[:=]\s*["']?)[^\s"',&]+/gi, "$1$2[hidden]")
    .replace(/ya29\.[\w.-]+/g, "[hidden]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[hidden]")
    .replace(/[A-Za-z0-9_\-+/]{40,}={0,2}/g, "[hidden]")
    .replace(/\s+/g, " ")
    .trim();
  if (!m) return null;
  return m.length > 199 ? `${m.slice(0, 198).trimEnd()}…` : m;
}

/**
 * A warehouse that cannot be reached (a deleted service account, revoked access, no network): one log line with
 * the code and Google's short message, and an error the app can show while it still loads.
 */
export function sourceUnavailable(err, service = "BigQuery") {
  if (err instanceof AppError) return err;
  const reason = safeGoogleMessage(err) ?? "no answer";
  const status = Number(err?.code ?? err?.response?.status) || undefined;
  console.error(`[ai-analyst] source_unavailable: ${service}${status ? ` ${status}` : ""}: ${reason}`);
  return new AppError("source_unavailable", `${service} could not be reached with the saved connection (${reason}). Check it in Settings › Sources.`, { params: { service, reason, ...(status ? { status } : {}) } });
}
