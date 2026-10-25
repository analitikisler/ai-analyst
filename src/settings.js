// Writing settings: non-secret ones to ai-analyst.config.json (unknown keys kept), model keys to
// <data_dir>/secrets.json with mode 0600. Keys never leave this module except as a short hint
// ("…7f3a"). A field set by an environment variable is locked: writing it is refused.
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AppError } from "./errors.js";
import { loadConfig, MODEL_DEFAULT, PROVIDERS, secretsFile, VERSION } from "./config.js";
import { martKey } from "./explore/allow.js";

function writeAtomic(file, text, mode) {
  mkdirSync(path.dirname(file), { recursive: true, ...(mode ? { mode: 0o700 } : {}) });
  // An unpredictable name, created exclusively, so nothing else can be waiting at that path.
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, text, { mode, flag: "wx" });
  if (mode) chmodSync(tmp, mode); // umask can strip bits from the create mode
  renameSync(tmp, file);
}

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});

/** Applies mutate(fileObject) to ai-analyst.config.json and returns the reloaded config. */
export function updateConfigFile(config, mutate) {
  const current = readJson(config.configFile);
  mutate(current);
  writeAtomic(config.configFile, `${JSON.stringify(current, null, 2)}\n`);
  return reload(config);
}

/** Saves (or with key null removes) one provider's key in secrets.json, mode 0600. */
export function writeSecret(config, provider, key) {
  const file = secretsFile(config.dataDir);
  const current = readJson(file);
  current.version = 1;
  current.providers ??= {};
  if (key == null) delete current.providers[provider];
  else current.providers[provider] = { key, saved_at: new Date().toISOString() };
  writeAtomic(file, `${JSON.stringify(current, null, 2)}\n`, 0o600);
  return reload(config);
}

/** Saves (or with values null removes) one connector's secrets in secrets.json under connectors, mode 0600. */
export function writeConnectorSecret(config, connector, values) {
  const file = secretsFile(config.dataDir);
  const current = readJson(file);
  current.version = 1;
  current.connectors ??= {};
  if (values == null) delete current.connectors[connector];
  else current.connectors[connector] = { ...values, saved_at: new Date().toISOString() };
  writeAtomic(file, `${JSON.stringify(current, null, 2)}\n`, 0o600);
  return reload(config);
}

export const reload = (config) => loadConfig({ env: config.env, cwd: config.cwd, file: config.configFile });

export const keyHint = (key) => (key && key.length >= 8 ? `…${key.slice(-4)}` : key ? "…" : undefined);

/** Refuses to write a field the environment sets. */
export function assertUnlocked(locked, envName) {
  if (locked) throw new AppError("locked", `This is set by ${envName} in the environment, so it cannot be changed here.`, { params: { env: envName } });
}

const hostIsLoopback = (host) => ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);

/** The Settings shape (types.ts). */
export function settingsView(app) {
  const c = app.config;
  const bq = c.bigquery;
  const providers = PROVIDERS.map((id) => {
    const p = c.providers[id];
    return {
      id,
      set: p.set,
      source: p.source,
      locked: p.source === "env",
      ...(p.source === "env" ? { env: p.env } : {}),
      ...(p.key && !p.cloud ? { hint: keyHint(p.key) } : {}),
      model: p.model,
      base_url: id === "openai_compatible" ? p.base_url : null,
      last_test: p.last_test,
    };
  });
  const address = app.address ?? `http://${c.host === "0.0.0.0" ? "127.0.0.1" : c.host}:${c.port}`;
  return {
    server: { loopback: hostIsLoopback(c.host), config_file: c.configFile, data_dir: c.dataDir, pack_dir: c.packDir, address, version: VERSION },
    data_source: {
      kind: { value: c.warehouseSetting.value, source: c.warehouseSetting.source === "default" ? "default" : c.warehouseSetting.source, locked: c.warehouseSetting.locked, ...(c.warehouseSetting.env ? { env: c.warehouseSetting.env } : {}) },
      bigquery: bq.project && bq.dataset
        ? { data_project: bq.project, job_project: bq.jobProject === bq.project ? null : bq.jobProject, dataset: bq.dataset, location: bq.location, auth: { kind: bq.auth?.kind ?? "adc", path: bq.auth?.path ?? null, impersonate: bq.auth?.impersonate ?? null }, max_bytes: bq.maxBytes }
        : null,
      checked_at: bq.checkedAt,
      credentials: app.credentials ?? { adc_found: false, identity: null },
      max_bytes: { value: bq.maxBytes, ceiling: bq.ceiling, source: bq.maxBytesSource, locked: bq.maxBytesSource === "env", ...(bq.maxBytesSource === "env" ? { env: "BIGQUERY_MAX_BYTES" } : {}) },
      currency: { value: c.currency, source: c.currencySetting.source, locked: c.currencySetting.locked, ...(c.currencySetting.env ? { env: c.currencySetting.env } : {}) },
      explore: exploreView(app),
    },
    model: { provider: { value: c.provider.value, source: c.provider.source, locked: c.provider.locked, ...(c.provider.env ? { env: c.provider.env } : {}) }, providers },
    help: { on: Boolean(c.help), email: c.help?.email ?? "hello@analitikisler.com" },
    preferences: app.store ? preferences(app.store) : { make_it_yours: "shown", not_now: [] },
  };
}

/** The tables the agent may read on the source in use (contract: data_source.explore). */
export function exploreView(app) {
  const c = app.config;
  const ex = c.explore;
  const local = c.warehouse === "local";
  const demo = c.warehouse === "duckdb";
  // On the local source the agent reads the mart only.
  const list = local ? [] : demo ? ex.demoAllow : ex.allow;
  const protectedCols = {};
  const confirmed = [];
  for (const [k, v] of Object.entries(ex.protected ?? {})) {
    protectedCols[k] = v.columns;
    if (v.confirmed) confirmed.push(k);
  }
  return {
    allow: list.map(({ project, dataset, table, meta }) => ({ project, dataset, table, ...(meta ? { meta } : {}) })),
    allow_setting: { source: ex.source, locked: ex.locked, ...(ex.env ? { env: ex.env } : {}) },
    mart: demo || local ? martKey(c, true) : c.bigquery.project && c.bigquery.dataset ? martKey(c, false) : null,
    protected_columns: protectedCols,
    confirmed,
    descriptions: ex.descriptions ?? {},
    max_bytes_per_question: ex.maxBytesPerQuestion,
    // The demo file's own tables (an older demo file has the mart alone until it is rebuilt).
    demo_tables: demo && app.warehouse?.tables ? app.warehouse.tables() : null,
  };
}

export function preferences(store) {
  return { make_it_yours: "shown", not_now: [], ...(store.getMeta("preferences") ?? {}) };
}

export { MODEL_DEFAULT };
