// Configuration: environment first, then ai-analyst.config.json in the working directory.
// Credentials (ANTHROPIC_API_KEY, GOOGLE_APPLICATION_CREDENTIALS) only ever come from the
// environment, so the config file can be committed.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_MODEL = "claude-opus-5-5";
const GB = 1024 ** 3;

/**
 * @param {{ env?: Record<string, string|undefined>, cwd?: string, file?: string }} [opts]
 */
export function loadConfig({ env = process.env, cwd = process.cwd(), file } = {}) {
  const configFile = file ?? path.join(cwd, "ai-analyst.config.json");
  let fromFile = {};
  if (existsSync(configFile)) {
    try {
      fromFile = JSON.parse(readFileSync(configFile, "utf8"));
    } catch (err) {
      throw new Error(`${configFile} is not valid JSON: ${err.message}`);
    }
  }
  const bq = fromFile.bigquery ?? {};
  const pick = (name, fileValue, fallback) => (env[name] !== undefined && env[name] !== "" ? env[name] : fileValue ?? fallback);

  const warehouse = pick("AI_ANALYST_WAREHOUSE", fromFile.warehouse, "duckdb");
  if (!["duckdb", "bigquery"].includes(warehouse)) throw new Error(`AI_ANALYST_WAREHOUSE must be duckdb or bigquery, not "${warehouse}".`);
  const port = Number(pick("PORT", fromFile.port, 8787));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT must be a port number, not "${port}".`);
  const maxBytes = Number(pick("BIGQUERY_MAX_BYTES", bq.maxBytes, 2 * GB));
  if (!(maxBytes > 0)) throw new Error("BIGQUERY_MAX_BYTES must be a positive number of bytes.");

  return {
    port,
    host: pick("HOST", fromFile.host, "127.0.0.1"),
    warehouse,
    dataDir: path.resolve(cwd, pick("AI_ANALYST_DATA_DIR", fromFile.dataDir, "./data")),
    packDir: path.resolve(cwd, pick("AI_ANALYST_PACK_DIR", fromFile.packDir, ROOT)),
    bigquery: {
      project: pick("BIGQUERY_PROJECT", bq.project, null),
      dataset: pick("BIGQUERY_DATASET", bq.dataset, null),
      location: pick("BIGQUERY_LOCATION", bq.location, "EU"),
      maxBytes,
    },
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    model: pick("AI_ANALYST_MODEL", fromFile.model, DEFAULT_MODEL),
    workspace: pick("AI_ANALYST_WORKSPACE", fromFile.workspace, "Örnek Moda"),
    // The language the workspace reports in; seeded content and scheduled text use it.
    language: pick("AI_ANALYST_LANG", fromFile.language, "en") === "tr" ? "tr" : "en",
  };
}
