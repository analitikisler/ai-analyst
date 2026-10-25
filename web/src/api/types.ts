// Shapes of the ai-analyst HTTP API: docs/CONTRACT.md as it stands, plus the additions in 09-ux.md §6 (B02 to B21)
// and 10-backend.md §2. Kept the way the server sends them (snake_case). Server-made strings are stored in both
// languages (B06, `Text`); a typed question stays as typed.

export type Lang = "en" | "tr";
/** A server-made string in both languages (B06). */
export type Text = Record<Lang, string>;
/** @deprecated the name used before B06; same shape. */
export type Bilingual = Text;

export type MetricId =
  | "ad_spend"
  | "aov"
  | "conversion_rate"
  | "cpa"
  | "ga4_purchases"
  | "ga4_revenue"
  | "orders"
  | "platform_conversions"
  | "revenue"
  | "roas"
  | "sessions";
export type CheckId = "ga4_vs_orders" | "ga4_rev_vs_revenue" | "meta_vs_orders" | "gads_vs_orders";

export type Unit = "count" | "try" | "pct" | "ratio";
export type GroupBy = "none" | "day" | "week" | "month" | "channel" | "device";
export type Channel = "organic" | "direct" | "google_ads" | "meta_ads" | "tiktok_ads" | "email";
export type Device = "mobile" | "desktop";
export type Dialect = "duckdb" | "bigquery";
export type Actor = "person" | "agent" | "system" | "chat_app";
export type Verdict = "adds_up" | "does_not_add_up" | "insufficient_data" | "not_checked";

export interface Filters {
  channel?: Channel | Channel[];
  device?: Device | Device[];
}

export type CompareKind = "previous_period" | "previous_year";

export interface QueryParams {
  metric: MetricId;
  group_by?: GroupBy;
  from?: string;
  to?: string;
  filters?: Filters;
  /** B07 */
  compare?: CompareKind;
}

export interface QueryRow {
  key: string;
  value: number | null;
}

export interface QueryComparison {
  kind: CompareKind;
  from: string;
  to: string;
  shift_days: number;
  total: number | null;
  rows: QueryRow[];
  delta: number | null;
  delta_pct: number | null;
  /** Rates: change in percentage points. */
  delta_points?: number | null;
  sql: string;
}

export interface QueryResult {
  id: string;
  metric: MetricId;
  metric_version: number;
  group_by: GroupBy;
  from: string;
  to: string;
  filters: Filters;
  unit: Unit;
  rows: QueryRow[];
  total: number | null;
  sql: string;
  dialect: Dialect;
  ran_at: string;
  /** B07; null when the comparison window has no data. */
  comparison?: QueryComparison | null;
  comparison_note?: "no_data" | null;
  /** B11: the last 3 days with data may change. */
  provisional_from?: string;
  /** Week or month rows that are not complete. */
  partial?: { key: string; days: number; of: number } | null;
}

export interface CheckSide {
  metric: MetricId;
  label: Text;
  /** null: no data (every value in the period is missing), never read as 0. */
  value: number | null;
}

export interface BreakdownRow {
  key: string;
  expected: number | null;
  measured: number | null;
  delta_pct: number | null;
  verdict: Verdict;
  /** Why there is no verdict (insufficient_data). */
  reason?: Text | null;
}

export interface Finding {
  id: string;
  source: string;
  text: Text;
  since: string | null;
  /** B11: the release the finding ties to. */
  release?: string | null;
  /** Confirmed by a tracking audit (owner round 5). */
  confirmed?: { audit_id: string; at: string } | null;
}

export interface CheckSeriesPoint {
  date: string;
  expected: number | null;
  measured: number | null;
}

export interface CheckResult {
  id: string;
  check: CheckId;
  label: Text;
  from: string;
  to: string;
  filters: Filters;
  unit: Unit;
  expected: CheckSide;
  measured: CheckSide;
  delta: number | null;
  delta_pct: number | null;
  tolerance: number;
  verdict: Verdict;
  /** insufficient_data: why (a side with no data, or 0 expected). */
  reason?: Text | null;
  breakdown_by: GroupBy;
  breakdown: BreakdownRow[];
  out_of_tolerance_since: string | null;
  findings: Finding[];
  sql: { expected: string; measured: string };
  dialect: Dialect;
  ran_at: string;
  /** B12: daily sides from `series_from` (the period plus the 14 days before it) to `to`. */
  series?: CheckSeriesPoint[];
  series_from?: string;
  provisional_from?: string;
}

export interface MetricRef {
  id: MetricId;
  label: Text;
  version: number;
  description: Text;
  source: string;
}

export type AnswerKind = "check" | "check_split" | "why" | "explore" | "number" | "series" | "split";

/** What an exploratory question asks of the mart: the one SQL query a model writes (owner round 4). */
export interface ExploreSpec {
  /** "other" when the model's value column is none of the named ones; the result's label names it. */
  measure: "revenue" | "orders" | "sessions" | "ad_spend" | "aov" | "spend_growth" | "other";
  /** "other": a dimension outside the mart (a product category, a return reason); its key is shown as written. */
  dims: ("weekday" | "channel" | "device" | "week" | "other")[];
  from: string;
  to: string;
}

/** The result of an exploratory query, drawn from its shape with the same chart rules as metrics. */
export interface ExploreResult {
  spec: ExploreSpec;
  shape: "number" | "series" | "category" | "table";
  unit: Unit;
  /** What the value column is ("Revenue"). */
  label: Text;
  /** Column headers, dimensions first, then the value. */
  columns: Text[];
  /** Dimension keys (channel, device, weekday or week start) then the value. */
  rows: (string | number | null)[][];
  sql: string;
  bytes: number;
  /** The tables the query read (BigQuery: project.dataset.table, from the dry run; the demo: bare names). */
  tables: string[];
}

/** A "why" answer explains a gap instead of repeating the tally: when it started, where it is, what the tag audit
 *  found and what to do next. */
export interface WhyDetail {
  /** First day outside the tolerance. */
  started: string | null;
  /** The release that lines up with the start, when one does. */
  release: string | null;
  /** The segment that carries the gap, when one does. */
  segment: { key: string; delta_pct: number | null; verdict: Verdict } | null;
  /** Narrower than the segment, from the finding ("mobile Safari"). */
  narrower: Text | null;
  next: Text[];
}

export type EventType = "release" | "campaign" | "tag_change" | "price_change" | "other";
export type EventSource = "manual" | "agent" | "gtm";

/** Something that happened on a day, drawn on every time chart whose range holds it (owner round 5). */
export interface ChartEvent {
  id: string;
  date: string;
  title: Text;
  type: EventType;
  note: Text | null;
  source: EventSource;
}

// ---------------------------------------------------------------- the metrics page (owner round 5)

export interface MetricHistoryRow {
  version: number;
  date: string;
  change: Text;
  actor: Text;
}

/** One row of the data dictionary: a pack metric, or one proposed from an exploratory answer. */
export interface MetricEntry {
  id: string;
  label: Text;
  description: Text;
  unit: Unit;
  source: string;
  version: number;
  checks: CheckId[];
  status: "active" | "proposed" | "accepted";
}

export interface MetricPage {
  entry: MetricEntry;
  /** The pack definition, in rows (grain, filters, timezone, VAT…). */
  definition: { label: Text; value: Text }[];
  sql: string;
  /** The last 90 days by day, for the chart (pack metrics only). */
  series: QueryResult | null;
  checks: { id: CheckId; label: Text; role: "source" | "measured"; verdict: Verdict; delta_pct: number | null; from: string; to: string }[];
  used_in: { dashboard_id: string; dashboard: Text; tile_id: string; title: Text }[];
  history: MetricHistoryRow[];
  /** For a proposed or accepted metric: what it came from. */
  proposal: { question: string; answer_id: string | null; conversation_id: string | null } | null;
}

// ---------------------------------------------------------------- tracking audits (owner round 5)

export type AuditPlatform = "ga4" | "google_ads" | "meta" | "tiktok";

export interface AuditStep {
  name: Text;
  url: string;
  hits: { platform: AuditPlatform; event: string; status: "sent" | "missing" }[];
}

export interface AuditRun {
  id: string;
  check: CheckId;
  journey: "purchase";
  device: string;
  url: string;
  platforms: AuditPlatform[];
  started_at: string;
  /** null while status is "handoff". */
  finished_at: string | null;
  steps: AuditStep[];
  /** null while status is "handoff". */
  result: { ok: boolean; severity: "high" | "none"; title: Text; evidence: Text[]; fix: Text; console: string | null } | null;
  /** Run after the simulated fix. */
  fixed: boolean;
  /** "done": the run and its result (simulated on demo data); "handoff": own data, AI Tag Debugger runs it in a chat app. */
  status: "done" | "handoff";
  /** While status is "handoff": what the chat app runs. null once a finding is attached. */
  handoff?: { mcp_steps: string[]; deep_link: string | null } | null;
}

export interface Answer {
  id: string;
  turn_id: string;
  question: string;
  kind: AnswerKind;
  sentence: Text;
  title: Text;
  followups: Text[];
  /** Planner only (B05): how the question was read. */
  interpretation: Text | null;
  query: QueryResult;
  check: CheckResult | null;
  /** The metrics behind the figures (both sides of a check). */
  metrics: MetricRef[];
  events: ChartEvent[];
  validation: { ok: boolean; unmatched: string[] };
  created_by: "agent" | "planner";
  model_label: Text;
  seconds: number;
  created_at: string;
  /** The prototype's target-behaviour answers that today's planner gets wrong (09-ux.md, B05). */
  handmade?: boolean;
  /** A segment answer ("Is the gap only on mobile?"): the check is the segment's, this is the whole check. */
  overall?: { delta_pct: number | null; verdict: Verdict } | null;
  why?: WhyDetail | null;
  /** Exploratory answers: no definition, no check, never a verdict. */
  explore?: ExploreResult | null;
}

export interface Refusal {
  code: "planner_unknown" | "not_in_data" | "explore_failed" | "metric_howto" | "metric_proposed";
  /** metric_proposed: the proposed metric on the Metrics page. */
  metric_id?: string;
  missing?: "product" | "return" | "customer" | "weekday";
  heading: Text;
  body: Text;
  nearest: Text[];
}

export interface Step {
  tool: string;
  summary: Text;
  ok: boolean;
}

export interface AskContext {
  view: string;
  kind?: "tile" | "check" | "dashboard" | "metric";
  id?: string;
  name?: Text;
  [key: string]: unknown;
}

export interface TurnUsage {
  provider: ProviderId;
  model: string;
  /** Model responses in the turn. */
  rounds: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export type TurnStatus = "running" | "done" | "error" | "stopped";

export interface Turn {
  id: string;
  conversation_id: string;
  question: string;
  /** A question that came from a suggestion, a follow-up or a link is kept in both languages (B06) and shown in
   *  the UI language; a typed question has none and stays as typed. */
  question_text?: Text | null;
  lang: Lang;
  context: AskContext | null;
  steps: Step[];
  answers: Answer[];
  /** Proposal ids waiting for a person (B13). */
  approvals: string[];
  refusal: Refusal | null;
  /** The model's own text for the turn: the closing line under a card, or the whole reply when there is no card. */
  text: Text | null;
  /** Model turns: tokens used, summed over the turn's calls (cache read and write counted apart). */
  usage?: TurnUsage | null;
  error: ApiErrorBody | null;
  created_by: Actor;
  status: TurnStatus;
  seconds: number;
  created_at: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  /** The first question's text in both languages, when it has one. */
  title_text?: Text | null;
  created_at: string;
  updated_at: string;
  turns: number;
}

export interface Conversation extends ConversationSummary {
  turn_list: Turn[];
}

// ---------------------------------------------------------------- proposals, watches, activity

export interface Proposal {
  id: string;
  kind: "watch" | "pin" | "event";
  payload: { check?: CheckId; answer_id?: string; dashboard_id?: string; event?: ChartEvent };
  title: Text;
  body: Text;
  status: "pending" | "approved" | "declined";
  created_by: "agent";
  created_at: string;
  decided_at?: string;
  decided_in?: "ask" | "activity";
  conversation_id?: string;
}

export interface Watch {
  id: string;
  check: CheckId;
  status: "active";
  created_by: Actor;
  created_at: string;
  last_verdict: Verdict;
  changed: boolean;
}

export interface Activity {
  id: string;
  at: string;
  actor: Actor;
  client?: string;
  action: string;
  detail: Text;
  undo: { type: string; id: string } | null;
  undone: boolean;
  /** What it changed was removed since, so Undo no longer applies. */
  undo_gone?: boolean;
  proposal_id?: string;
}

// ---------------------------------------------------------------- dashboards (B09, B10; 10-backend.md §2.7)

export type ChartType = "number" | "line" | "column" | "stacked_column" | "area" | "table" | "tally" | "split_bar" | "both_lines";
export type TileWidth = 3 | 4 | 6 | 8 | 12;
export type TileHeight = 1 | 2;
export type PeriodKey = "last_7" | "last_14" | "last_28" | "last_90" | "last_week" | "this_month" | "last_month";
export type Compare = "off" | "previous_period" | "previous_year";

export type TileQuery =
  | { type: "metric"; metric: MetricId; group_by: GroupBy; filters?: Filters }
  | { type: "check"; check: CheckId; filters?: Filters; split?: "device" }
  | { type: "explore"; spec: ExploreSpec };

export interface Tile {
  id: string;
  dashboard_id: string;
  title: Text;
  answer_id: string | null;
  query: TileQuery;
  chart: ChartType;
  size: { w: TileWidth; h: TileHeight };
  created_by: Actor | "demo";
  created_at: string;
  version: number;
}

export interface Dashboard {
  id: string;
  name: Text;
  example: boolean;
  period: PeriodKey;
  compare: Compare;
  tiles: Tile[];
  created_at: string;
  updated_at: string;
  version: number;
}

export interface DashboardSummary {
  id: string;
  name: Text;
  example: boolean;
  tiles: number;
}

/** Which widths a chart type allows, with the reason for each one it refuses (B10). */
export interface WidthRule {
  w: TileWidth;
  ok: boolean;
  reason?: "line" | "column" | "table" | "tally";
}

export interface TileResult {
  tile_id: string;
  from: string;
  to: string;
  query?: QueryResult;
  /** A daily series for the sparkline under a number tile, and for the chart of a check tile. */
  series?: QueryResult;
  check?: CheckResult;
  previous_check?: CheckResult | null;
  explore?: ExploreResult;
  valid_charts: ChartType[];
  width_rules: Record<ChartType, WidthRule[]>;
  ran_at: string;
  cached: boolean;
  data_to: string;
  error?: ApiErrorBody;
}

export interface DashboardResult {
  dashboard: Dashboard;
  from: string;
  to: string;
  compare_from: string | null;
  compare_to: string | null;
  compare_note: "no_data" | null;
  data_to: string;
  tiles: TileResult[];
  /** Every check over the dashboard period, for the check strip (the same figures as the tally tiles). */
  checks: CheckResult[];
}

// ---------------------------------------------------------------- settings (B15, B17, B18, B19)

export interface SettingValue<T> {
  value: T;
  source: "env" | "file" | "default" | "detected";
  locked: boolean;
  env?: string;
}

export type ProviderId = "anthropic" | "openai" | "gemini" | "openai_compatible";

export interface ProviderStatus {
  id: ProviderId;
  set: boolean;
  source: "env" | "saved" | null;
  locked: boolean;
  env?: string;
  hint?: string;
  model: string | null;
  base_url?: string | null;
  last_test?: { ok: boolean; at: string; error?: ApiErrorBody } | null;
}

export interface BigQueryConfig {
  data_project: string;
  job_project: string | null;
  dataset: string;
  location: string | null;
  auth: { kind: "adc" | "key_file"; path?: string | null; impersonate?: string | null };
  max_bytes: number;
}

/** One entry of the tables the agent may read: a dataset (table null: every table in it) or one table. */
export interface AllowEntry {
  /** null on the demo, whose one dataset is "demo". */
  project: string | null;
  dataset: string;
  table: string | null;
  /** Size, table count, last change and location, as listed when the entry was added. */
  meta?: { tables: number; rows: number; bytes: number | null; modified: string | null; location: string | null };
}

export interface ExploreSettings {
  allow: AllowEntry[];
  allow_setting: { source: "env" | "file" | "default"; locked: boolean; env?: string };
  /** The mart's key (always on the list); null while BigQuery has no mart set. */
  mart: string | null;
  /** The person's protected columns per table (lower case); tables without an entry get the proposal (DescribedTable). */
  protected_columns: Record<string, string[]>;
  /** Tables whose protected columns the person confirmed. */
  confirmed: string[];
  descriptions: Record<string, string>;
  max_bytes_per_question: number;
  /** The demo file's tables; null on BigQuery. An older demo file has the mart alone until it is rebuilt. */
  demo_tables: string[] | null;
}

/** What the credential can see, for the table picker (list_tables). */
export interface TableListing {
  location: string | null;
  datasets: { project: string | null; dataset: string; location: string | null; same_location: boolean; tables: { table: string; rows: number; bytes: number | null; modified: string | null }[] }[];
}

/** One allowed table as describe_tables returns it. */
export interface DescribedTable {
  table: string;
  mart: boolean;
  type: "table" | "view";
  description: string | null;
  rows: number | null;
  bytes: number | null;
  modified: string | null;
  partitioned_by: string | null;
  columns: { name: string; type: string; description?: string }[];
  protected_columns: string[];
  protected_confirmed: boolean;
}

export interface Settings {
  server: { loopback: boolean; config_file: string; data_dir: string; pack_dir: string; address: string; version: string };
  data_source: {
    kind: SettingValue<"demo" | "bigquery">;
    bigquery: BigQueryConfig | null;
    checked_at: string | null;
    credentials: { adc_found: boolean; identity: string | null };
    max_bytes: SettingValue<number> & { ceiling: number };
    /** ISO 4217; AI_ANALYST_CURRENCY locks it. */
    currency: SettingValue<string>;
    explore: ExploreSettings;
  };
  model: { provider: SettingValue<ProviderId | "planner">; providers: ProviderStatus[] };
  help: { on: boolean; email: string };
  preferences: Preferences;
}

export interface Preferences {
  make_it_yours: "shown" | "hidden";
  not_now: string[];
  /** Exploratory answers; unset means on whenever a model is set. */
  exploratory?: "on" | "off";
}

export type BqStepId = "credentials" | "jobs" | "dataset" | "table" | "read" | "allowed" | "cost";

export interface BqStep {
  id: BqStepId;
  status: "ok" | "failed" | "skipped" | "running" | "waiting";
  detail?: Record<string, string | number>;
  error?: { code: string; params: Record<string, string | number> };
}

export interface BqTest {
  test_id: string;
  ok: boolean;
  steps: BqStep[];
  detected: { location: string | null };
  values: BigQueryConfig;
  /** credential_broader: the credential can see more datasets than the tables the agent may read. */
  warnings?: { code: "credential_broader"; params: { n: number; datasets: string } }[];
}

export interface ModelTestResult {
  ok: boolean;
  provider: ProviderId;
  model: string;
  seconds?: number;
  error?: { code: "key_rejected" | "model_not_found" | "unreachable" | "rate_limited"; status?: number; detail?: string };
}

export type ChatClient = "claude-desktop" | "claude-code" | "cursor" | "codex";

export interface ChatAppSetup {
  client: ChatClient;
  kind: "config" | "command";
  snippet: string;
  config_path?: { mac: string; windows?: string };
}

export interface ChatAppCall {
  at: string;
  client: string;
  tool: string;
  /** For reconcile: which check ran, so the page can say it in words. */
  check?: CheckId;
}

// ---------------------------------------------------------------- state (B02)

export interface AgentMode {
  mode: "model" | "planner";
  provider: ProviderId | null;
  model: string | null;
  /** "Anthropic", "OpenAI"… for the status line. */
  provider_label: string | null;
  model_label: string | null;
  /** Exploratory answers are in effect: a model is set and the switch is on. */
  exploratory: boolean;
}

export interface Workspace {
  name: string;
  demo: boolean;
  /** null while the source cannot be read (source.error). */
  data_from: string | null;
  data_to: string | null;
  refreshed_at: string;
  rows: number | null;
}

export interface CheckRun {
  id: string;
  created_at: string;
  days: number;
  from: string;
  to: string;
  actor: Actor;
  results: CheckResult[];
}

/** GET /api/state */
export interface AppState {
  workspace: Workspace;
  source: {
    kind: "demo" | "bigquery";
    label: Text;
    project: string | null;
    table: string | null;
    /** Set when the warehouse cannot be read with the saved connection (code source_unavailable, params
     *  { service, reason, status? }): the app still loads, reads fail with the same code. */
    error?: ApiErrorBody | null;
  };
  /** The workspace currency (ISO 4217, default TRY): every money figure is written in it. */
  currency: string;
  agent: AgentMode;
  offer: { help_email: string | null; cloud_email: string };
  preferences: Preferences;
  badges: { checks_changed: number; waiting: number };
  dashboards: DashboardSummary[];
  /** Which answers are on a dashboard, for "On Shop overview" (B09). */
  pins: { answer_id: string; dashboard_id: string; tile_id: string }[];
  watches: Watch[];
  checks: CheckResult[];
  check_run: Omit<CheckRun, "results"> | null;
  activity: Activity[];
  proposals: Proposal[];
  conversations: ConversationSummary[];
  host_is_loopback: boolean;
  events: ChartEvent[];
  audits: AuditRun[];
  /** A simulated fix is in place (the reviewer menu), so the next audit passes. */
  audit_fixed: boolean;
  metric_proposals: number;
}

export interface ApiErrorBody {
  code: string;
  message?: string;
  /** e.g. { env } for locked, { bytes, cap } for bytes_cap. */
  params?: Record<string, string | number>;
}

export type ActionResponse<T> = { ok: true; result: T } | { ok: false; error: ApiErrorBody };

// ---------------------------------------------------------------- catalogue

export interface MetricInfo {
  id: MetricId;
  label: Text;
  unit: Unit;
  version: number;
  source: string;
  owner: string;
  description: Text;
  dimensions: GroupBy[];
  where: Partial<Record<"channel" | "device", string[]>> | null;
  check: CheckId | null;
  definition: { sum: string } | { ratio: { numerator: string; denominator: string } };
}

export interface MetricExplanation extends Omit<MetricInfo, "check"> {
  model: string;
  sql_example: string;
  dialect: Dialect;
  check: { id: CheckId; label: Text; tolerance: number } | null;
}

export interface CheckInfo {
  id: CheckId;
  label: Text;
  expected: { metric: MetricId; label: Text };
  measured: { metric: MetricId; label: Text };
  where: Filters | null;
  tolerance: number;
  breakdown: GroupBy;
  findings: Finding[];
}

export interface WeekRow {
  from: string;
  to: string;
  expected: number;
  measured: number;
  delta_pct: number | null;
  verdict: Verdict;
}

export interface CheckDetail {
  result: CheckResult;
  previous: CheckResult | null;
  weeks: WeekRow[];
  runs: { id: string; created_at: string; actor: Actor; verdict: Verdict; delta_pct: number | null }[];
  watch: Watch | null;
}

/** Inputs and results of every action the web app calls. */
export interface Actions {
  list_sources: { input: Record<string, never>; result: { id: string; name: Text; detail: string; rows: number | null }[] };
  list_suggestions: { input: Record<string, never>; result: { text: Text; tag: "check" | "chart" | "by_channel" | "comparison" | "exploratory" }[] };
  list_metrics: { input: Record<string, never>; result: MetricInfo[] };
  list_metric_entries: { input: Record<string, never>; result: MetricEntry[] };
  get_metric: { input: { metric: string }; result: MetricPage };
  decide_metric: { input: { metric: string; accept: boolean }; result: { entry: MetricEntry | null; activity_id: string } };
  list_events: { input: Record<string, never>; result: ChartEvent[] };
  save_event: { input: { event: Omit<ChartEvent, "id" | "source"> & { id?: string } }; result: { event: ChartEvent; activity_id: string } };
  delete_event: { input: { id: string }; result: { activity_id: string } };
  import_gtm_events: { input: Record<string, never>; result: { added: number; activity_id: string } };
  start_tracking_audit: { input: { check: CheckId; url: string; device: string; platforms: AuditPlatform[] }; result: AuditRun };
  get_audit: { input: { id: string }; result: AuditRun };
  explain_metric: { input: { metric: MetricId }; result: MetricExplanation };
  list_checks: { input: Record<string, never>; result: CheckInfo[] };
  run_query: { input: QueryParams; result: QueryResult };
  reconcile: { input: { check: CheckId; from?: string; to?: string; filters?: Filters }; result: CheckResult };
  run_all_checks: { input: { days?: number }; result: CheckRun };
  get_check: { input: { check: CheckId; days?: number; from?: string; to?: string; run_id?: string }; result: CheckDetail };
  watch_check: { input: { check: CheckId }; result: { watch: Watch; activity_id: string | null } };
  unwatch_check: { input: { check: CheckId }; result: { removed: true; activity_id: string | null } };
  mark_checks_seen: { input: Record<string, never>; result: { ok: true } };
  list_conversations: { input: Record<string, never>; result: ConversationSummary[] };
  get_conversation: { input: { conversation_id: string }; result: Conversation };
  decide_proposal: { input: { proposal_id: string; approve: boolean; where: "ask" | "activity" }; result: Proposal };
  undo: { input: { activity_id: string }; result: { undone: true; activity: Activity } };
  list_dashboards: { input: Record<string, never>; result: DashboardSummary[] };
  get_dashboard: { input: { dashboard_id: string }; result: DashboardResult };
  create_dashboard: { input: { name: string }; result: Dashboard };
  rename_dashboard: { input: { dashboard_id: string; name: string }; result: { dashboard: Dashboard; activity_id: string } };
  delete_dashboard: { input: { dashboard_id: string }; result: { deleted: true; next: string } };
  set_dashboard_period: { input: { dashboard_id: string; period?: PeriodKey; compare?: Compare }; result: { dashboard: Dashboard; activity_id: string } };
  pin_answer: { input: { answer_id: string; dashboard_id?: string }; result: { tile: Tile; activity_id: string } };
  update_tile: { input: { tile_id: string; chart?: ChartType; size?: { w: TileWidth; h: TileHeight }; title?: string }; result: { tile: Tile; activity_id: string } };
  move_tile: { input: { tile_id: string; to_index: number }; result: { dashboard: Dashboard; activity_id: string } };
  duplicate_tile: { input: { tile_id: string }; result: { tile: Tile; activity_id: string } };
  remove_tile: { input: { tile_id: string }; result: { removed: true; activity_id: string } };
  get_settings: { input: Record<string, never>; result: Settings };
  test_bigquery: { input: BigQueryConfig; result: BqTest };
  save_data_source: { input: { kind: "demo" } | { kind: "bigquery"; test_id: string }; result: Settings };
  set_bytes_cap: { input: { max_bytes: number }; result: Settings };
  set_currency: { input: { currency: string }; result: Settings };
  rebuild_demo: { input: Record<string, never>; result: { ok: true } };
  test_model_key: { input: { provider: ProviderId; key?: string; model: string; base_url?: string }; result: ModelTestResult };
  save_model_key: { input: { provider: ProviderId; key?: string; model: string; base_url?: string }; result: Settings };
  remove_model_key: { input: { provider: ProviderId }; result: Settings };
  set_model_provider: { input: { provider: ProviderId | "planner" }; result: Settings };
  get_chat_app_setup: { input: { client: ChatClient }; result: ChatAppSetup };
  list_chat_app_calls: { input: Record<string, never>; result: ChatAppCall[] };
  list_tables: { input: Record<string, never>; result: TableListing };
  set_explore_tables: { input: { allow?: Omit<AllowEntry, "meta">[]; max_bytes_per_question?: number }; result: Settings };
  set_protected_columns: { input: { table: string; columns: string[] }; result: Settings };
  set_table_description: { input: { table: string; description: string }; result: Settings };
  describe_tables: { input: { refresh?: boolean }; result: { dialect: "duckdb" | "bigquery"; tables: DescribedTable[] } };
  set_preference: { input: { key: "make_it_yours"; value: "shown" | "hidden" } | { key: "not_now"; value: string } | { key: "exploratory"; value: "on" | "off" }; result: Preferences };
}
export type ActionName = keyof Actions;

// ---------------------------------------------------------------- POST /api/ask event stream

export type AskEvent =
  | { event: "turn"; data: { turn_id: string; conversation_id: string; question_text?: Text | null } }
  | { event: "step"; data: Step }
  | { event: "answer"; data: { answer: Answer } }
  | { event: "approval"; data: { proposal: Proposal } }
  | { event: "refusal"; data: Refusal }
  | { event: "text"; data: { text: Text } }
  | { event: "error"; data: ApiErrorBody }
  | { event: "done"; data: Record<string, never> };

export interface AskRequest {
  question: string;
  lang: Lang;
  conversation_id?: string | "new";
  context?: AskContext;
}
