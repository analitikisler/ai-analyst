// Configuration, in this order: environment, then ai-analyst.config.json (non-secret settings, safe to
// commit), then <data_dir>/secrets.json (model keys, mode 0600, never returned by the API). An environment
// variable wins over both files and locks the field in Settings. Google credentials are never stored: they are
// the person's own (gcloud application default credentials, or a key file path).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadExploreConfig } from "./explore/allow.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
export const DEFAULT_MODEL = "claude-opus-5-5";
export const GB = 1024 ** 3;
export const BYTES_CEILING_DEFAULT = 2 * GB;

export const PROVIDERS = ["anthropic", "openai", "gemini", "openai_compatible"];
export const PROVIDER_LABEL = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Google Gemini", openai_compatible: "OpenAI-compatible" };
export const MODEL_DEFAULT = { anthropic: DEFAULT_MODEL, openai: "gpt-5.5", gemini: "gemini-pro-latest", openai_compatible: "" };
export const MODEL_LABEL = { "claude-opus-5-5": "Claude Opus 5.5", "gpt-5.5": "GPT-5.5", "gemini-pro-latest": "Gemini Pro" };
/** The env var that holds each provider's key; set, it wins over the saved key and locks it. */
export const KEY_ENV = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", openai_compatible: "AI_ANALYST_OPENAI_COMPATIBLE_KEY" };
export const BASE_URL = {
  openai: "https://api.openai.com/v1",
  // Gemini's OpenAI-compatible endpoint, so one adapter speaks to all three.
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

const readJson = (file, what) => {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${what} is not valid JSON: ${err.message}`);
  }
};

export const secretsFile = (dataDir) => path.join(dataDir, "secrets.json");

/**
 * @param {{ env?: Record<string, string|undefined>, cwd?: string, file?: string }} [opts]
 */
export function loadConfig({ env = process.env, cwd = process.cwd(), file } = {}) {
  const has = (name) => env[name] !== undefined && env[name] !== "";
  const configFile = path.resolve(cwd, file ?? (has("AI_ANALYST_CONFIG") ? env.AI_ANALYST_CONFIG : "ai-analyst.config.json"));
  const fromFile = readJson(configFile, configFile);
  const pick = (name, fileValue, fallback) => (has(name) ? env[name] : fileValue ?? fallback);
  /** { value, source, locked, env? } for Settings. */
  const setting = (name, fileValue, fallback, { detected = false } = {}) =>
    has(name) ? { value: env[name], source: "env", locked: true, env: name } : fileValue != null ? { value: fileValue, source: "file", locked: false } : { value: fallback, source: detected ? "detected" : "default", locked: false };

  const port = Number(pick("PORT", fromFile.port, 8787));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT must be a port number, not "${port}".`);
  const dataDir = path.resolve(cwd, pick("AI_ANALYST_DATA_DIR", fromFile.dataDir, "./data"));

  // Data source. The file's "warehouse" is duckdb (the demo) or bigquery.
  const bq = fromFile.bigquery ?? {};
  const wh = setting("AI_ANALYST_WAREHOUSE", fromFile.warehouse, "duckdb");
  if (!["duckdb", "bigquery", "demo"].includes(wh.value)) throw new Error(`AI_ANALYST_WAREHOUSE must be duckdb or bigquery, not "${wh.value}".`);
  const warehouse = wh.value === "bigquery" ? "bigquery" : "duckdb";
  const ceiling = Number(pick("BIGQUERY_MAX_BYTES", null, BYTES_CEILING_DEFAULT));
  if (!(ceiling > 0)) throw new Error("BIGQUERY_MAX_BYTES must be a positive number of bytes.");
  // The file may lower the cap below the ceiling, never raise it.
  const fileCap = bq.maxBytes != null ? Number(bq.maxBytes) : null;
  const maxBytes = has("BIGQUERY_MAX_BYTES") ? ceiling : fileCap && fileCap > 0 ? Math.min(fileCap, ceiling) : ceiling;
  const dataProject = pick("BIGQUERY_PROJECT", bq.project ?? bq.dataProject, null);

  // Model providers: keys from env or secrets.json, models and base URLs from env or the file.
  const secrets = readJson(secretsFile(dataDir), "secrets.json");
  const fileModel = typeof fromFile.model === "string" ? { providers: { anthropic: { model: fromFile.model } } } : fromFile.model ?? {};
  const providers = {};
  for (const id of PROVIDERS) {
    const envKey = has(KEY_ENV[id]) ? env[KEY_ENV[id]] : null;
    const saved = secrets.providers?.[id]?.key ?? null;
    const fileP = fileModel.providers?.[id] ?? {};
    const baseEnv = id === "openai_compatible" && has("AI_ANALYST_OPENAI_COMPATIBLE_URL") ? env.AI_ANALYST_OPENAI_COMPATIBLE_URL : null;
    providers[id] = {
      id,
      key: envKey ?? saved,
      source: envKey ? "env" : saved ? "saved" : null,
      env: KEY_ENV[id],
      model: fileP.model ?? null,
      base_url: baseEnv ?? fileP.baseUrl ?? null,
      base_url_locked: Boolean(baseEnv),
      // An OpenAI-compatible server on this machine (Ollama) may need no key at all.
      set: Boolean(envKey ?? saved) || (id === "openai_compatible" && Boolean(baseEnv ?? fileP.baseUrl) && Boolean(fileP.model) && fileP.keyless === true),
      last_test: fileP.lastTest ?? null,
    };
  }
  // Analitik İşler Cloud: a hosted endpoint that speaks the Anthropic API, for teams without their own key.
  const cloud = { url: env.AI_ANALYST_CLOUD_URL || null, token: env.AI_ANALYST_CLOUD_TOKEN || null };
  if (!providers.anthropic.set && cloud.url && cloud.token) Object.assign(providers.anthropic, { set: true, source: "env", env: "AI_ANALYST_CLOUD_TOKEN", cloud: true });

  let provider = setting("AI_ANALYST_PROVIDER", fileModel.provider ?? null, "planner");
  if (provider.source === "default") {
    // Without a saved choice, a key in the environment is used, as before 0.2 (ANTHROPIC_API_KEY alone).
    const firstEnv = PROVIDERS.find((id) => providers[id].source === "env");
    if (firstEnv) provider = { value: firstEnv, source: "detected", locked: false };
  }
  if (provider.value !== "planner" && !PROVIDERS.includes(provider.value)) throw new Error(`AI_ANALYST_PROVIDER must be one of ${["planner", ...PROVIDERS].join(", ")}.`);
  const active = provider.value === "planner" || !providers[provider.value].set ? null : providers[provider.value];
  if (has("AI_ANALYST_MODEL") && active) active.model = env.AI_ANALYST_MODEL;

  // The currency money is written in (ISO 4217). TRY on the demo; AI_ANALYST_CURRENCY locks it.
  const cur = setting("AI_ANALYST_CURRENCY", typeof fromFile.currency === "string" ? fromFile.currency : null, "TRY");
  cur.value = String(cur.value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur.value)) throw new Error(`AI_ANALYST_CURRENCY must be an ISO 4217 code such as TRY or USD, not "${cur.value}".`);

  const helpOn = pick("AI_ANALYST_HELP", fromFile.help, "on") !== "off";
  const allowed = [...(fromFile.allowedHosts ?? []), ...(has("AI_ANALYST_ALLOWED_HOSTS") ? env.AI_ANALYST_ALLOWED_HOSTS.split(",") : [])].map((h) => h.trim().toLowerCase()).filter(Boolean);

  return {
    configFile,
    cwd,
    env,
    file: fromFile,
    port,
    host: pick("HOST", fromFile.host, "127.0.0.1"),
    allowedHosts: allowed,
    token: has("AI_ANALYST_TOKEN") ? env.AI_ANALYST_TOKEN : null,
    dataDir,
    packDir: path.resolve(cwd, pick("AI_ANALYST_PACK_DIR", fromFile.packDir, ROOT)),
    warehouse,
    warehouseSetting: { ...wh, value: warehouse === "bigquery" ? "bigquery" : "demo" },
    bigquery: {
      project: dataProject,
      jobProject: pick("BIGQUERY_JOB_PROJECT", bq.jobProject, null) || dataProject,
      dataset: pick("BIGQUERY_DATASET", bq.dataset, null),
      location: pick("BIGQUERY_LOCATION", bq.location, "EU"),
      auth: bq.auth ?? { kind: has("GOOGLE_APPLICATION_CREDENTIALS") ? "key_file" : "adc", path: env.GOOGLE_APPLICATION_CREDENTIALS || null, impersonate: null },
      maxBytes,
      ceiling,
      maxBytesSource: has("BIGQUERY_MAX_BYTES") ? "env" : fileCap ? "file" : "default",
      checkedAt: bq.checkedAt ?? null,
      jobTimeoutMs: Number(pick("BIGQUERY_JOB_TIMEOUT_MS", bq.jobTimeoutMs, 60000)),
    },
    // The tables exploratory answers may read (Settings › Data source; AI_ANALYST_EXPLORE_ALLOW locks the list).
    explore: loadExploreConfig(env, fromFile),
    providers,
    provider,
    model: has("AI_ANALYST_MODEL") ? env.AI_ANALYST_MODEL : active ? active.model || MODEL_DEFAULT[active.id] : DEFAULT_MODEL,
    // Kept for the Anthropic path and older callers.
    anthropicApiKey: provider.value === "anthropic" && providers.anthropic.source && !providers.anthropic.cloud ? providers.anthropic.key : null,
    cloud,
    // null: named after the data (workspaceName). The demo name is only ever used on demo data.
    workspace: pick("AI_ANALYST_WORKSPACE", fromFile.workspace, null) || null,
    help: helpOn ? { email: pick("AI_ANALYST_HELP_EMAIL", fromFile.helpEmail, "hello@analitikisler.com") } : null,
    // The language the workspace reports in; seeded content and the terminal use it.
    currency: cur.value,
    currencySetting: cur,
    language: pick("AI_ANALYST_LANG", fromFile.language, "en") === "tr" ? "tr" : "en",
  };
}

export const DEMO_WORKSPACE = "Örnek Moda";
/** The workspace name: the configured one, else the demo shop on demo data, else the BigQuery dataset or project. */
export function workspaceName(config, warehouse) {
  if (config.workspace) return config.workspace;
  if (!warehouse || warehouse.demo !== false) return DEMO_WORKSPACE;
  const bq = config.bigquery ?? {};
  return bq.dataset || bq.project || "BigQuery";
}
