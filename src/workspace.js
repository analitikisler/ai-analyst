// Opens everything a command needs: the pack, the warehouse, the app database.
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { buildDemoWarehouse } from "./demo/seed.js";
import { seedWorkspace } from "./demo/workspace.js";
import { loadPack } from "./metrics/load.js";
import { Store } from "./store/store.js";
import { demoFile, openWarehouse } from "./warehouse/index.js";

export const appDbFile = (config) => path.join(config.dataDir, "app.db");

/**
 * @param {object} config from loadConfig()
 * @param {{ seed?: boolean, workspace?: boolean }} [opts] seed: build the demo mart if it is missing.
 *   workspace: seed a demo workspace once (default: same as seed).
 */
export async function openWorkspace(config, { seed = false, workspace = seed } = {}) {
  const pack = loadPack(config.packDir);
  const { warehouse, seeded } = await openWarehouse(config, { seedIfMissing: seed });
  const store = new Store(appDbFile(config));
  let seededWorkspace = false;
  if (workspace && warehouse.demo) seededWorkspace = await seedWorkspace({ store, warehouse, pack, config });
  const ws = {
    config,
    pack,
    warehouse,
    store,
    seeded: { warehouse: seeded, workspace: seededWorkspace },
    close() {
      ws.warehouse.close();
      ws.store.close();
    },
  };
  return ws;
}

/** Rebuilds the demo mart and starts a fresh app database. */
export async function resetDemo(config) {
  const rows = await buildDemoWarehouse(demoFile(config));
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = appDbFile(config) + suffix;
    if (existsSync(f)) rmSync(f);
  }
  return rows;
}
