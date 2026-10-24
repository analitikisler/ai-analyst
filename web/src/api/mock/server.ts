// The fixture API's server: the app database (conversations, dashboards and tiles, watches, proposals, activity,
// settings) in memory, saved to this browser so a reload keeps the session, and every action of 09-ux.md §6 with
// the shapes of 10-backend.md §2. Figures come from engine.ts (the real demo mart); writes log activity with an
// undo record; outside systems (BigQuery, model providers, chat apps) answer with the scripted results of
// 09-ux.md F8 to F10. Nothing here makes a network request.
import { addDays } from "@/lib/dates";
import { ApiError } from "../client";
import type {
  Actions,
  Activity,
  AuditRun,
  ChartEvent,
  MetricEntry,
  MetricPage,
  Answer,
  AppState,
  AskEvent,
  AskRequest,
  BigQueryConfig,
  BqStep,
  BqTest,
  ChartType,
  ChatAppCall,
  ChatAppSetup,
  CheckDetail,
  CheckId,
  CheckRun,
  Compare,
  Conversation,
  Dashboard,
  DashboardResult,
  Lang,
  ModelTestResult,
  Preferences,
  Proposal,
  ProviderId,
  ProviderStatus,
  Settings,
  Text,
  Tile,
  TileQuery,
  TileResult,
  Turn,
  Watch,
} from "../types";
import { checkHistory, comparisonWindow, MART_ROWS, newId, RANGE, reconcile, resolvePeriod, runQuery, validCharts, widthRules } from "./engine";
import { CHECKS, METRICS } from "./pack";
import { plan } from "./planner";
import { exploreQuery, runExplore } from "./explore";
import { runAudit } from "./audit";
import { checksUsing, definitionRows, gtmImport, historyOf, seedEvents } from "./catalogue";
import { METRIC_PROPOSED } from "./text";
import { ACT, APPROVAL, CHART_NAMES, COMPARE_NAMES, EXPLORE_Q, f, FOLLOW_POOL, KNOWN_QUESTIONS, PERIOD_NAMES, PLANNER_TEXT, SOURCE_LABEL, SUGGEST, T } from "./text";

// ---------------------------------------------------------------- the database

const STORAGE_KEY = "ai-analyst:prototype-db:v7";
const SEED_AT = "2026-10-23T06:00:00.000Z"; // 09:00 in İstanbul, the demo build (09-ux.md S11)
const PROVIDER_LABEL: Record<ProviderId, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Google Gemini", openai_compatible: "OpenAI-compatible" };
const MODEL_DEFAULT: Record<ProviderId, string> = { anthropic: "claude-opus-5-5", openai: "gpt-5.5", gemini: "gemini-pro-latest", openai_compatible: "" };
const MODEL_LABEL: Record<string, string> = { "claude-opus-5-5": "Claude Opus 5.5", "gpt-5.5": "GPT-5.5", "gemini-pro-latest": "Gemini Pro" };

type UndoRecord =
  | { kind: "tile_add"; tile_id: string }
  | { kind: "tile_update"; tile: Tile }
  | { kind: "tile_remove"; tile: Tile; index: number }
  | { kind: "tile_order"; dashboard_id: string; order: string[] }
  | { kind: "period"; dashboard_id: string; period: Dashboard["period"]; compare: Compare }
  | { kind: "watch"; watch_id: string }
  | { kind: "unwatch"; watch: Watch }
  | { kind: "dashboard_create"; dashboard_id: string }
  | { kind: "dashboard_delete"; dashboard: Dashboard; index: number }
  | { kind: "dashboard_rename"; dashboard_id: string; name: Text }
  | { kind: "event_add"; event_id: string }
  | { kind: "event_update"; event: ChartEvent }
  | { kind: "event_delete"; event: ChartEvent }
  | { kind: "events_import"; ids: string[] };

/** A metric proposed from an exploratory answer (owner round 5), shown on the Metrics page. */
interface ProposedMetric {
  id: string;
  label: Text;
  description: Text;
  unit: MetricEntry["unit"];
  sql: string;
  question: string;
  answer_id: string | null;
  conversation_id: string | null;
  status: "proposed" | "accepted" | "declined";
  created_at: string;
  accepted_at: string | null;
}

interface Db {
  source: { kind: "demo" | "bigquery"; bigquery: BigQueryConfig | null; checked_at: string | null };
  max_bytes: number;
  providers: Record<ProviderId, { set: boolean; hint?: string; model: string | null; base_url?: string | null }>;
  active_provider: ProviderId | "planner";
  preferences: Preferences;
  conversations: Conversation[];
  proposals: Proposal[];
  watches: Watch[];
  activity: Activity[];
  undo: Record<string, UndoRecord>;
  dashboards: Dashboard[];
  last_dashboard: string;
  runs: CheckRun[];
  chat_calls: ChatAppCall[];
  bq_tests: Record<string, { ok: boolean; values: string }>;
  checks_seen_at: string;
  events: ChartEvent[];
  audits: AuditRun[];
  audit_fixed: boolean;
  metrics_proposed: ProposedMetric[];
}

const CHART_SIZE: Record<string, { w: 3 | 4 | 6 | 8 | 12; h: 1 | 2 }> = {};
void CHART_SIZE;

function seedTile(dashboard_id: string, id: string, title: Text, query: TileQuery, chart: ChartType, w: Tile["size"]["w"], h: Tile["size"]["h"]): Tile {
  return { id, dashboard_id, title, answer_id: null, query, chart, size: { w, h }, created_by: "demo", created_at: SEED_AT, version: 1 };
}

function seedDashboard(): Dashboard {
  const id = "db_example";
  return {
    id,
    name: T("Shop overview", "Mağaza özeti"),
    example: true,
    period: "last_28",
    compare: "previous_period",
    created_at: SEED_AT,
    updated_at: SEED_AT,
    version: 1,
    tiles: [
      seedTile(id, "pin_revenue", T("Revenue", "Ciro"), { type: "metric", metric: "revenue", group_by: "none" }, "number", 3, 1),
      seedTile(id, "pin_orders", T("Orders", "Sipariş"), { type: "metric", metric: "orders", group_by: "none" }, "number", 3, 1),
      seedTile(id, "pin_ga4", CHECKS.ga4_vs_orders.label, { type: "check", check: "ga4_vs_orders" }, "tally", 6, 2),
      seedTile(id, "pin_meta", CHECKS.meta_vs_orders.label, { type: "check", check: "meta_vs_orders" }, "tally", 6, 1),
      seedTile(id, "pin_rev_day", T("Revenue by day", "Günlük ciro"), { type: "metric", metric: "revenue", group_by: "day" }, "line", 8, 2),
      seedTile(id, "pin_roas", T("ROAS by channel", "Kanala göre ROAS"), { type: "metric", metric: "roas", group_by: "channel" }, "split_bar", 4, 2),
    ],
  };
}

function runChecks(days: number, actor: CheckRun["actor"], at: string): CheckRun {
  const to = RANGE.to;
  const from = addDays(to, -(days - 1));
  const results = (Object.keys(CHECKS) as CheckId[]).map((c) => reconcile(c, from, to));
  return { id: newId("run"), created_at: at, days, from, to, actor, results };
}

function seedDb(): Db {
  const run = runChecks(14, "system", SEED_AT);
  const bad = run.results.filter((r) => r.verdict === "does_not_add_up").length;
  const dash = seedDashboard();
  return {
    source: { kind: "demo", bigquery: null, checked_at: null },
    max_bytes: 2 * 1024 ** 3,
    providers: {
      anthropic: { set: false, model: null },
      openai: { set: false, model: null },
      gemini: { set: false, model: null },
      openai_compatible: { set: false, model: null, base_url: null },
    },
    active_provider: "planner",
    preferences: { make_it_yours: "shown", not_now: [] },
    conversations: [],
    proposals: [],
    watches: [],
    activity: [
      { id: "act_seed_run", at: SEED_AT, actor: "system", action: "run_all_checks", detail: ACT.checks_run(run.results.length, bad), undo: null, undone: false },
      { id: "act_seed_demo", at: SEED_AT, actor: "system", action: "build_demo", detail: ACT.demo_built(RANGE.from, RANGE.to), undo: null, undone: false },
    ],
    undo: {},
    dashboards: [dash],
    last_dashboard: dash.id,
    runs: [run],
    chat_calls: [],
    bq_tests: {},
    checks_seen_at: SEED_AT,
    events: seedEvents(),
    audits: [],
    audit_fixed: false,
    metrics_proposed: [],
  };
}

let db: Db = load();

function load(): Db {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Db;
  } catch {
    /* storage blocked or bad JSON: start fresh */
  }
  return seedDb();
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      /* the session still works in memory */
    }
  }, 50);
}

/** Back to the first run (the reviewer menu's "Reset prototype"). */
export function resetPrototype() {
  db = seedDb();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

const now = () => new Date().toISOString();
const clone = <T>(v: T): T => structuredClone(v);

function log(actor: Activity["actor"], action: string, detail: Text, undo?: UndoRecord, extra: Partial<Activity> = {}): Activity {
  const id = newId("act");
  const entry: Activity = { id, at: now(), actor, action, detail, undo: undo ? { type: undo.kind, id } : null, undone: false, ...extra };
  if (undo) db.undo[id] = undo;
  db.activity = [entry, ...db.activity].slice(0, 200);
  return entry;
}

// ---------------------------------------------------------------- lookups

const dashboard = (id: string) => {
  const d = db.dashboards.find((x) => x.id === id);
  if (!d) throw new ApiError("not_found", `Unknown dashboard "${id}".`, 404);
  return d;
};
function findTile(id: string): { dash: Dashboard; tile: Tile; index: number } {
  for (const dash of db.dashboards) {
    const index = dash.tiles.findIndex((t) => t.id === id);
    if (index >= 0) return { dash, tile: dash.tiles[index]!, index };
  }
  throw new ApiError("not_found", `Unknown tile "${id}".`, 404);
}
function findAnswer(id: string): Answer | undefined {
  for (const c of db.conversations) for (const t of c.turn_list) for (const a of t.answers) if (a.id === id) return a;
  return undefined;
}
const touch = (d: Dashboard) => {
  d.updated_at = now();
  d.version += 1;
  d.example = false; // B09: the first change clears the Example badge
};

/** Exploratory answers are in effect when a model is set and the switch is not off (owner round 4). */
const exploring = () => !!agentModel() && db.preferences.exploratory !== "off";

function agentModel() {
  const p = db.active_provider;
  if (p === "planner" || !db.providers[p].set) return null;
  const model = db.providers[p].model ?? MODEL_DEFAULT[p];
  return { provider: p, model, label: T(MODEL_LABEL[model] ?? model, MODEL_LABEL[model] ?? model) };
}

// ---------------------------------------------------------------- dashboards

function tileResult(dash: Dashboard, tile: Tile): TileResult {
  const p = resolvePeriod(dash.period);
  const compare = dash.compare === "off" ? undefined : dash.compare;
  const base = { tile_id: tile.id, from: p.from, to: p.to, valid_charts: validCharts(tile.query), width_rules: Object.fromEntries((["number", "line", "column", "stacked_column", "area", "table", "tally", "split_bar", "both_lines"] as ChartType[]).map((c) => [c, widthRules(c)])) as TileResult["width_rules"], ran_at: now(), cached: false, data_to: RANGE.to };
  if (tile.query.type === "check") {
    const check = reconcile(tile.query.check, p.from, p.to, tile.query.filters);
    const w = compare ? comparisonWindow(p.from, p.to, compare, p.monthToDate) : null;
    return { ...base, check: withAudit(check), previous_check: w ? reconcile(tile.query.check, w.from, w.to, tile.query.filters, { seriesLead: 0 }) : null };
  }
  if (tile.query.type === "explore") {
    const x = runExplore(tile.query.spec);
    return { ...base, from: x.spec.from, to: x.spec.to, explore: x, query: exploreQuery(x) };
  }
  const q = tile.query;
  const query = runQuery({ metric: q.metric, group_by: q.group_by, from: p.from, to: p.to, filters: q.filters, compare, month_to_date: p.monthToDate });
  const series = q.group_by === "none" ? runQuery({ metric: q.metric, group_by: "day", from: p.from, to: p.to, filters: q.filters }) : undefined;
  return { ...base, query, series };
}

function getDashboard(id: string): DashboardResult {
  const dash = dashboard(id);
  db.last_dashboard = id;
  const p = resolvePeriod(dash.period);
  const w = dash.compare === "off" ? null : comparisonWindow(p.from, p.to, dash.compare, p.monthToDate);
  return {
    dashboard: clone(dash),
    from: p.from,
    to: p.to,
    compare_from: w?.from ?? null,
    compare_to: w?.to ?? null,
    compare_note: dash.compare !== "off" && !w ? "no_data" : null,
    data_to: RANGE.to,
    tiles: dash.tiles.map((t) => tileResult(dash, t)),
    checks: (Object.keys(CHECKS) as CheckId[]).map((c) => withAudit(reconcile(c, p.from, p.to))),
  };
}

/** The tile a pinned answer becomes: the query (not the frozen answer), the grammar's default chart and size. */
function tileFromAnswer(a: Answer, dashboard_id: string): Tile {
  const base = { id: newId("pin"), dashboard_id, answer_id: a.id, created_by: "person" as const, created_at: now(), version: 1 };
  if (a.explore) {
    const shape = a.explore.shape;
    const chart: ChartType = shape === "number" ? "number" : shape === "series" ? "column" : shape === "category" ? "split_bar" : "table";
    return { ...base, title: a.title, query: { type: "explore", spec: a.explore.spec }, chart, size: shape === "number" ? { w: 3, h: 1 } : { w: 6, h: 2 } };
  }
  if (a.check) {
    const ck = CHECKS[a.check.check];
    if (a.kind === "check_split") {
      return { ...base, title: ck.id === "ga4_vs_orders" ? T("GA4 against orders by device", "Cihaza göre GA4 ve siparişler") : { en: `${ck.label.en} by device`, tr: `Cihaza göre ${ck.label.tr}` }, query: { type: "check", check: ck.id, split: "device" }, chart: "split_bar", size: { w: 6, h: 1 } };
    }
    return { ...base, title: ck.label, query: { type: "check", check: ck.id }, chart: "tally", size: { w: 6, h: 1 } };
  }
  const q = a.query;
  const m = METRICS[q.metric];
  const g = q.group_by;
  const title: Text =
    g === "none" ? m.label : g === "channel" ? { en: `${m.label.en} by channel`, tr: `Kanala göre ${m.label.tr.toLocaleLowerCase("tr")}` } : g === "device" ? { en: `${m.label.en} by device`, tr: `Cihaza göre ${m.label.tr.toLocaleLowerCase("tr")}` } : g === "week" ? { en: `${m.label.en} by week`, tr: `Haftalık ${m.label.tr.toLocaleLowerCase("tr")}` } : { en: `${m.label.en} by day`, tr: `Günlük ${m.label.tr.toLocaleLowerCase("tr")}` };
  const chart: ChartType = g === "none" ? "number" : g === "channel" || g === "device" ? "split_bar" : g === "week" || g === "month" ? "column" : "line";
  const size = chart === "number" ? { w: 3 as const, h: 1 as const } : chart === "split_bar" ? { w: 4 as const, h: 2 as const } : { w: 6 as const, h: 2 as const };
  return { ...base, title, query: { type: "metric", metric: q.metric, group_by: g, filters: q.filters }, chart, size };
}

function pinAnswer(answer_id: string, dashboard_id?: string, actor: Activity["actor"] = "person") {
  const a = findAnswer(answer_id);
  if (!a) throw new ApiError("not_found", `Unknown answer "${answer_id}".`, 404);
  const dash = dashboard(dashboard_id ?? db.last_dashboard ?? db.dashboards[0]!.id);
  const existing = dash.tiles.find((t) => t.answer_id === answer_id);
  if (existing) {
    const act = db.activity.find((x) => db.undo[x.id]?.kind === "tile_add" && (db.undo[x.id] as { tile_id: string }).tile_id === existing.id);
    return { tile: clone(existing), activity_id: act?.id ?? "" };
  }
  const tile = tileFromAnswer(a, dash.id);
  dash.tiles.push(tile);
  touch(dash);
  const act = log(actor, "pin_answer", ACT.pinned(tile.title, dash.name), { kind: "tile_add", tile_id: tile.id });
  return { tile: clone(tile), activity_id: act.id };
}

// ---------------------------------------------------------------- settings

const bqKey = (v: BigQueryConfig) => JSON.stringify([v.data_project.trim(), (v.job_project || v.data_project).trim(), v.dataset.trim(), v.auth.kind, v.auth.path ?? "", v.auth.impersonate ?? ""]);

function testBigQuery(v: BigQueryConfig): BqTest {
  const identity = v.auth.impersonate?.trim() || "analyst@ornekmoda.example";
  const jobProject = (v.job_project || v.data_project).trim();
  const steps: BqStep[] = [];
  const skipRest = (from: number) => {
    const ids: BqStep["id"][] = ["credentials", "jobs", "dataset", "table", "read", "cost"];
    for (const id of ids.slice(from)) steps.push({ id, status: "skipped" });
  };
  if (v.auth.kind === "key_file") {
    const path = (v.auth.path ?? "").trim();
    if (!path.endsWith(".json")) {
      steps.push({ id: "credentials", status: "failed", error: { code: path ? "keyfile_type" : "keyfile_read", params: { path: path || "–" } } });
      skipRest(1);
      return finish(v, steps, null);
    }
    steps.push({ id: "credentials", status: "ok", detail: { identity: "ai-analyst-reader@ornek-moda-data.iam.gserviceaccount.com", method: "key_file" } });
  } else steps.push({ id: "credentials", status: "ok", detail: { identity, method: "adc" } });

  // Scripted (09-ux.md F8): the signed-in identity has BigQuery Job User only in the analytics project.
  if (!jobProject || jobProject === v.data_project.trim()) {
    steps.push({ id: "jobs", status: "failed", detail: { project: jobProject }, error: { code: "no_jobs", params: { id: identity, p: jobProject } } });
    skipRest(2);
    return finish(v, steps, null);
  }
  steps.push({ id: "jobs", status: "ok", detail: { project: jobProject } });
  if (v.dataset.trim() !== "ai_analyst") {
    steps.push({ id: "dataset", status: "failed", error: { code: "dataset_not_found", params: { p: v.data_project, d: v.dataset, loc: "EU", id: identity } } });
    skipRest(3);
    return finish(v, steps, null);
  }
  steps.push({ id: "dataset", status: "ok", detail: { project: v.data_project, dataset: v.dataset, location: "EU" } });
  steps.push({ id: "table", status: "ok", detail: { table: "daily_channel_device", n: 10, time: "2026-10-23T03:00:00.000Z" } });
  steps.push({ id: "read", status: "ok", detail: { from: "2026-01-01", to: RANGE.to, rows: 3540 } });
  steps.push({ id: "cost", status: "ok", detail: { bytes: 4.1 * 1024 ** 2, cap: v.max_bytes } });
  return finish(v, steps, "EU");
}

function finish(v: BigQueryConfig, steps: BqStep[], location: string | null): BqTest {
  const ok = steps.every((s) => s.status === "ok");
  const test_id = newId("t");
  db.bq_tests[test_id] = { ok, values: bqKey(v) };
  return { test_id, ok, steps, detected: { location }, values: clone(v) };
}

function testModel(input: Actions["test_model_key"]["input"]): ModelTestResult {
  const { provider, model } = input;
  const key = (input.key ?? "").trim();
  // A test without a key tests the saved one (the key never comes back to the browser).
  if (!input.key && provider !== "openai_compatible") return db.providers[provider].set ? { ok: true, provider, model, seconds: 1.2 } : { ok: false, provider, model, error: { code: "key_rejected", status: 401 } };
  const prefixes: Record<ProviderId, string[]> = { anthropic: ["claude-"], openai: ["gpt-", "o"], gemini: ["gemini-"], openai_compatible: [""] };
  if (provider === "openai_compatible") {
    const url = (input.base_url ?? "").trim();
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) return { ok: false, provider, model, error: { code: "unreachable", detail: url } };
    if (!model.trim()) return { ok: false, provider, model, error: { code: "model_not_found" } };
    return { ok: true, provider, model, seconds: 0.9 };
  }
  // Scripted (09-ux.md F9): a key starting "sk-ant-" works for Anthropic; OpenAI keys start "sk-", Gemini keys "AIza".
  const keyOk = provider === "anthropic" ? key.startsWith("sk-ant-") : provider === "openai" ? key.startsWith("sk-") && !key.startsWith("sk-ant-") : key.startsWith("AIza");
  if (!keyOk) return { ok: false, provider, model, error: { code: "key_rejected", status: 401, detail: "invalid_api_key" } };
  if (!prefixes[provider].some((p) => model.startsWith(p))) return { ok: false, provider, model, error: { code: "model_not_found", status: 404 } };
  return { ok: true, provider, model, seconds: 1.4 };
}

function settings(): Settings {
  const providers: ProviderStatus[] = (Object.keys(db.providers) as ProviderId[]).map((id) => ({
    id,
    set: db.providers[id].set,
    source: db.providers[id].set ? "saved" : null,
    locked: false,
    hint: db.providers[id].hint,
    model: db.providers[id].model,
    base_url: db.providers[id].base_url ?? null,
  }));
  return {
    server: {
      loopback: true,
      config_file: "/Users/demo/ai-analyst/ai-analyst.config.json",
      data_dir: "/Users/demo/ai-analyst/data",
      pack_dir: "/Users/demo/ai-analyst",
      address: "http://127.0.0.1:8787",
      version: "0.2.0",
    },
    data_source: {
      kind: { value: db.source.kind, source: db.source.kind === "demo" ? "default" : "file", locked: false },
      bigquery: clone(db.source.bigquery),
      checked_at: db.source.checked_at,
      credentials: { adc_found: true, identity: "analyst@ornekmoda.example" },
      max_bytes: { value: db.max_bytes, ceiling: 2 * 1024 ** 3, source: db.max_bytes === 2 * 1024 ** 3 ? "default" : "file", locked: false },
    },
    model: { provider: { value: db.active_provider, source: db.active_provider === "planner" ? "default" : "file", locked: false }, providers },
    help: { on: true, email: "hello@analitikisler.com" },
    preferences: clone(db.preferences),
  };
}

const NODE = "/usr/local/bin/node";
const REPO = "/Users/demo/ai-analyst";
function chatSetup(client: ChatAppSetup["client"]): ChatAppSetup {
  const env = { AI_ANALYST_CONFIG: `${REPO}/ai-analyst.config.json`, AI_ANALYST_DATA_DIR: `${REPO}/data` };
  if (client === "claude-desktop" || client === "cursor") {
    const json = JSON.stringify({ mcpServers: { "ai-analyst": { command: NODE, args: [`${REPO}/src/cli.js`, "mcp"], env } } }, null, 2);
    return {
      client,
      kind: "config",
      snippet: json,
      config_path: client === "claude-desktop" ? { mac: "~/Library/Application Support/Claude/claude_desktop_config.json", windows: "%APPDATA%\\Claude\\claude_desktop_config.json" } : { mac: "~/.cursor/mcp.json" },
    };
  }
  const flag = client === "claude-code" ? "-e" : "--env";
  const cmd = client === "claude-code" ? "claude mcp add ai-analyst" : "codex mcp add ai-analyst";
  return { client, kind: "command", snippet: `${cmd} ${flag} AI_ANALYST_CONFIG=${env.AI_ANALYST_CONFIG} ${flag} AI_ANALYST_DATA_DIR=${env.AI_ANALYST_DATA_DIR} -- ${NODE} ${REPO}/src/cli.js mcp` };
}

// ---------------------------------------------------------------- undo

function undoLabel(entry: Activity): Text {
  return entry.detail;
}

function applyUndo(entry: Activity): void {
  const rec = db.undo[entry.id];
  if (!rec) throw new ApiError("not_undoable", "Only changes with an undo can be undone.");
  const gone = () => {
    entry.undo_gone = true;
    throw new ApiError("undo_gone", "What it changed was removed since.", 409);
  };
  switch (rec.kind) {
    case "tile_add": {
      const hit = db.dashboards.find((d) => d.tiles.some((t) => t.id === rec.tile_id));
      if (!hit) gone();
      hit!.tiles = hit!.tiles.filter((t) => t.id !== rec.tile_id);
      touch(hit!);
      break;
    }
    case "tile_update": {
      const hit = db.dashboards.find((d) => d.tiles.some((t) => t.id === rec.tile.id));
      if (!hit) gone();
      hit!.tiles = hit!.tiles.map((t) => (t.id === rec.tile.id ? clone(rec.tile) : t));
      touch(hit!);
      break;
    }
    case "tile_remove": {
      const d = db.dashboards.find((x) => x.id === rec.tile.dashboard_id);
      if (!d) gone();
      d!.tiles.splice(Math.min(rec.index, d!.tiles.length), 0, clone(rec.tile));
      touch(d!);
      break;
    }
    case "tile_order": {
      const d = db.dashboards.find((x) => x.id === rec.dashboard_id);
      if (!d) gone();
      const byId = new Map(d!.tiles.map((t) => [t.id, t]));
      const ordered = rec.order.map((id) => byId.get(id)).filter(Boolean) as Tile[];
      d!.tiles = [...ordered, ...d!.tiles.filter((t) => !rec.order.includes(t.id))];
      touch(d!);
      break;
    }
    case "period": {
      const d = db.dashboards.find((x) => x.id === rec.dashboard_id);
      if (!d) gone();
      d!.period = rec.period;
      d!.compare = rec.compare;
      touch(d!);
      break;
    }
    case "watch":
      if (!db.watches.some((w) => w.id === rec.watch_id)) gone();
      db.watches = db.watches.filter((w) => w.id !== rec.watch_id);
      break;
    case "unwatch":
      db.watches.push(clone(rec.watch));
      break;
    case "dashboard_create":
      if (db.dashboards.length <= 1 || !db.dashboards.some((d) => d.id === rec.dashboard_id)) gone();
      db.dashboards = db.dashboards.filter((d) => d.id !== rec.dashboard_id);
      if (db.last_dashboard === rec.dashboard_id) db.last_dashboard = db.dashboards[0]!.id;
      break;
    case "dashboard_delete":
      db.dashboards.splice(Math.min(rec.index, db.dashboards.length), 0, clone(rec.dashboard));
      break;
    case "dashboard_rename": {
      const d = db.dashboards.find((x) => x.id === rec.dashboard_id);
      if (!d) gone();
      d!.name = rec.name;
      touch(d!);
      break;
    }
    case "event_add":
      if (!db.events.some((e) => e.id === rec.event_id)) gone();
      db.events = db.events.filter((e) => e.id !== rec.event_id);
      break;
    case "event_update":
      if (!db.events.some((e) => e.id === rec.event.id)) gone();
      db.events = db.events.map((e) => (e.id === rec.event.id ? clone(rec.event) : e));
      break;
    case "event_delete":
      db.events = [...db.events.filter((e) => e.id !== rec.event.id), clone(rec.event)];
      break;
    case "events_import":
      db.events = db.events.filter((e) => !rec.ids.includes(e.id));
      break;
  }
}

// ---------------------------------------------------------------- watches and proposals

function watch(check: CheckId, actor: Activity["actor"]): { watch: Watch; activity: Activity | null } {
  const existing = db.watches.find((w) => w.check === check);
  if (existing) return { watch: existing, activity: null };
  const latest = db.runs[db.runs.length - 1]?.results.find((r) => r.check === check);
  const w: Watch = { id: newId("w"), check, status: "active", created_by: actor, created_at: now(), last_verdict: latest?.verdict ?? "not_checked", changed: false };
  db.watches.push(w);
  const activity = log(actor === "agent" ? "person" : actor, "watch_check", ACT.watch(CHECKS[check].label), { kind: "watch", watch_id: w.id });
  return { watch: w, activity };
}

// ---------------------------------------------------------------- state

function state(): AppState {
  const run = db.runs[db.runs.length - 1] ?? null;
  const model = agentModel();
  return {
    workspace: { name: "Örnek Moda", demo: db.source.kind === "demo", data_from: RANGE.from, data_to: RANGE.to, refreshed_at: SEED_AT, rows: MART_ROWS },
    source: {
      kind: db.source.kind,
      label: db.source.kind === "demo" ? SOURCE_LABEL.demo : SOURCE_LABEL.bigquery(db.source.bigquery?.data_project ?? ""),
      project: db.source.bigquery?.data_project ?? null,
      table: db.source.bigquery ? `${db.source.bigquery.data_project}.${db.source.bigquery.dataset}` : null,
    },
    agent: model
      ? { mode: "model", provider: model.provider, model: model.model, provider_label: PROVIDER_LABEL[model.provider], model_label: model.label.en, exploratory: exploring() }
      : { mode: "planner", provider: null, model: null, provider_label: null, model_label: null, exploratory: false },
    offer: { help_email: db.source.kind === "demo" ? null : "hello@analitikisler.com", cloud_email: "hello@analitikisler.com" },
    preferences: clone(db.preferences),
    badges: { checks_changed: db.watches.filter((w) => w.changed).length, waiting: db.proposals.filter((p) => p.status === "pending").length },
    dashboards: db.dashboards.map((d) => ({ id: d.id, name: d.name, example: d.example, tiles: d.tiles.length })),
    pins: db.dashboards.flatMap((d) => d.tiles.filter((t) => t.answer_id).map((t) => ({ answer_id: t.answer_id!, dashboard_id: d.id, tile_id: t.id }))),
    watches: clone(db.watches),
    checks: run ? clone(run.results).map(withAudit) : [],
    check_run: run ? { id: run.id, created_at: run.created_at, days: run.days, from: run.from, to: run.to, actor: run.actor } : null,
    activity: clone(db.activity.slice(0, 100)),
    proposals: clone(db.proposals),
    events: clone(db.events).sort((a, b) => a.date.localeCompare(b.date)),
    audits: clone(db.audits),
    audit_fixed: db.audit_fixed,
    metric_proposals: db.metrics_proposed.filter((m) => m.status === "proposed").length,
    conversations: db.conversations
      .map(({ turn_list, ...c }) => ({ ...c, turns: turn_list.length }))
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    host_is_loopback: true,
  };
}

// ---------------------------------------------------------------- actions

type Handler<N extends keyof Actions> = (input: Actions[N]["input"], lang: Lang) => Actions[N]["result"];

// ---------------------------------------------------------------- metrics page, events, audits (owner round 5)

/** A finding confirmed by the latest failing audit of its check carries the audit and its time. */
function withAudit<C extends { check: CheckId; findings: { since: string | null; confirmed?: { audit_id: string; at: string } | null }[] }>(c: C): C {
  const a = db.audits.find((x) => x.check === c.check);
  if (!a || !a.result || a.result.ok) return c;
  const at = a.finished_at ?? a.started_at;
  return { ...c, findings: c.findings.map((fd) => (fd.since ? { ...fd, confirmed: { audit_id: a.id, at } } : fd)) };
}

const packEntry = (id: string): MetricEntry => {
  const m = METRICS[id as keyof typeof METRICS];
  return { id, label: m.label, description: m.description, unit: m.unit, source: m.source, version: m.version, checks: checksUsing(id).map((x) => x.id), status: "active" };
};
const proposedEntry = (p: ProposedMetric): MetricEntry => ({ id: p.id, label: p.label, description: p.description, unit: p.unit, source: "model", version: 1, checks: [], status: p.status === "accepted" ? "accepted" : "proposed" });

function metricPage(id: string): MetricPage {
  const run = db.runs[db.runs.length - 1];
  if (id in METRICS) {
    const m = METRICS[id as keyof typeof METRICS];
    const series = runQuery({ metric: m.id, group_by: "day", from: addDays(RANGE.to, -89), to: RANGE.to });
    const sql = runQuery({ metric: m.id, from: addDays(RANGE.to, -27), to: RANGE.to }).sql;
    const checks = checksUsing(id).map(({ id: cid, role }) => {
      const r = run?.results.find((x) => x.check === cid) ?? reconcile(cid);
      return { id: cid, label: CHECKS[cid].label, role, verdict: r.verdict, delta_pct: r.delta_pct, from: r.from, to: r.to };
    });
    const used_in = db.dashboards.flatMap((d) =>
      d.tiles
        .filter((t) => (t.query.type === "metric" && t.query.metric === id) || (t.query.type === "check" && (CHECKS[t.query.check].expected.metric === id || CHECKS[t.query.check].measured.metric === id)))
        .map((t) => ({ dashboard_id: d.id, dashboard: d.name, tile_id: t.id, title: t.title })),
    );
    return { entry: packEntry(id), definition: definitionRows(m), sql, series, checks, used_in, history: historyOf(m.id), proposal: null };
  }
  const p = db.metrics_proposed.find((x) => x.id === id && x.status !== "declined");
  if (!p) throw new ApiError("not_found", `There is no metric called ${id}.`, 404);
  const history = [
    ...(p.accepted_at ? [{ version: 1, date: p.accepted_at.slice(0, 10), change: T("Accepted from an exploratory answer. No tracking check uses it, so it stays not checked.", "Bir keşif cevabından kabul edildi. Hiçbir ölçüm kontrolü kullanmadığı için sağlaması yok."), actor: T("Person", "Kişi") }] : []),
    { version: 0, date: p.created_at.slice(0, 10), change: T("Proposed from an exploratory answer, with the model’s SQL.", "Bir keşif cevabından, modelin SQL’iyle önerildi."), actor: T("Agent", "Agent") },
  ];
  const definition = [
    { label: T("Status", "Durum"), value: p.status === "accepted" ? T("Accepted · not checked", "Kabul edildi · sağlaması yok") : T("Proposed · draft", "Önerildi · taslak") },
    { label: T("Formula", "Formül"), value: T("The model’s SQL, below", "Modelin SQL’i, aşağıda") },
    { label: T("Table", "Tablo"), value: T("daily_channel_device", "daily_channel_device") },
    { label: T("Timezone", "Saat dilimi"), value: T("Europe/Istanbul", "Europe/Istanbul") },
    { label: T("Tracking checks", "Ölçüm kontrolleri"), value: T("None: not checked", "Yok: sağlaması yok") },
  ];
  const used_in = db.dashboards.flatMap((d) => d.tiles.filter((t) => t.answer_id && t.answer_id === p.answer_id).map((t) => ({ dashboard_id: d.id, dashboard: d.name, tile_id: t.id, title: t.title })));
  return { entry: proposedEntry(p), definition, sql: p.sql, series: null, checks: [], used_in, history, proposal: { question: p.question, answer_id: p.answer_id, conversation_id: p.conversation_id } };
}

function proposeMetric(from: Answer, conv: Conversation): ProposedMetric {
  const existing = db.metrics_proposed.find((m) => m.answer_id === from.id && m.status !== "declined");
  if (existing) return existing;
  const x = from.explore!;
  const m: ProposedMetric = {
    id: newId("metric"),
    label: from.title,
    description: { en: `Draft from an exploratory answer: ${from.title.en.charAt(0).toLowerCase()}${from.title.en.slice(1)}, as the model’s SQL computes it.`, tr: `Bir keşif cevabından taslak: modelin SQL’inin hesapladığı biçimiyle ${from.title.tr.toLocaleLowerCase("tr")}.` },
    unit: x.unit,
    sql: x.sql,
    question: from.question,
    answer_id: from.id,
    conversation_id: conv.id,
    status: "proposed",
    created_at: now(),
    accepted_at: null,
  };
  db.metrics_proposed.push(m);
  log("agent", "propose_metric", ACT.metric_proposed(m.label));
  return m;
}

/** The reviewer menu's "Simulate the fix": the next audit of the purchase journey passes. */
export function simulateAuditFix(on: boolean) {
  db.audit_fixed = on;
  save();
}

const handlers: { [N in keyof Actions]: Handler<N> } = {
  list_metric_entries: () => [...Object.keys(METRICS).map(packEntry), ...db.metrics_proposed.filter((m) => m.status !== "declined").map(proposedEntry)],
  get_metric: ({ metric }) => metricPage(metric),
  decide_metric: ({ metric, accept }) => {
    const p = db.metrics_proposed.find((x) => x.id === metric);
    if (!p || p.status !== "proposed") throw new ApiError("invalid_input", "This metric is not waiting for a decision.", 409);
    p.status = accept ? "accepted" : "declined";
    if (accept) p.accepted_at = now();
    const act = log("person", "decide_metric", accept ? ACT.metric_accepted(p.label) : ACT.metric_declined(p.label));
    return { entry: accept ? proposedEntry(p) : null, activity_id: act.id };
  },
  list_events: () => clone(db.events),
  save_event: ({ event }) => {
    const old = event.id ? db.events.find((e) => e.id === event.id) : undefined;
    if (old) {
      const next: ChartEvent = { ...old, ...event, id: old.id, source: old.source };
      db.events = db.events.map((e) => (e.id === old.id ? next : e));
      const act = log("person", "save_event", ACT.event_edited(next.title), { kind: "event_update", event: clone(old) });
      return { event: clone(next), activity_id: act.id };
    }
    const added: ChartEvent = { id: newId("ev"), date: event.date, title: event.title, type: event.type, note: event.note ?? null, source: "manual" };
    db.events.push(added);
    const act = log("person", "save_event", ACT.event_added(added.title), { kind: "event_add", event_id: added.id });
    return { event: clone(added), activity_id: act.id };
  },
  delete_event: ({ id }) => {
    const ev = db.events.find((e) => e.id === id);
    if (!ev) throw new ApiError("not_found", "Unknown event.", 404);
    db.events = db.events.filter((e) => e.id !== id);
    const act = log("person", "delete_event", ACT.event_deleted(ev.title), { kind: "event_delete", event: clone(ev) });
    return { activity_id: act.id };
  },
  import_gtm_events: () => {
    const fresh = gtmImport().filter((g) => !db.events.some((e) => e.id === g.id));
    db.events.push(...fresh);
    const act = log("person", "import_gtm_events", ACT.gtm_import(gtmImport().length), { kind: "events_import", ids: fresh.map((x) => x.id) });
    return { added: fresh.length, activity_id: act.id };
  },
  start_tracking_audit: (input) => {
    const run = runAudit(input, db.audit_fixed, now(), newId("aud"));
    db.audits.unshift(run);
    db.audits = db.audits.slice(0, 10);
    log("person", "start_tracking_audit", ACT.audit_done(run.result!.title, run.result!.ok));
    return clone(run);
  },
  get_audit: ({ id }) => {
    const a = db.audits.find((x) => x.id === id);
    if (!a) throw new ApiError("not_found", "Unknown audit.", 404);
    return clone(a);
  },
  list_sources: () => [
    { id: "ga4", name: T("GA4 BigQuery export", "GA4 BigQuery dışa aktarımı"), detail: "analytics_312 · events_*", rows: 41820000 },
    { id: "backoffice", name: T("Back office (ikas)", "Sipariş paneli (ikas)"), detail: "orders, order_items", rows: 118400 },
    { id: "google_ads", name: T("Google Ads", "Google Ads"), detail: "campaign, cost, conversions", rows: 9120 },
    { id: "meta_ads", name: T("Meta Ads", "Meta Ads"), detail: "campaign, spend, purchases", rows: 7340 },
    { id: "tiktok_ads", name: T("TikTok Ads", "TikTok Ads"), detail: "campaign, spend, conversions", rows: 2210 },
    { id: "ai_tag_debugger", name: T("AI Tag Debugger", "AI Tag Debugger"), detail: "audit findings", rows: 14 },
  ],
  list_suggestions: () =>
    exploring()
      ? [SUGGEST.ga4, ...Object.values(EXPLORE_Q).map((text) => ({ text, tag: "exploratory" as const }))]
      : [SUGGEST.ga4, SUGGEST.meta, SUGGEST.roas, SUGGEST.revenue_week],
  list_metrics: () => Object.values(METRICS),
  explain_metric: ({ metric }) => {
    const m = METRICS[metric];
    const q = runQuery({ metric, from: addDays(RANGE.to, -27), to: RANGE.to });
    const check = m.check ? CHECKS[m.check] : null;
    return { ...m, model: "daily_channel_device", sql_example: q.sql, dialect: "duckdb", check: check ? { id: check.id, label: check.label, tolerance: check.tolerance } : null };
  },
  list_checks: () => Object.values(CHECKS),
  run_query: (input) => runQuery(input),
  reconcile: ({ check, from, to, filters }) => reconcile(check, from, to, filters),
  run_all_checks: ({ days = 14 }) => {
    const run = runChecks(days, "person", now());
    db.runs.push(run);
    db.runs = db.runs.slice(-20);
    for (const w of db.watches) {
      const r = run.results.find((x) => x.check === w.check);
      if (r && days === 14) {
        if (r.verdict !== w.last_verdict) w.changed = true;
        w.last_verdict = r.verdict;
      }
    }
    log("person", "run_all_checks", ACT.checks_run(run.results.length, run.results.filter((r) => r.verdict === "does_not_add_up").length));
    return clone(run);
  },
  get_check: ({ check, days = 14, from, to, run_id }) => {
    if (!CHECKS[check]) throw new ApiError("not_found", `There is no check called ${check}.`, 404);
    const stored = run_id ? db.runs.find((r) => r.id === run_id)?.results.find((r) => r.check === check) : null;
    if (run_id && !stored) throw new ApiError("not_found", "Unknown run.", 404);
    const result = stored ? reconcile(check, stored.from, stored.to) : from && to ? reconcile(check, from, to) : reconcile(check, addDays(RANGE.to, -(days - 1)), RANGE.to);
    const w = comparisonWindow(result.from, result.to, "previous_period");
    const runs = db.runs
      .map((r) => ({ run: r, res: r.results.find((x) => x.check === check) }))
      .filter((x) => x.res)
      .map(({ run, res }) => ({ id: run.id, created_at: run.created_at, actor: run.actor, verdict: res!.verdict, delta_pct: res!.delta_pct }))
      .reverse();
    const watchRow = db.watches.find((x) => x.check === check) ?? null;
    if (watchRow?.changed) {
      watchRow.changed = false;
    }
    const detail: CheckDetail = { result: withAudit(result), previous: w ? reconcile(check, w.from, w.to, undefined, { seriesLead: 0 }) : null, weeks: checkHistory(check, 7), runs, watch: watchRow ? clone(watchRow) : null };
    return detail;
  },
  watch_check: ({ check }) => {
    const r = watch(check, "person");
    return { watch: clone(r.watch), activity_id: r.activity?.id ?? null };
  },
  unwatch_check: ({ check }) => {
    const w = db.watches.find((x) => x.check === check);
    let activity_id: string | null = null;
    if (w) {
      db.watches = db.watches.filter((x) => x.id !== w.id);
      activity_id = log("person", "unwatch_check", ACT.unwatch(CHECKS[check].label), { kind: "unwatch", watch: clone(w) }).id;
    }
    return { removed: true, activity_id };
  },
  mark_checks_seen: () => {
    db.checks_seen_at = now();
    return { ok: true };
  },
  list_conversations: () => state().conversations,
  get_conversation: ({ conversation_id }) => {
    const c = db.conversations.find((x) => x.id === conversation_id);
    if (!c) throw new ApiError("not_found", "This conversation is not here any more.", 404);
    return clone(c);
  },
  decide_proposal: ({ proposal_id, approve, where }) => {
    const p = db.proposals.find((x) => x.id === proposal_id);
    if (!p) throw new ApiError("not_found", "Unknown proposal.", 404);
    if (p.status !== "pending") throw new ApiError("invalid_input", "This was already decided.", 409);
    p.status = approve ? "approved" : "declined";
    p.decided_at = now();
    p.decided_in = where;
    if (approve) {
      if (p.kind === "watch" && p.payload.check) watch(p.payload.check, "agent");
      if (p.kind === "pin" && p.payload.answer_id) pinAnswer(p.payload.answer_id, p.payload.dashboard_id, "person");
      if (p.kind === "event" && p.payload.event) {
        const ev = { ...clone(p.payload.event), id: newId("ev"), source: "agent" as const };
        db.events.push(ev);
        log("person", "save_event", ACT.event_added(ev.title), { kind: "event_add", event_id: ev.id });
      }
      log("person", "decide_proposal", ACT.approved(p.title), undefined, { proposal_id: p.id });
    } else log("person", "decide_proposal", ACT.declined(p.title), undefined, { proposal_id: p.id });
    return clone(p);
  },
  undo: ({ activity_id }) => {
    const entry = db.activity.find((a) => a.id === activity_id);
    if (!entry) throw new ApiError("not_found", "Unknown activity.", 404);
    if (entry.undone) throw new ApiError("already_undone", "This was already undone.", 409);
    applyUndo(entry);
    entry.undone = true;
    log("person", "undo", ACT.undid(undoLabel(entry)));
    return { undone: true, activity: clone(entry) };
  },
  list_dashboards: () => state().dashboards,
  get_dashboard: ({ dashboard_id }) => getDashboard(dashboard_id),
  create_dashboard: ({ name }) => {
    const n = name.trim();
    if (!n) throw new ApiError("invalid_input", "A dashboard needs a name.");
    const d: Dashboard = { id: newId("db"), name: T(n, n), example: false, period: "last_28", compare: "previous_period", tiles: [], created_at: now(), updated_at: now(), version: 1 };
    db.dashboards.push(d);
    db.last_dashboard = d.id;
    log("person", "create_dashboard", ACT.dashboard_created(d.name), { kind: "dashboard_create", dashboard_id: d.id });
    return clone(d);
  },
  rename_dashboard: ({ dashboard_id, name }) => {
    const d = dashboard(dashboard_id);
    const n = name.trim();
    if (!n) throw new ApiError("invalid_input", "A dashboard needs a name.");
    const before = d.name;
    d.name = T(n, n);
    touch(d);
    const act = log("person", "rename_dashboard", ACT.dashboard_renamed(before, d.name), { kind: "dashboard_rename", dashboard_id: d.id, name: before });
    return { dashboard: clone(d), activity_id: act.id };
  },
  delete_dashboard: ({ dashboard_id }) => {
    if (db.dashboards.length <= 1) throw new ApiError("only_one", "One dashboard always stays.", 409);
    const index = db.dashboards.findIndex((d) => d.id === dashboard_id);
    const d = dashboard(dashboard_id);
    db.dashboards = db.dashboards.filter((x) => x.id !== dashboard_id);
    const next = db.dashboards[Math.max(0, index - 1)]!.id;
    db.last_dashboard = next;
    log("person", "delete_dashboard", ACT.dashboard_deleted(d.name), { kind: "dashboard_delete", dashboard: clone(d), index });
    return { deleted: true, next };
  },
  set_dashboard_period: ({ dashboard_id, period, compare }) => {
    const d = dashboard(dashboard_id);
    if (compare === "previous_year" && !comparisonWindow(resolvePeriod(period ?? d.period).from, RANGE.to, "previous_year")) throw new ApiError("no_data", "Data starts too late for a year earlier.", 409);
    const before = { period: d.period, compare: d.compare };
    d.period = period ?? d.period;
    d.compare = compare ?? d.compare;
    touch(d);
    const act = log("person", "set_dashboard_period", ACT.period(d.name, PERIOD_NAMES[d.period]!, COMPARE_NAMES[d.compare]!), { kind: "period", dashboard_id: d.id, ...before });
    return { dashboard: clone(d), activity_id: act.id };
  },
  pin_answer: ({ answer_id, dashboard_id }) => pinAnswer(answer_id, dashboard_id),
  update_tile: ({ tile_id, chart, size, title }) => {
    const { dash, tile } = findTile(tile_id);
    const before = clone(tile);
    let detail: Text;
    if (chart) {
      if (!validCharts(tile.query).includes(chart)) throw new ApiError("invalid_chart", "That chart type does not suit this figure.");
      tile.chart = chart;
      if (!widthRules(chart).find((r) => r.w === tile.size.w)?.ok) tile.size = { ...tile.size, w: 4 };
      detail = ACT.chart(tile.title, CHART_NAMES[chart]!);
    } else if (size) {
      if (!widthRules(tile.chart).find((r) => r.w === size.w)?.ok) throw new ApiError("invalid_size", "That width does not suit this chart.");
      tile.size = size;
      detail = ACT.resized(tile.title, size.w, size.h);
    } else if (title != null) {
      const n = title.trim();
      if (!n) throw new ApiError("invalid_input", "A tile needs a name.");
      tile.title = T(n, n);
      detail = ACT.renamed(before.title, tile.title);
    } else throw new ApiError("invalid_input", "Nothing to change.");
    tile.version += 1;
    touch(dash);
    const act = log("person", "update_tile", detail, { kind: "tile_update", tile: before });
    return { tile: clone(tile), activity_id: act.id };
  },
  move_tile: ({ tile_id, to_index }) => {
    const { dash, tile, index } = findTile(tile_id);
    const order = dash.tiles.map((t) => t.id);
    const target = Math.max(0, Math.min(to_index, dash.tiles.length - 1));
    if (target === index) return { dashboard: clone(dash), activity_id: "" };
    dash.tiles.splice(index, 1);
    dash.tiles.splice(target, 0, tile);
    const other = dash.tiles[target + 1] ?? null;
    touch(dash);
    const act = log("person", "move_tile", ACT.moved(tile.title, other?.title ?? null, !other), { kind: "tile_order", dashboard_id: dash.id, order });
    return { dashboard: clone(dash), activity_id: act.id };
  },
  duplicate_tile: ({ tile_id }) => {
    const { dash, tile, index } = findTile(tile_id);
    const copy: Tile = { ...clone(tile), id: newId("pin"), created_by: "person", created_at: now(), version: 1 };
    dash.tiles.splice(index + 1, 0, copy);
    touch(dash);
    const act = log("person", "duplicate_tile", ACT.duplicated(tile.title), { kind: "tile_add", tile_id: copy.id });
    return { tile: clone(copy), activity_id: act.id };
  },
  remove_tile: ({ tile_id }) => {
    const { dash, tile, index } = findTile(tile_id);
    dash.tiles.splice(index, 1);
    touch(dash);
    const act = log("person", "remove_tile", ACT.removed(tile.title, dash.name), { kind: "tile_remove", tile: clone(tile), index });
    return { removed: true, activity_id: act.id };
  },
  get_settings: () => settings(),
  test_bigquery: (v) => testBigQuery(v),
  save_data_source: (input) => {
    if (input.kind === "demo") {
      if (db.source.kind !== "demo") log("person", "save_data_source", ACT.data_source(SOURCE_LABEL.demo));
      db.source = { kind: "demo", bigquery: db.source.bigquery, checked_at: db.source.checked_at };
      return settings();
    }
    const t = db.bq_tests[input.test_id];
    if (!t?.ok) throw new ApiError("test_required", "Test the connection first.", 409);
    const values = JSON.parse(t.values) as string[];
    db.source = {
      kind: "bigquery",
      bigquery: { data_project: values[0]!, job_project: values[1]!, dataset: values[2]!, location: "EU", auth: { kind: values[3] as "adc" | "key_file", path: values[4] || null, impersonate: values[5] || null }, max_bytes: db.max_bytes },
      checked_at: now(),
    };
    log("person", "save_data_source", ACT.data_source(SOURCE_LABEL.bigquery(values[0]!)));
    return settings();
  },
  set_bytes_cap: ({ max_bytes }) => {
    if (max_bytes > 2 * 1024 ** 3) throw new ApiError("over_ceiling", "The cap can only be raised with BIGQUERY_MAX_BYTES.", 409);
    if (!(max_bytes > 0)) throw new ApiError("invalid_input", "The cap must be above zero.");
    db.max_bytes = max_bytes;
    log("person", "set_bytes_cap", ACT.cap(f.en.bytes(max_bytes)));
    return settings();
  },
  rebuild_demo: () => {
    const prefs = db.preferences;
    const providers = db.providers;
    const active = db.active_provider;
    db = seedDb();
    db.preferences = prefs;
    db.providers = providers;
    db.active_provider = active;
    log("system", "rebuild_demo", ACT.demo_rebuilt);
    return { ok: true };
  },
  test_model_key: (input) => testModel(input),
  save_model_key: (input) => {
    const t = testModel(input);
    if (!t.ok) throw new ApiError(t.error?.code ?? "key_rejected", "The test did not pass.", 409);
    const key = (input.key ?? "").trim();
    db.providers[input.provider] = { set: true, hint: key ? `…${key.slice(-4)}` : undefined, model: input.model, base_url: input.base_url ?? null };
    db.active_provider = input.provider;
    log("person", "save_model_key", ACT.model_saved(PROVIDER_LABEL[input.provider]));
    return settings();
  },
  remove_model_key: ({ provider }) => {
    db.providers[provider] = { set: false, model: null, base_url: null };
    if (db.active_provider === provider) db.active_provider = (Object.keys(db.providers) as ProviderId[]).find((p) => db.providers[p].set) ?? "planner";
    log("person", "remove_model_key", ACT.model_removed(PROVIDER_LABEL[provider]));
    return settings();
  },
  set_model_provider: ({ provider }) => {
    if (provider !== "planner" && !db.providers[provider].set) throw new ApiError("invalid_input", "That provider has no key.");
    db.active_provider = provider;
    log("person", "set_model_provider", ACT.model_provider(provider === "planner" ? "Built-in planner" : PROVIDER_LABEL[provider]));
    return settings();
  },
  get_chat_app_setup: ({ client }) => chatSetup(client),
  list_chat_app_calls: () => clone(db.chat_calls.slice(0, 5)),
  set_preference: (input) => {
    if (input.key === "make_it_yours") db.preferences.make_it_yours = input.value;
    else if (input.key === "exploratory") db.preferences.exploratory = input.value;
    else if (!db.preferences.not_now.includes(input.value)) db.preferences.not_now.push(input.value);
    return clone(db.preferences);
  },
};

/** The reviewer menu's "Simulate a model key" and its undo: an Anthropic key in use without typing one. */
export function simulateModelKey(on: boolean) {
  if (on) {
    db.providers.anthropic = { set: true, hint: "…demo", model: MODEL_DEFAULT.anthropic, base_url: null };
    db.active_provider = "anthropic";
    log("person", "save_model_key", ACT.model_saved(PROVIDER_LABEL.anthropic));
  } else {
    db.providers.anthropic = { set: false, model: null, base_url: null };
    db.active_provider = "planner";
    log("person", "remove_model_key", ACT.model_removed(PROVIDER_LABEL.anthropic));
  }
  save();
}

/** The reviewer menu's "Simulate a Claude Desktop request" (F10 step 4: the chat app calls over stdio). */
export function simulateChatAppCall() {
  db.chat_calls = [{ at: now(), client: "Claude Desktop", tool: "reconcile", check: "ga4_vs_orders" as const }, ...db.chat_calls].slice(0, 20);
  save();
}

/** The reviewer menu's "Simulate a changed watched check" (F7 step 4). */
export function simulateWatchChange(): boolean {
  const w = db.watches[0];
  if (!w) return false;
  w.changed = true;
  log("system", "run_watched_checks", { en: `${CHECKS[w.check].label.en} changed since the last run`, tr: `${CHECKS[w.check].label.tr} son çalıştırmadan beri değişti` });
  save();
  return true;
}

export function callAction<N extends keyof Actions>(name: N, input: Actions[N]["input"], lang: Lang): Actions[N]["result"] {
  const handler = handlers[name] as Handler<N> | undefined;
  if (!handler) throw new ApiError("unknown_action", `Unknown action "${String(name)}".`, 404);
  const result = handler(input, lang);
  save();
  return result;
}

export const getState = (): AppState => state();

// ---------------------------------------------------------------- ask

const STEP_MS = 320;

function conversationFor(id: AskRequest["conversation_id"]): Conversation {
  if (id && id !== "new") {
    const c = db.conversations.find((x) => x.id === id);
    if (!c) throw new ApiError("not_found", "This conversation is not here any more.", 404);
    return c;
  }
  if (id === undefined && db.conversations.length) return [...db.conversations].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0]!;
  const c: Conversation = { id: newId("conv"), title: "", created_at: now(), updated_at: now(), turns: 0, turn_list: [] };
  db.conversations.push(c);
  return c;
}

/** The {en, tr} text of a question the app offered (a suggestion, a follow-up, a similar question, a tour link). */
function knownQuestion(q: string): Text | null {
  const key = q.trim().replace(/['’]/g, "’").toLocaleLowerCase("tr");
  const same = (x: Text) => [x.en, x.tr].some((v) => v.trim().replace(/['’]/g, "’").toLocaleLowerCase("tr") === key);
  const offered = db.conversations.flatMap((c) => c.turn_list.flatMap((t) => [...t.answers.flatMap((a) => a.followups), ...(t.refusal?.nearest ?? [])]));
  return KNOWN_QUESTIONS.find(same) ?? offered.find(same) ?? null;
}

const normQ = (q: string) => q.trim().replace(/['’]/g, "’").toLocaleLowerCase("tr");
/** What a question would do, so two phrasings of the same request count as one. */
function signature(p: ReturnType<typeof plan>): string | null {
  if (p.kind === "refusal") return p.refusal.code === "metric_howto" ? "howto" : null;
  if (p.kind === "propose_watch") return `watch|${p.check}`;
  if (p.kind === "propose_pin") return "pin";
  if (p.kind === "propose_event") return `event|${p.event.date}`;
  if (p.kind === "propose_metric") return "metric_proposal";
  const a = p.answer;
  const c = a.check;
  if (a.explore) return `explore|${JSON.stringify(a.explore.spec)}`;
  return c ? `${a.kind}|${c.check}|${c.from}|${c.to}|${JSON.stringify(c.filters.device ?? null)}` : `${a.kind}|${a.query.metric}|${a.query.group_by}|${a.query.from}|${a.query.to}`;
}
const answerSignature = (a: Answer) => signature({ kind: "answer", answer: a, steps: [] });

/** Follow-ups after a reply: at most 3, never a question already asked in this conversation, never one that would
 *  repeat this reply or an earlier one, never a refusal, never a watch already in place. The planner's own come
 *  first; the pool fills the rest. */
function freshFollowups(answer: Answer, conv: Conversation, req: AskRequest, model: { label: Text } | null): Text[] {
  const asked = new Set(conv.turn_list.flatMap((t) => [t.question, t.question_text?.en, t.question_text?.tr].filter(Boolean).map((q) => normQ(q!))));
  const done = new Set(conv.turn_list.flatMap((t) => t.answers).concat(answer).map(answerSignature));
  const out: Text[] = [];
  const seen = new Set<string>();
  for (const q of [...answer.followups, ...FOLLOW_POOL]) {
    if (out.length === 3) break;
    if (asked.has(normQ(q.en)) || asked.has(normQ(q.tr)) || seen.has(q.en)) continue;
    const p = plan(q.en, { lastCheck: answer.check, lastAnswer: answer, context: req.context ?? null, model, explore: exploring(), demo: db.source.kind === "demo", events: db.events });
    const sig = signature(p);
    if (!sig || done.has(sig) || seen.has(sig)) continue;
    if (p.kind === "propose_watch" && db.watches.some((w) => w.check === p.check)) continue;
    seen.add(q.en);
    seen.add(sig);
    out.push(q);
  }
  return out;
}

export function startTurn(req: AskRequest, emit: (e: AskEvent) => void, signal: AbortSignal): Promise<void> {
  const conv = conversationFor(req.conversation_id);
  const questionText = knownQuestion(req.question);
  if (!conv.title) {
    conv.title = req.question;
    conv.title_text = questionText;
  }
  const turn: Turn = {
    id: newId("turn"),
    conversation_id: conv.id,
    question: req.question,
    question_text: questionText,
    lang: req.lang,
    context: req.context ?? null,
    steps: [],
    answers: [],
    approvals: [],
    refusal: null,
    text: null,
    error: null,
    created_by: "person",
    status: "running",
    seconds: 0,
    created_at: now(),
  };
  const prevAnswers = conv.turn_list.flatMap((t) => t.answers);
  const lastAnswer = prevAnswers[prevAnswers.length - 1] ?? null;
  const lastCheck = [...prevAnswers].reverse().find((a) => a.check)?.check ?? null;
  conv.turn_list.push(turn);
  conv.turns = conv.turn_list.length;
  conv.updated_at = now();
  save();

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      });
    });
  const stopped = () => {
    if (!signal.aborted) return false;
    turn.status = "stopped";
    turn.error = { code: "stopped" };
    emit({ event: "error", data: { code: "stopped" } });
    emit({ event: "done", data: {} });
    save();
    return true;
  };

  return (async () => {
    emit({ event: "turn", data: { turn_id: turn.id, conversation_id: conv.id, question_text: questionText } });
    const model = agentModel();
    const p = plan(req.question, { lastCheck, lastAnswer, context: req.context ?? null, model: model ? { label: model.label } : null, explore: exploring(), demo: db.source.kind === "demo", events: db.events });
    const started = Date.now();
    if (p.kind === "refusal") {
      await wait(STEP_MS);
      if (stopped()) return;
      turn.refusal = p.refusal;
      emit({ event: "refusal", data: p.refusal });
    } else if (p.kind === "propose_metric") {
      for (const s of p.steps) {
        await wait(STEP_MS);
        if (stopped()) return;
        turn.steps.push(s);
        emit({ event: "step", data: s });
      }
      const m = proposeMetric(p.from, conv);
      const refusal = { code: "metric_proposed" as const, heading: METRIC_PROPOSED.heading(m.label), body: db.source.kind === "demo" ? METRIC_PROPOSED.demo : METRIC_PROPOSED.own, nearest: [], metric_id: m.id };
      turn.refusal = refusal;
      emit({ event: "refusal", data: refusal });
    } else if (p.kind === "propose_watch" || p.kind === "propose_pin" || p.kind === "propose_event") {
      for (const s of p.steps) {
        await wait(STEP_MS);
        if (stopped()) return;
        turn.steps.push(s);
        emit({ event: "step", data: s });
      }
      let proposal: Proposal;
      if (p.kind === "propose_event") {
        proposal = { id: newId("prop"), kind: "event", payload: { event: { ...p.event, id: "" } }, title: APPROVAL.event_title(p.event.title), body: APPROVAL.event_body(p.event.date), status: "pending", created_by: "agent", created_at: now(), conversation_id: conv.id };
      } else if (p.kind === "propose_watch") {
        const label = CHECKS[p.check].label;
        proposal = { id: newId("prop"), kind: "watch", payload: { check: p.check }, title: APPROVAL.watch_title(label), body: APPROVAL.watch_body, status: "pending", created_by: "agent", created_at: now(), conversation_id: conv.id };
      } else {
        const dash = dashboard(db.last_dashboard);
        const t = tileFromAnswer(lastAnswer!, dash.id);
        proposal = { id: newId("prop"), kind: "pin", payload: { answer_id: lastAnswer!.id, dashboard_id: dash.id }, title: APPROVAL.pin_title(dash.name), body: APPROVAL.pin_body(CHART_NAMES[t.chart]!, t.size.w), status: "pending", created_by: "agent", created_at: now(), conversation_id: conv.id };
        const step = { tool: "pin_answer", summary: { en: `Proposed pinning to ${dash.name.en}`, tr: `${dash.name.tr} dashboard’una ekleme önerildi` }, ok: true };
        turn.steps.push(step);
        emit({ event: "step", data: step });
      }
      db.proposals.push(proposal);
      turn.approvals.push(proposal.id);
      log("agent", "propose", ACT.proposed(proposal.title), undefined, { proposal_id: proposal.id });
      await wait(STEP_MS);
      if (stopped()) return;
      emit({ event: "approval", data: { proposal: clone(proposal) } });
      turn.text = APPROVAL.waiting;
      emit({ event: "text", data: { text: APPROVAL.waiting } });
    } else {
      for (const s of p.steps) {
        await wait(STEP_MS);
        if (stopped()) return;
        turn.steps.push(s);
        emit({ event: "step", data: s });
      }
      const answer: Answer = { ...p.answer, id: newId("ans"), turn_id: turn.id, question: req.question, created_at: now() };
      answer.followups = freshFollowups(answer, conv, req, model ? { label: model.label } : null);
      turn.answers.push(answer);
      emit({ event: "answer", data: { answer: clone(answer) } });
      if (!model) {
        turn.text = PLANNER_TEXT;
        emit({ event: "text", data: { text: PLANNER_TEXT } });
      }
    }
    turn.seconds = Math.max(0.1, Math.round((Date.now() - started) / 100) / 10);
    turn.status = "done";
    conv.updated_at = now();
    emit({ event: "done", data: {} });
    save();
  })();
}

export { RANGE };
