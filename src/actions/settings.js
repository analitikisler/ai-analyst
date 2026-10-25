// Settings: the data source, the bytes cap, model keys and the provider. Every action here is refused unless
// the request comes from this machine (registry: settings: true). Keys go to secrets.json (mode 0600) and only
// ever come back as a short hint. Testing BigQuery or a key is the one place the app reaches an outside system,
// and only when the person presses Test; tests stub both.
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { BASE_URL, KEY_ENV, MODEL_DEFAULT, PROVIDER_LABEL, PROVIDERS } from "../config.js";
import { assertCloudAllowed, cloudFetch } from "../cloud.js";
import { AppError } from "../errors.js";
import { f } from "../format.js";
import { assertUnlocked, settingsView, updateConfigFile, writeSecret } from "../settings.js";
import { newId } from "../store/store.js";
import { isDataset, isProject } from "../warehouse/bigquery.js";
import { ACT, SOURCE_LABEL } from "../text.js";
import { defineAction } from "./registry.js";

/** The account gcloud is signed in with, from its local config files (no network); null when not there. */
function gcloudAccount(dir) {
  try {
    const active = existsSync(path.join(dir, "active_config")) ? readFileSync(path.join(dir, "active_config"), "utf8").trim() || "default" : "default";
    const conf = readFileSync(path.join(dir, "configurations", `config_${active.replace(/[^\w.-]/g, "")}`), "utf8");
    const m = conf.match(/^\s*account\s*=\s*(\S+@\S+)\s*$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Google sign-in on this machine, read from local files only (no network). kind: the credential type
 * (service_account, authorized_user, impersonated_service_account, external_account). For a user sign-in the email
 * comes from the file when it has one, else from gcloud's own config; null when neither has it.
 */
export function localCredentials(env = process.env) {
  const dir = env.CLOUDSDK_CONFIG || path.join(os.homedir(), ".config", "gcloud");
  const file = env.GOOGLE_APPLICATION_CREDENTIALS || path.join(dir, "application_default_credentials.json");
  if (!existsSync(file)) return { adc_found: false, identity: null, kind: null };
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    const user = j.type === "authorized_user";
    const identity = j.client_email ?? j.service_account_impersonation_url?.match(/serviceAccounts\/([^:]+):/)?.[1] ?? (user ? j.account || gcloudAccount(dir) : null) ?? null;
    return { adc_found: true, identity, kind: j.type ?? null };
  } catch {
    return { adc_found: true, identity: null, kind: null };
  }
}

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

/** A quota project (from the person's application default credentials) that is deleted or missing. */
export function quotaProjectProblem(message, known = []) {
  if (!message) return null;
  const m = message.match(/project\s+['"]?([a-z0-9][a-z0-9:.-]{4,62})['"]?\s+(?:has been deleted|was deleted|is deleted|not found|does not exist|was not found)/i);
  if (m && !known.includes(m[1])) return m[1];
  if (/quota project/i.test(message) && /(deleted|not found|does not exist|invalid|missing)/i.test(message)) return m?.[1] ?? "–";
  return null;
}

defineAction({
  name: "get_settings",
  description: "Settings: the server, the data source, the model providers (keys as hints only), help and preferences.",
  kind: "read",
  mcp: false,
  input: z.object({}).strict(),
  run(ctx) {
    const s = settingsView({ ...ctx.app, credentials: localCredentials(ctx.config.env) });
    // Paths on this machine are shown only on this machine.
    if (ctx.loopback === false) {
      Object.assign(s.server, { config_file: "", data_dir: "", pack_dir: "" });
      if (s.data_source.bigquery?.auth?.path) s.data_source.bigquery.auth.path = "";
      s.data_source.credentials = { adc_found: s.data_source.credentials.adc_found, identity: null };
    }
    return s;
  },
});

// ---------------------------------------------------------------- BigQuery

const bqConfig = z
  .object({
    data_project: z.string().trim().min(1).max(100),
    job_project: z.string().trim().max(100).nullable(),
    dataset: z.string().trim().min(1).max(1024),
    location: z.string().trim().max(40).nullable(),
    auth: z.object({ kind: z.enum(["adc", "key_file"]), path: z.string().max(1000).nullable().optional(), impersonate: z.string().max(200).nullable().optional() }).strict(),
    max_bytes: z.number().int().positive(),
  })
  .strict();

const STEP_IDS = ["credentials", "jobs", "dataset", "table", "read", "cost"];

/** The real BigQuery checks behind test_bigquery. Tests pass app.bigQueryTester instead. */
export async function realBigQueryTester(values) {
  assertCloudAllowed("BigQuery");
  const { bigQueryClient } = await import("../warehouse/bigquery.js");
  const cfg = { project: values.data_project, jobProject: values.job_project || values.data_project, dataset: values.dataset, location: values.location, auth: values.auth };
  const client = await bigQueryClient(cfg);
  return {
    async identity() {
      const creds = await client.authClient.getCredentials().catch(() => ({}));
      return creds.client_email ?? null;
    },
    async canRunJobs() {
      await client.createQueryJob({ query: "SELECT 1", dryRun: true, useLegacySql: false });
    },
    async dataset() {
      const [meta] = await client.dataset(values.dataset, { projectId: values.data_project }).getMetadata();
      return { location: meta.location ?? null };
    },
    async table() {
      const [meta] = await client.dataset(values.dataset, { projectId: values.data_project }).table("daily_channel_device").getMetadata();
      return { columns: meta.schema?.fields?.map((x) => x.name) ?? [], modified: meta.lastModifiedTime ? new Date(Number(meta.lastModifiedTime)).toISOString() : null };
    },
    async read(table) {
      const [rows] = await client.query({ query: `SELECT CAST(MIN(date) AS STRING) AS f, CAST(MAX(date) AS STRING) AS t, COUNT(*) AS n FROM ${table}`, useLegacySql: false, maximumBytesBilled: String(values.max_bytes) });
      return { from: rows[0]?.f ?? null, to: rows[0]?.t ?? null, rows: Number(rows[0]?.n ?? 0) };
    },
    async cost(table) {
      const [job] = await client.createQueryJob({ query: `SELECT date, device, SUM(orders) AS o, SUM(ga4_purchases) AS g FROM ${table} WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) GROUP BY date, device`, dryRun: true, useLegacySql: false });
      return Number(job?.metadata?.statistics?.totalBytesProcessed ?? 0);
    },
  };
}

const MART_COLUMNS = ["date", "channel", "device", "sessions", "orders", "revenue", "ga4_purchases", "ga4_revenue", "platform_conversions", "ad_spend"];
const g = (google) => (google ? { google } : {});
const status = (err) => err?.code ?? err?.response?.status ?? err?.errors?.[0]?.reason;

defineAction({
  name: "test_bigquery",
  description: "Tests a BigQuery connection in six steps: credentials, running queries, the dataset, the table, reading it and the cost of a typical question.",
  kind: "read",
  settings: true,
  mcp: false,
  input: bqConfig,
  async run(ctx, v) {
    const steps = [];
    const values = { ...v, job_project: v.job_project || null };
    const finish = (location) => {
      for (const id of STEP_IDS.slice(steps.length)) steps.push({ id, status: "skipped" });
      const ok = steps.every((s) => s.status === "ok");
      const test_id = newId("t");
      ctx.store.put("bq_tests", { id: test_id, ok, values: { ...values, location: location ?? values.location }, created_at: new Date().toISOString() });
      return { test_id, ok, steps, detected: { location }, values };
    };
    const jobProject = values.job_project || values.data_project;
    if (!isProject(values.data_project) || !isProject(jobProject) || !isDataset(values.dataset)) {
      steps.push({ id: "credentials", status: "failed", error: { code: "invalid_name", params: { p: values.data_project, d: values.dataset } } });
      return finish(null);
    }
    let method = values.auth.kind;
    if (values.auth.kind === "key_file") {
      const p = (values.auth.path ?? "").trim();
      if (!p) {
        steps.push({ id: "credentials", status: "failed", error: { code: "keyfile_read", params: { path: "–" } } });
        return finish(null);
      }
      try {
        const j = JSON.parse(readFileSync(p, "utf8"));
        if (j.type !== "service_account") throw Object.assign(new Error("type"), { kind: "type" });
      } catch (err) {
        steps.push({ id: "credentials", status: "failed", error: { code: err.kind === "type" || err instanceof SyntaxError ? "keyfile_type" : "keyfile_read", params: { path: p } } });
        return finish(null);
      }
    } else if (!localCredentials(ctx.config.env).adc_found) {
      steps.push({ id: "credentials", status: "failed", error: { code: "no_credentials", params: {} } });
      return finish(null);
    }
    const tester = ctx.app.bigQueryTester ? await ctx.app.bigQueryTester(values) : await realBigQueryTester(values);
    let identity;
    const local = localCredentials(ctx.config.env);
    // A user sign-in shows its email when it is on this machine; otherwise the app says "your Google account".
    const identityKind = values.auth.impersonate ? "service_account" : values.auth.kind === "key_file" ? "service_account" : local.kind === "authorized_user" ? "user" : local.kind ? "service_account" : null;
    try {
      identity = values.auth.impersonate || (await tester.identity()) || local.identity || "";
      steps.push({ id: "credentials", status: "ok", detail: { identity, method, identity_kind: identityKind } });
    } catch {
      steps.push({ id: "credentials", status: "failed", error: { code: "no_credentials", params: {} } });
      return finish(null);
    }
    try {
      await tester.canRunJobs();
      steps.push({ id: "jobs", status: "ok", detail: { project: jobProject } });
    } catch (err) {
      const google = safeGoogleMessage(err);
      const quota = quotaProjectProblem(google, [jobProject, values.data_project]);
      steps.push({ id: "jobs", status: "failed", detail: { project: jobProject }, error: quota ? { code: "quota_project", params: { q: quota, p: jobProject, ...g(google) } } : { code: "no_jobs", params: { id: identity, p: jobProject, ...g(google) } } });
      return finish(null);
    }
    let location;
    try {
      ({ location } = await tester.dataset());
      steps.push({ id: "dataset", status: "ok", detail: { project: values.data_project, dataset: values.dataset, location: location ?? "–" } });
    } catch (err) {
      steps.push({ id: "dataset", status: "failed", error: { code: status(err) === 403 ? "dataset_denied" : "dataset_not_found", params: { p: values.data_project, d: values.dataset, loc: values.location ?? "–", id: identity, ...g(safeGoogleMessage(err)) } } });
      return finish(null);
    }
    const table = `\`${values.data_project}.${values.dataset}.daily_channel_device\``;
    try {
      const t = await tester.table();
      const missing = MART_COLUMNS.filter((c) => !t.columns.includes(c));
      if (missing.length) {
        steps.push({ id: "table", status: "failed", error: { code: "table_columns", params: { missing: missing.join(", ") } } });
        return finish(location);
      }
      steps.push({ id: "table", status: "ok", detail: { table: "daily_channel_device", n: t.columns.length, time: t.modified ?? "–" } });
    } catch (err) {
      steps.push({ id: "table", status: "failed", error: { code: "table_not_found", params: { p: values.data_project, d: values.dataset, table: "daily_channel_device", ...g(safeGoogleMessage(err)) } } });
      return finish(location);
    }
    try {
      const r = await tester.read(table);
      steps.push({ id: "read", status: "ok", detail: { from: r.from ?? "–", to: r.to ?? "–", rows: r.rows } });
    } catch (err) {
      steps.push({ id: "read", status: "failed", error: { code: "read_denied", params: { id: identity, p: values.data_project, d: values.dataset, table: "daily_channel_device", ...g(safeGoogleMessage(err)) } } });
      return finish(location);
    }
    try {
      const bytes = await tester.cost(table);
      if (bytes > values.max_bytes) {
        steps.push({ id: "cost", status: "failed", detail: { bytes, cap: values.max_bytes }, error: { code: "over_cap", params: { bytes, cap: values.max_bytes } } });
        return finish(location);
      }
      steps.push({ id: "cost", status: "ok", detail: { bytes, cap: values.max_bytes } });
    } catch (err) {
      steps.push({ id: "cost", status: "failed", error: { code: "dry_run_failed", params: { ...g(safeGoogleMessage(err)) } } });
      return finish(location);
    }
    return finish(location);
  },
});

defineAction({
  name: "save_data_source",
  description: "Switches the data source: the demo, or a BigQuery connection that passed its test.",
  kind: "write",
  settings: true,
  input: z.union([z.object({ kind: z.literal("demo") }).strict(), z.object({ kind: z.literal("bigquery"), test_id: z.string().min(1).max(64) }).strict()]),
  async run(ctx, input) {
    const c = ctx.config;
    assertUnlocked(c.warehouseSetting.locked, "AI_ANALYST_WAREHOUSE");
    if (input.kind === "demo") {
      const was = c.warehouse;
      const next = updateConfigFile(c, (file) => (file.warehouse = "duckdb"));
      await ctx.app.applyConfig(next);
      if (was !== "duckdb") ctx.log(ACT.data_source(SOURCE_LABEL.demo));
      return settingsView({ ...ctx.app, credentials: localCredentials(c.env) });
    }
    const t = ctx.store.get("bq_tests", input.test_id);
    if (!t?.ok) throw new AppError("test_required", "Test the connection first.");
    const v = t.values;
    const next = updateConfigFile(c, (file) => {
      file.warehouse = "bigquery";
      file.bigquery = { ...(file.bigquery ?? {}), project: v.data_project, jobProject: v.job_project || null, dataset: v.dataset, location: v.location, auth: { kind: v.auth.kind, path: v.auth.path ?? null, impersonate: v.auth.impersonate ?? null }, maxBytes: v.max_bytes, checkedAt: new Date().toISOString() };
    });
    await ctx.app.applyConfig(next);
    ctx.log(ACT.data_source(SOURCE_LABEL.bigquery(v.data_project)));
    return settingsView({ ...ctx.app, credentials: localCredentials(c.env) });
  },
});

defineAction({
  name: "set_bytes_cap",
  description: "Lowers the bytes cap per BigQuery query. It can only be raised with BIGQUERY_MAX_BYTES.",
  kind: "write",
  settings: true,
  input: z.object({ max_bytes: z.number().int() }).strict(),
  async run(ctx, { max_bytes }) {
    const c = ctx.config;
    assertUnlocked(c.bigquery.maxBytesSource === "env", "BIGQUERY_MAX_BYTES");
    if (max_bytes > c.bigquery.ceiling) throw new AppError("over_ceiling", "The cap can only be raised with BIGQUERY_MAX_BYTES.");
    if (!(max_bytes > 0)) throw new AppError("invalid_input", "The cap must be above zero.");
    const next = updateConfigFile(c, (file) => (file.bigquery = { ...(file.bigquery ?? {}), maxBytes: max_bytes }));
    await ctx.app.applyConfig(next);
    ctx.log({ en: `Lowered the bytes cap to ${f.en.bytes(max_bytes)}`, tr: `Bayt sınırı ${f.tr.bytes(max_bytes)} olarak düşürüldü` });
    return settingsView({ ...ctx.app, credentials: localCredentials(c.env) });
  },
});

defineAction({
  name: "rebuild_demo",
  description: "Rebuilds the demo warehouse and starts the demo workspace again. Preferences stay.",
  kind: "write",
  settings: true,
  input: z.object({}).strict(),
  async run(ctx) {
    await ctx.app.rebuildDemo();
    ctx.app.store.logActivity({ actor: "system", action: "rebuild_demo", detail: ACT.demo_rebuilt });
    return { ok: true };
  },
});

// ---------------------------------------------------------------- model keys

const keyInput = z
  .object({ provider: z.enum(PROVIDERS), key: z.string().trim().min(1).max(500).optional(), model: z.string().trim().max(120), base_url: z.string().trim().max(300).optional() })
  .strict();

const LOOPBACK_URL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Where an OpenAI-compatible key may go. A key that is saved or set in the environment only ever goes to the saved
 * (or environment-locked) base URL; a different base URL needs its own key in the same request. Plain http only
 * to this machine (Ollama); never to link-local or cloud metadata addresses.
 */
export function checkCompatibleTarget(input, saved, base) {
  const changed = input.base_url && input.base_url.replace(/\/$/, "") !== (saved.base_url ?? "").replace(/\/$/, "");
  if (changed && saved.base_url_locked) throw new AppError("locked", "The base URL is set by AI_ANALYST_OPENAI_COMPATIBLE_URL in the environment, so it cannot be changed here.", { params: { env: "AI_ANALYST_OPENAI_COMPATIBLE_URL" } });
  if (changed && !input.key && saved.key) throw new AppError("key_required", "A new base URL needs its key in the same request: the saved key is only sent to the saved base URL.");
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new AppError("invalid_base_url", "The base URL is not a web address. Write it like https://openrouter.ai/api/v1 or http://127.0.0.1:11434/v1.");
  }
  const host = url.hostname.toLowerCase();
  if (url.username || url.password) throw new AppError("invalid_base_url", "The base URL must not carry a user name or password.");
  if (url.protocol === "http:" && !LOOPBACK_URL_HOSTS.has(host)) throw new AppError("invalid_base_url", "Plain http is only allowed to this machine (Ollama on 127.0.0.1). Use https for any other host, so the key is not sent in clear text.");
  if (!["http:", "https:"].includes(url.protocol)) throw new AppError("invalid_base_url", "The base URL must start with https:// (or http:// to this machine).");
  if (/^169\.254\./.test(host) || host === "metadata.google.internal" || host === "[fd00:ec2::254]" || /^\[?fe80:/i.test(host)) throw new AppError("invalid_base_url", "Link-local and cloud metadata addresses are not allowed as a model server.");
}

const baseUrlOf = (provider, input, saved) => (provider === "openai_compatible" ? input.base_url || saved?.base_url || "" : BASE_URL[provider] ?? null);

/** One small real call with the key, only when the person presses Test. Tests pass app.fetch / app.anthropicFactory. */
export async function testModel(app, input) {
  const { provider } = input;
  const model = input.model || MODEL_DEFAULT[provider];
  const saved = app.config.providers[provider];
  const key = input.key ?? saved.key ?? null;
  const fail = (code, extra = {}) => ({ ok: false, provider, model, error: { code, ...extra } });
  if (!model) return fail("model_not_found");
  if (!key && provider !== "openai_compatible") return fail("key_rejected", { status: 401, detail: "no key" });
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 100) / 10;
  if (provider === "anthropic") {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = app.anthropicFactory ? app.anthropicFactory({ apiKey: key }) : (assertCloudAllowed("Anthropic"), new Anthropic({ apiKey: key, maxRetries: 0, timeout: 30000 }));
    try {
      await client.messages.create({ model, max_tokens: 64, output_config: { effort: "low" }, messages: [{ role: "user", content: "Reply with the word OK." }] });
      return { ok: true, provider, model, seconds: seconds() };
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return fail("key_rejected", { status: err.status });
      if (err instanceof Anthropic.NotFoundError) return fail("model_not_found", { status: 404 });
      if (err instanceof Anthropic.RateLimitError) return fail("rate_limited", { status: 429 });
      if (err instanceof Anthropic.APIConnectionError) return fail("unreachable", { detail: "connection" });
      if (err instanceof Anthropic.APIError) return fail(err.status === 400 ? "model_not_found" : "unreachable", { status: err.status });
      throw err;
    }
  }
  const base = baseUrlOf(provider, input, saved);
  if (provider === "openai_compatible") checkCompatibleTarget(input, saved, base);
  const fetchFn = app.fetch ?? cloudFetch(provider === "openai_compatible" ? "The OpenAI-compatible server" : provider === "gemini" ? "Google Gemini" : "OpenAI");
  let res;
  try {
    res = await fetchFn(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: "Reply with the word OK." }] }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    if (err.code === "no_cloud") throw err;
    return fail("unreachable", { detail: base });
  }
  if (res.ok) return { ok: true, provider, model, seconds: seconds() };
  if (res.status === 401 || res.status === 403) return fail("key_rejected", { status: res.status });
  if (res.status === 404) return fail("model_not_found", { status: 404 });
  if (res.status === 429) return fail("rate_limited", { status: 429 });
  return fail("unreachable", { status: res.status });
}

defineAction({
  name: "test_model_key",
  description: "Tests a model key with one small call. Without a key, tests the saved one.",
  kind: "read",
  settings: true,
  mcp: false,
  input: keyInput,
  run: (ctx, input) => testModel(ctx.app, input),
});

defineAction({
  name: "save_model_key",
  description: "Tests and saves a model key (to secrets.json, mode 0600) and uses that provider for answers.",
  kind: "write",
  settings: true,
  input: keyInput,
  async run(ctx, input) {
    const c = ctx.config;
    const p = input.provider;
    if (input.key) assertUnlocked(c.providers[p].source === "env", KEY_ENV[p]);
    const t = await testModel(ctx.app, input);
    const lastTest = { ok: t.ok, at: new Date().toISOString(), ...(t.ok ? {} : { error: { code: t.error.code } }) };
    if (!t.ok) throw new AppError(t.error.code, "The test did not pass. Nothing was saved.", { params: { ...(t.error.status ? { status: t.error.status } : {}) } });
    let next = input.key ? writeSecret(c, p, input.key) : c;
    next = updateConfigFile(next, (file) => {
      if (typeof file.model === "string") file.model = { providers: { anthropic: { model: file.model } } };
      file.model ??= {};
      file.model.providers ??= {};
      file.model.providers[p] = { ...(file.model.providers[p] ?? {}), model: input.model || MODEL_DEFAULT[p], ...(p === "openai_compatible" ? { baseUrl: input.base_url ?? file.model.providers[p]?.baseUrl ?? null, keyless: !input.key && !c.providers[p].key } : {}), lastTest };
      if (!c.provider.locked) file.model.provider = p;
    });
    await ctx.app.applyConfig(next);
    ctx.log(ACT.model_saved(PROVIDER_LABEL[p]));
    return settingsView({ ...ctx.app, credentials: localCredentials(c.env) });
  },
});

defineAction({
  name: "remove_model_key",
  description: "Removes a saved model key. Answers go back to another set provider or the built-in planner.",
  kind: "write",
  settings: true,
  input: z.object({ provider: z.enum(PROVIDERS) }).strict(),
  async run(ctx, { provider }) {
    const c = ctx.config;
    assertUnlocked(c.providers[provider].source === "env", KEY_ENV[provider]);
    let next = writeSecret(c, provider, null);
    next = updateConfigFile(next, (file) => {
      if (file.model && typeof file.model === "object") {
        delete file.model.providers?.[provider];
        if (file.model.provider === provider) file.model.provider = PROVIDERS.find((x) => x !== provider && next.providers[x].set) ?? "planner";
      }
    });
    await ctx.app.applyConfig(next);
    ctx.log(ACT.model_removed(PROVIDER_LABEL[provider]));
    return settingsView({ ...ctx.app, credentials: localCredentials(c.env) });
  },
});

defineAction({
  name: "set_model_provider",
  description: "Chooses who answers questions: a provider with a key, or the built-in planner.",
  kind: "write",
  settings: true,
  input: z.object({ provider: z.enum(["planner", ...PROVIDERS]) }).strict(),
  async run(ctx, { provider }) {
    const c = ctx.config;
    assertUnlocked(c.provider.locked, "AI_ANALYST_PROVIDER");
    if (provider !== "planner" && !c.providers[provider].set) throw new AppError("invalid_input", "That provider has no key.");
    const next = updateConfigFile(c, (file) => {
      if (typeof file.model === "string") file.model = { providers: { anthropic: { model: file.model } } };
      file.model ??= {};
      file.model.provider = provider;
    });
    await ctx.app.applyConfig(next);
    ctx.log(provider === "planner" ? { en: "Set the built-in planner to answer questions", tr: "Soruları yerleşik planlayıcı cevaplayacak şekilde ayarlandı" } : ACT.model_provider(PROVIDER_LABEL[provider]));
    return settingsView({ ...ctx.app, credentials: localCredentials(c.env) });
  },
});
