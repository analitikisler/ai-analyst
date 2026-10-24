// A workspace's first view: the example dashboard, a tracking-check run and, on demo data, the demo's
// findings and events. Seeded once per app database, the way the approved prototype's seedDb() seeds it.
import { exampleDashboard, insertDashboard, listDashboards } from "../dashboards.js";
import { demoEvents } from "../actions/events.js";
import { ACT } from "../text.js";
import { seedFindings } from "./seed.js";

/** Seeds once per app database (and once more for demo extras after a switch to the demo). Returns true when it seeded. */
export async function seedWorkspace(app) {
  const { store, warehouse, pack } = app;
  let seeded = false;
  if (!store.getMeta("seeded_at")) {
    if (!listDashboards(store).length) insertDashboard(store, exampleDashboard(pack));
    store.setMeta("last_dashboard", "db_example");
    store.setMeta("seeded_at", new Date().toISOString());
    seeded = true;
  }
  if (warehouse.demo && !store.getMeta("demo_seeded_at")) {
    seedFindings(store);
    for (const e of demoEvents()) if (!store.get("events", e.id)) store.put("events", e);
    const range = await warehouse.range();
    store.logActivity({ actor: "system", action: "build_demo", detail: ACT.demo_built(range.from, range.to) });
    store.setMeta("demo_seeded_at", new Date().toISOString());
    seeded = true;
  }
  if (seeded && !store.latestCheckRun()) {
    const { runAllChecks } = await import("../actions/data.js");
    const run = await runAllChecks({ store, warehouse, pack }, 14, "system");
    store.logActivity({ actor: "system", action: "run_all_checks", detail: ACT.checks_run(run.results.length, run.results.filter((r) => r.verdict === "does_not_add_up").length) });
  }
  return seeded;
}
