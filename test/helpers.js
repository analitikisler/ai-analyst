// A demo workspace in a temporary folder, built the way `ai-analyst serve` builds it.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import "../src/actions/index.js";
import { loadConfig } from "../src/config.js";
import { openWorkspace } from "../src/workspace.js";

/** Model keys and settings from the caller's shell must never reach a test: only these variables are seen. */
export const testEnv = (extra = {}) => ({ ...extra });

/**
 * @param {{ seed?: boolean, env?: object, ...opts }} [o] seed: also seed the workspace (dashboard, check run, demo
 *   events). The rest go to openWorkspace (modelClient, fetch, bigQueryTester, anthropicFactory stubs).
 */
export async function demoWorkspace({ seed = true, env = {}, ...opts } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "ai-analyst-"));
  const config = loadConfig({ env: testEnv({ AI_ANALYST_DATA_DIR: dir, ...env }), cwd: dir });
  const ws = await openWorkspace(config, { seed: true, workspace: seed, ...opts });
  ws.dir = dir;
  return ws;
}

/** ctx for callAction. */
export const ctxFor = (ws, actor = "person", extra = {}) => ({ actor, lang: "en", app: ws, turn: null, ...extra });

/** Drops what differs between any two runs (ids, times, durations), for comparing results. */
const VOLATILE = new Set(["id", "ran_at", "created_at", "updated_at", "at", "turn_id", "conversation_id", "started_at", "finished_at", "decided_at", "activity_id", "test_id", "seconds", "handmade", "query_id", "check_id", "proposal_id", "answer_id", "tile_id", "metric_id"]);
export function normalize(v, drop = new Set()) {
  if (Array.isArray(v)) return v.map((x) => normalize(x, drop));
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (VOLATILE.has(k) || drop.has(k)) continue;
      const x = normalize(v[k], drop);
      if (x === undefined || x === null) continue; // absent and null read the same
      out[k] = x;
    }
    return out;
  }
  if (typeof v === "number") return Number(v.toPrecision(10));
  return v;
}
