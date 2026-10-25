// GET /api/state: everything the app shell needs in one read (AppState in the contract).
import { workspaceInfo } from "./actions/catalogue.js";
import { listEvents } from "./actions/events.js";
import { conversationSummary } from "./actions/workspace.js";
import { agentMode } from "./agent/mode.js";
import { listDashboards } from "./dashboards.js";
import { listOverlay } from "./metrics/overlay.js";
import { preferences } from "./settings.js";
import { SOURCE_LABEL } from "./text.js";
import { workspaceName } from "./config.js";
import { connectorStates, remoteStates, waitlist } from "./connectors/index.js";

/** A finding confirmed by a failing audit of its check says so, even on a run stored before the audit. */
function withAudit(store, c) {
  const a = store.list("audits", { limit: 50 }).find((x) => x.check === c.check && x.status !== "handoff" && x.result && !x.result.ok);
  if (!a) return c;
  return { ...c, findings: c.findings.map((fd) => (fd.since ? { ...fd, confirmed: { audit_id: a.id, at: a.finished_at } } : fd)) };
}

/** @param {object} app the workspace @param {{ loopback?: boolean }} [o] */
export async function buildState(app, { loopback = true } = {}) {
  const { store, config } = app;
  // A source that cannot be reached must not take the shell down: Settings is where it gets fixed.
  let ws;
  let sourceError = null;
  try {
    ws = await workspaceInfo({ store, warehouse: app.warehouse, pack: app.pack, config });
  } catch (err) {
    if (err?.code !== "source_unavailable") throw err;
    sourceError = { code: err.code, message: err.message, params: err.params ?? {} };
    ws = { name: workspaceName(config, app.warehouse), demo: app.warehouse.demo, data_from: null, data_to: null, refreshed_at: null, rows: null };
  }
  const run = store.latestCheckRun();
  const watches = store.list("watches", { order: "ASC" });
  const proposals = store.list("proposals", { order: "ASC" });
  const dashboards = listDashboards(store);
  const bq = config.bigquery;
  const local = Boolean(app.warehouse.local);
  const bigquery = !app.warehouse.demo && !local;
  const own = bigquery || local;
  const overlayIds = new Set(listOverlay(config.dataDir).map((m) => m.id));
  return {
    workspace: ws,
    source: {
      kind: local ? "local" : bigquery ? "bigquery" : "demo",
      label: local ? SOURCE_LABEL.local : bigquery ? SOURCE_LABEL.bigquery(bq.project) : SOURCE_LABEL.demo,
      project: bigquery ? bq.project : null,
      table: bigquery ? `${bq.project}.${bq.dataset}` : null,
      error: sourceError,
    },
    // Every money figure in the app is written in this (ISO 4217).
    currency: config.currency,
    agent: agentMode(app),
    // The "find the cause" email is offered on own data only; the demo's gap is planted.
    offer: { help_email: own && config.help ? config.help.email : null, cloud_email: "hello@analitikisler.com" },
    preferences: preferences(store),
    badges: { checks_changed: watches.filter((w) => w.changed).length, waiting: proposals.filter((p) => p.status === "pending").length },
    dashboards: dashboards.map((d) => ({ id: d.id, name: d.name, example: d.example, tiles: d.tiles.length })),
    pins: dashboards.flatMap((d) => d.tiles.filter((t) => t.answer_id).map((t) => ({ answer_id: t.answer_id, dashboard_id: d.id, tile_id: t.id }))),
    watches,
    checks: (run?.results ?? []).map((c) => withAudit(store, c)),
    check_run: run ? { id: run.id, created_at: run.created_at, days: run.days, from: run.from, to: run.to, actor: run.actor } : null,
    activity: store.listActivity(100),
    proposals,
    conversations: store.listConversations().map((c) => conversationSummary(store, c)),
    host_is_loopback: loopback,
    events: listEvents(store, app.config),
    audits: store.list("audits", { limit: 10 }),
    // The prototype's "Simulate the tracking fix" does not exist here.
    audit_fixed: false,
    // The sources that feed the local source, and the connectors planned for ai cloud.
    // From another machine: no shop domain, property or file name (security review 3, L7).
    connectors: loopback ? connectorStates(app) : remoteStates(app),
    waitlist: waitlist(),
    metric_proposals: store.list("metric_proposals").filter((m) => m.status === "proposed" && !overlayIds.has(m.id)).length,
  };
}
