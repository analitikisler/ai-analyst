#!/usr/bin/env bun
// A dev-only stand-in for the ai-analyst server, to see how the http build renders states the demo mock never
// produces: an own-data workspace with no dashboards and no events, settings locked by env vars, a non-loopback
// address (read-only settings), real BigQuery and model-key test failures, server errors, and the audit handoff.
// It answers from the mock server with those states laid over it. Loopback only; it calls nothing outside.
//   bun scripts/state-stub.ts [port=8790] [scenario=own|local|error]
//   own: a non-loopback address (read-only settings); local: the same on loopback, so tests and saves can be tried
//   API_URL=http://127.0.0.1:8790 bun run dev
import { callAction, getState, startTurn } from "../src/api/mock/server";
import type { Actions, AuditRun, Lang } from "../src/api/types";

const PORT = Number(process.argv[2] ?? 8790);
const SCENARIO = process.argv[3] ?? "own";
const LOOPBACK = SCENARIO === "local";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fail = (code: string, message: string, status = 400, params: Record<string, string | number> = {}) => json({ ok: false, error: { code, message, params } }, status);

function state(lang: Lang) {
  const s = getState();
  return {
    ...s,
    workspace: { ...s.workspace, name: "Own shop", demo: false },
    source: { kind: "bigquery" as const, label: { en: "BigQuery · shop-data", tr: "BigQuery · shop-data" }, project: "shop-data", table: "shop-data.ai_analyst" },
    dashboards: [],
    pins: [],
    events: [],
    audits: [],
    host_is_loopback: LOOPBACK,
    lang,
  };
}

const handoffs = new Map<string, unknown>();

const overrides: Partial<{ [N in keyof Actions]: (input: Actions[N]["input"]) => Response }> = {
  list_dashboards: () => json({ ok: true, result: [] }),
  list_events: () => json({ ok: true, result: [] }),
  get_settings: () => {
    const s = callAction("get_settings", {}, "en");
    s.server.loopback = LOOPBACK;
    if (!LOOPBACK) s.server.address = "http://192.168.1.20:8788";
    s.data_source.kind = LOOPBACK ? { value: "bigquery", source: "file", locked: false } : { value: "bigquery", source: "env", locked: true, env: "AI_ANALYST_SOURCE" };
    s.data_source.max_bytes = { ...s.data_source.max_bytes, source: "env", locked: true, env: "BIGQUERY_MAX_BYTES" };
    s.model.providers = s.model.providers.map((p) => (p.id === "anthropic" ? { ...p, set: true, source: "env", locked: true, env: "ANTHROPIC_API_KEY", hint: "…7f3a", model: "claude-opus-5-5" } : p));
    return json({ ok: true, result: s });
  },
  test_model_key: (input) => {
    const code = ({ anthropic: "key_rejected", openai: "model_not_found", gemini: "rate_limited", openai_compatible: "unreachable" } as const)[input.provider];
    return json({ ok: true, result: { ok: false, provider: input.provider, model: input.model ?? "", error: { code, status: code === "key_rejected" ? 401 : code === "rate_limited" ? 429 : code === "model_not_found" ? 404 : undefined, detail: code === "key_rejected" ? "invalid x-api-key" : undefined } } });
  },
  save_model_key: (input) => (LOOPBACK ? fail("server_error", "Could not write secrets.json.", 500) : fail("not_loopback", "Settings can be changed only from loopback.", 403)),
  set_bytes_cap: () => fail("locked", "Set by BIGQUERY_MAX_BYTES.", 409, { env: "BIGQUERY_MAX_BYTES" }),
  test_bigquery: (input) =>
    json({
      ok: true,
      result: {
        test_id: "t1",
        ok: false,
        values: input,
        detected: { location: "EU" },
        steps: [
          { id: "credentials", status: "ok", detail: { identity: "analyst@shop.example", method: "adc" } },
          { id: "jobs", status: "ok", detail: { project: input.job_project ?? input.data_project } },
          { id: "dataset", status: "ok", detail: { project: input.data_project, dataset: input.dataset, location: "EU" } },
          { id: "table", status: "failed", error: { code: "table_columns", params: { table: "daily_channel_device", missing: "ga4_revenue, platform_conversions" } } },
          { id: "read", status: "skipped" },
          { id: "cost", status: "failed", error: { code: "quota_exceeded", params: { message: "Quota exceeded: too many concurrent queries for this project." } } },
        ],
      },
    }),
  import_gtm_events: () => fail("unavailable", "The GTM import needs Google Tag Manager API access (planned for ai cloud).", 409),
  start_tracking_audit: (input) => {
    const run: AuditRun = { ...callAction("start_tracking_audit", input, "en"), status: "handoff", steps: [], result: null, finished_at: null };
    run.handoff = {
      mcp_steps: [
        `start_audit {"url": "https://${input.url}", "journey": "purchase", "providers": ${JSON.stringify(input.platforms)}, "device": "mobile_safari"}`,
        "browser_action, one step at a time, until the thank-you page",
        `finish_audit {"against": "tracking-plan", "attach_to_check": "${input.check}"}`,
      ],
      deep_link: null,
    };
    handoffs.set(run.id, run);
    return json({ ok: true, result: run });
  },
  get_audit: (input) => (handoffs.has(input.id) ? json({ ok: true, result: handoffs.get(input.id) }) : json({ ok: true, result: callAction("get_audit", input, "en") })),
};

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const lang = (url.searchParams.get("lang") ?? req.headers.get("accept-language") ?? "en").slice(0, 2) === "tr" ? "tr" : "en";
    if (SCENARIO === "error") return new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
    if (url.pathname === "/api/state") return json(state(lang));
    const m = /^\/api\/actions\/([a-z_]+)$/.exec(url.pathname);
    if (m && req.method === "POST") {
      const name = m[1] as keyof Actions;
      const input = await req.json().catch(() => ({}));
      const o = overrides[name] as ((i: unknown) => Response) | undefined;
      if (o) return o(input);
      try {
        return json({ ok: true, result: callAction(name, input as never, lang) });
      } catch (err) {
        const e = err as { code?: string; message?: string; status?: number };
        return fail(e.code ?? "server_error", e.message ?? "Unknown error", e.status ?? 500);
      }
    }
    if (url.pathname === "/api/ask" && req.method === "POST") {
      const body = await req.json();
      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          await startTurn(body, (e) => controller.enqueue(enc.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)), new AbortController().signal);
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log(`state stub on http://127.0.0.1:${PORT} (${SCENARIO})`);
