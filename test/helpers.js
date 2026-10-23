// A demo workspace in a temporary folder, built the way `ai-analyst serve` builds it.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import "../src/actions/index.js";
import { loadConfig } from "../src/config.js";
import { openWorkspace } from "../src/workspace.js";

/** Model keys from the caller's shell must never reach a test. */
export const testEnv = (extra = {}) => ({ AI_ANALYST_DATA_DIR: "", PORT: "", ...extra });

/** @param {{ seed?: boolean }} [opts] seed: also seed the demo workspace (pins, a turn, a check run). */
export async function demoWorkspace({ seed = true } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "ai-analyst-"));
  const config = { ...loadConfig({ env: testEnv({ AI_ANALYST_DATA_DIR: dir }), cwd: dir }), anthropicApiKey: null };
  const ws = await openWorkspace(config, { seed: true, workspace: seed });
  ws.dir = dir;
  return ws;
}

/** ctx for callAction. */
export const ctxFor = (ws, actor = "person", extra = {}) => ({ actor, lang: "en", store: ws.store, warehouse: ws.warehouse, pack: ws.pack, config: ws.config, turn: null, ...extra });
