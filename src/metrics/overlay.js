// Metrics accepted from exploratory answers live in <data_dir>/metrics/*.yaml, an overlay next to the pack.
// The shipped pack (metrics/*.yaml in the repo) is never written. An overlay metric is defined by the model's
// SQL, not by a column sum, so it is listed and shown on the Metrics page but not queried by run_query, and it
// stays "not checked" since no tracking check uses it.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";

const label = z.object({ en: z.string().min(1), tr: z.string().min(1) }).strict();
const overlaySchema = z
  .object({
    id: z.string().regex(/^metric_[a-z0-9]+$/),
    version: z.number().int().positive(),
    status: z.literal("accepted"),
    label,
    description: label,
    unit: z.enum(["count", "try", "pct", "ratio"]),
    source: z.literal("model"),
    sql: z.string().min(1),
    question: z.string(),
    answer_id: z.string().nullable(),
    conversation_id: z.string().nullable(),
    proposed_at: z.string(),
    accepted_at: z.string(),
    history: z.array(z.object({ version: z.number().int().nonnegative(), date: z.string(), actor: label, change: label }).strict()),
  })
  .strict();

export const overlayDir = (dataDir) => path.join(dataDir, "metrics");

/** Accepted overlay metrics; a file that does not parse is skipped with a warning, never fatal. */
export function listOverlay(dataDir) {
  const dir = overlayDir(dataDir);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
    try {
      const m = overlaySchema.parse(parse(readFileSync(path.join(dir, file), "utf8")));
      if (`${m.id}.yaml` === file) out.push(m);
    } catch (err) {
      console.error(`[ai-analyst] skipped ${path.join(dir, file)}: ${err.message.split("\n")[0]}`);
    }
  }
  return out;
}

export function writeOverlay(dataDir, metric) {
  const m = overlaySchema.parse(metric);
  const dir = overlayDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${m.id}.yaml`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `# Accepted from an exploratory answer in AI Analyst. Defined by the SQL below; no tracking check uses it.\n${stringify(m, { lineWidth: 0 })}`);
  renameSync(tmp, file);
  return file;
}
