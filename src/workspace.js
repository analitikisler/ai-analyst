// The running workspace ("app"): the config, the pack, the warehouse, the app database, and the two changes
// that swap parts of it while it runs (a new data source, a rebuilt demo). Everything that needs these reads
// them from the app object at call time, so a swap is seen by the next request.
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { buildDemoWarehouse } from "./demo/seed.js";
import { seedWorkspace } from "./demo/workspace.js";
import { setCurrency } from "./format.js";
import { loadPack } from "./metrics/load.js";
import { Store } from "./store/store.js";
import { demoFile, openWarehouse } from "./warehouse/index.js";

export const appDbFile = (config) => path.join(config.dataDir, "app.db");

/**
 * @param {object} config from loadConfig()
 * @param {{ seed?: boolean, workspace?: boolean, bigQueryClient?: any, modelClient?: any, fetch?: Function, bigQueryTester?: Function, anthropicFactory?: Function }} [opts]
 *   seed: build the demo mart if it is missing. workspace: seed the workspace once (default: same as seed).
 *   The rest are stand-ins for outside systems, for tests.
 */
export async function openWorkspace(config, opts = {}) {
  const { seed = false, workspace = seed } = opts;
  setCurrency(config.currency);
  const pack = loadPack(config.packDir);
  const { warehouse, seeded } = await openWarehouse(config, { seedIfMissing: seed, bigQueryClient: opts.bigQueryClient });
  const store = new Store(appDbFile(config));
  store.pruneExplore(30);
  const app = {
    config,
    pack,
    warehouse,
    store,
    modelClient: opts.modelClient ?? null,
    fetch: opts.fetch ?? null,
    bigQueryTester: opts.bigQueryTester ?? null,
    anthropicFactory: opts.anthropicFactory ?? null,
    seeded: { warehouse: seeded, workspace: false },
    /** Takes a reloaded config; reopens the warehouse when the data source or its settings changed. */
    async applyConfig(next) {
      const before = JSON.stringify([app.config.warehouse, app.config.bigquery]);
      app.config = next;
      setCurrency(next.currency);
      if (JSON.stringify([next.warehouse, next.bigquery]) === before) return;
      const old = app.warehouse;
      const { warehouse: wh } = await openWarehouse(next, { seedIfMissing: true, bigQueryClient: opts.bigQueryClient });
      app.warehouse = wh;
      old.close();
      await seedWorkspace(app);
      // The strip shows the new source's checks; a failure here is logged, the switch stands.
      const { runAllChecks } = await import("./actions/data.js");
      await runAllChecks({ store: app.store, warehouse: app.warehouse, pack: app.pack }, 14, "system").catch((err) => err?.code === "no_data" || console.error("[ai-analyst] checks after the switch:", err.message));
    },
    /** Reopens the warehouse from its file (the local source after a sync), then runs the checks on it. */
    async reloadWarehouse() {
      const old = app.warehouse;
      app.warehouse = (await openWarehouse(app.config, {})).warehouse;
      old.close();
      const { runAllChecks } = await import("./actions/data.js");
      await runAllChecks({ store: app.store, warehouse: app.warehouse, pack: app.pack }, 14, "system").catch((err) => err?.code === "no_data" || console.error("[ai-analyst] checks after the sync:", err.message));
    },
    /** Rebuilds the demo mart; on demo data also empties the workspace (preferences stay) and seeds it again. */
    async rebuildDemo() {
      const isDemo = app.warehouse.demo;
      if (isDemo) app.warehouse.close();
      await buildDemoWarehouse(demoFile(app.config));
      if (isDemo) app.warehouse = (await openWarehouse(app.config, {})).warehouse;
      // On own data only the demo file is rebuilt; the workspace (conversations, dashboards) stays.
      if (!isDemo) return;
      app.store.reset({ keepMeta: ["preferences"] });
      await seedWorkspace(app);
    },
    close() {
      app.warehouse.close();
      app.store.close();
    },
  };
  if (workspace) app.seeded.workspace = await seedWorkspace(app);
  return app;
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
