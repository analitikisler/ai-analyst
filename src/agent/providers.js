// Model adapters behind one small interface, so the tool loop does not care who answers:
//   start({ system, tools, history, question }) -> state
//   step(state, signal) -> { text, calls: [{ id, name, input }], stop: "tool_use"|"end"|"pause"|"refusal"|"max_tokens" }
//   addResults(state, [{ id, content, is_error }])
// Anthropic goes through the official SDK. OpenAI, Gemini (its OpenAI-compatible endpoint) and any
// OpenAI-compatible server (Ollama, OpenRouter, a base URL) go through one fetch-based chat-completions adapter
// with tool calling. Tests inject the client or the fetch; nothing here runs in tests against a real service.
import Anthropic from "@anthropic-ai/sdk";
import { assertCloudAllowed, cloudFetch } from "../cloud.js";
import { BASE_URL } from "../config.js";
import { AppError } from "../errors.js";

export class ModelError extends Error {
  /** code: auth_failed | rate_limited | model_error | refusal */
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const n = (v) => (Number.isFinite(v) ? v : 0);
/** Token usage of one response: { input, output, cache_read, cache_write }, or null when the response has none. */
export function anthropicUsage(u) {
  if (!u) return null;
  return { input: n(u.input_tokens), output: n(u.output_tokens), cache_read: n(u.cache_read_input_tokens), cache_write: n(u.cache_creation_input_tokens) };
}
export function openAiUsage(u) {
  if (!u) return null;
  const cached = n(u.prompt_tokens_details?.cached_tokens);
  return { input: Math.max(0, n(u.prompt_tokens) - cached), output: n(u.completion_tokens), cache_read: cached, cache_write: 0 };
}

/** The Anthropic adapter. client: an SDK client, or a stub with beta.messages.stream. */
export function anthropicAdapter({ client, model }) {
  return {
    provider: "anthropic",
    start: ({ system, tools, history, question }) => ({
      // Tools render first, then the system prompt: one breakpoint on the stable system block caches both across
      // calls and rounds (nothing before it changes with the day, the person or the question). The volatile block
      // (today's date, the data range, the language) comes after the breakpoint. The top-level cache_control below
      // caches the growing messages within a turn.
      system: typeof system === "string" ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : [{ type: "text", text: system.stable, cache_control: { type: "ephemeral" } }, { type: "text", text: system.volatile }],
      tools: tools.map((t) => ({ ...t, eager_input_streaming: true })),
      messages: [...history.map((m) => ({ role: m.role, content: m.text })), { role: "user", content: question }],
      jsonRetries: 0,
    }),
    async step(state, signal) {
      let message;
      for (;;) {
        try {
          const stream = client.beta.messages.stream(
            {
              model,
              max_tokens: 16000,
              system: state.system,
              tools: state.tools,
              messages: state.messages,
              thinking: { type: "adaptive" },
              // Answers are a few tool calls over a small pack; medium keeps turns quick.
              output_config: { effort: "medium" },
              cache_control: { type: "ephemeral" },
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
            },
            { signal },
          );
          message = await stream.finalMessage();
          state.jsonRetries = 0;
          break;
        } catch (err) {
          if (signal?.aborted || err instanceof Anthropic.APIUserAbortError) throw err;
          if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw new ModelError("auth_failed", err.message, err.status);
          if (err instanceof Anthropic.RateLimitError) throw new ModelError("rate_limited", err.message, 429);
          if (err instanceof Anthropic.APIError) throw new ModelError("model_error", err.message, err.status);
          // With eager input streaming a tool input can arrive as JSON the SDK cannot parse; re-issue that turn.
          if (state.jsonRetries++ >= 2) throw err;
        }
      }
      const usage = anthropicUsage(message.usage);
      if (message.stop_reason === "refusal") return { text: "", calls: [], stop: "refusal", usage };
      const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      state.messages.push({ role: "assistant", content: message.content });
      if (message.stop_reason === "pause_turn") return { text, calls: [], stop: "pause", usage };
      const calls = message.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input }));
      // A tool input cut off at max_tokens can still parse; never run it.
      if (message.stop_reason === "max_tokens" && calls.length) return { text, calls: [], stop: "max_tokens", usage };
      return { text, calls, stop: calls.length ? "tool_use" : "end", usage };
    },
    addResults(state, results) {
      state.messages.push({ role: "user", content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) })) });
    },
  };
}

/** OpenAI chat completions with tools, for OpenAI, Gemini and OpenAI-compatible servers. */
export function openAiAdapter({ baseUrl, key, model, fetch: fetchFn = cloudFetch("The model server"), provider = "openai" }) {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  return {
    provider,
    start: ({ system, tools, history, question }) => ({
      tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })),
      messages: [{ role: "system", content: typeof system === "string" ? system : `${system.stable}\n\n${system.volatile}` }, ...history.map((m) => ({ role: m.role, content: m.text })), { role: "user", content: question }],
    }),
    async step(state, signal) {
      let res;
      try {
        res = await fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify({ model, messages: state.messages, tools: state.tools, tool_choice: "auto" }),
          // A hung model server must not hold the turn open: two minutes per response at most.
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
        });
      } catch (err) {
        if (signal?.aborted || err.code === "no_cloud") throw err;
        throw new ModelError("model_error", err.name === "TimeoutError" ? "The model server did not answer within two minutes." : `Could not reach ${new URL(url).host}.`);
      }
      if (res.status === 401 || res.status === 403) throw new ModelError("auth_failed", "The key was refused.", res.status);
      if (res.status === 429) throw new ModelError("rate_limited", "Rate limited.", 429);
      if (!res.ok) throw new ModelError("model_error", `The model server answered ${res.status}.`, res.status);
      const body = await res.json();
      const usage = openAiUsage(body.usage);
      const choice = body.choices?.[0];
      if (!choice) throw new ModelError("model_error", "The model server sent no answer.");
      const msg = choice.message ?? {};
      state.messages.push({ role: "assistant", content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
      if (choice.finish_reason === "content_filter") return { text: "", calls: [], stop: "refusal", usage };
      const calls = [];
      for (const c of msg.tool_calls ?? []) {
        let input;
        try {
          input = JSON.parse(c.function?.arguments || "{}");
        } catch {
          input = { __invalid_json: true };
        }
        calls.push({ id: c.id, name: c.function?.name, input });
      }
      if (choice.finish_reason === "length" && calls.length) return { text: msg.content ?? "", calls: [], stop: "max_tokens", usage };
      return { text: (msg.content ?? "").trim(), calls, stop: calls.length ? "tool_use" : "end", usage };
    },
    addResults(state, results) {
      for (const r of results) state.messages.push({ role: "tool", tool_call_id: r.id, content: r.is_error ? `Error: ${r.content}` : r.content });
    },
  };
}

/**
 * The adapter for the configured provider.
 * @param {object} app { config, modelClient?, fetch? } modelClient: a stub client for tests (Anthropic shape, or { provider, adapter }).
 */
export function adapterFor(app, mode) {
  if (app.modelClient?.adapter) return app.modelClient.adapter;
  if (app.modelClient) return anthropicAdapter({ client: app.modelClient, model: mode.model });
  const c = app.config;
  const p = c.providers[mode.provider];
  if (mode.provider === "anthropic") {
    assertCloudAllowed(p.cloud ? "Analitik İşler Cloud" : "Anthropic");
    const client = p.cloud ? new Anthropic({ baseURL: c.cloud.url, authToken: c.cloud.token, apiKey: null, timeout: 300_000, maxRetries: 2 }) : new Anthropic({ apiKey: p.key, timeout: 300_000, maxRetries: 2 });
    return anthropicAdapter({ client, model: mode.model });
  }
  const baseUrl = mode.provider === "openai_compatible" ? p.base_url : BASE_URL[mode.provider];
  if (!baseUrl) throw new AppError("model_error", "The OpenAI-compatible provider has no base URL. Set it in Settings › Model.");
  return openAiAdapter({ baseUrl, key: p.key, model: mode.model, fetch: app.fetch ?? cloudFetch(mode.provider === "gemini" ? "Google Gemini" : mode.provider === "openai" ? "OpenAI" : "The OpenAI-compatible server"), provider: mode.provider });
}
