# ai analyst · build contract, version 0.2

ai analyst is Analitik İşler's analytics tool that people and an agent use together. A person asks a question in Turkish or English; the
agent answers with a chart, the SQL it ran, the versioned metric definition and a tracking check that reconciles
the figure against the system that owns it. Every UI action, agent tool and chat-app tool is the same action
from one registry.

This file is the binding spec between the engineers. Change it only through the lead engineer, never silently on
one side. Version 0.2 (24 Oct 2026) replaces 0.1: the web app is the approved prototype's React app, its API is
`web/src/api/types.ts`, and the prototype's mock server is the reference behaviour (see "Parity" below).

## Conventions

- Runtime: Bun ≥ 1.4 is the primary tool (`bun install`, `bun run build`, `bun run test`, `bun test ./test/`);
  Node ≥ 22.13 runs `ai-analyst serve` and the tests (`node --test test/*.test.js`). Plain ES modules, no
  TypeScript build on the server, JSDoc where types help.
- Dependencies, no new one in 0.2: `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `zod` 4.6.6 (raised from
  4.6.5 for GHSA-mrhx-c7xc-m3w5; see "Exceptions"), `yaml`, `@duckdb/node-api`, `@google-cloud/bigquery` (its `google-auth-library` is used for impersonation).
  App database: built-in `node:sqlite` (works under Bun too). HTTP: built-in `node:http`. Pinned exact versions,
  at least two weeks old.
- Never call a real cloud account or API during development (BigQuery, Google, Meta, Anthropic, OpenAI,
  Gemini), not even a dry run. Tests stub every client: BigQuery, the Anthropic SDK, `fetch`. This is enforced in
  code by `AI_ANALYST_NO_CLOUD=1` (see "No outside calls").
- Copy: en-GB, short sentences, no superlatives, no exclamation marks, no em dashes, no emoji; Turkish native and
  impersonal, with the house terms (cevap, sipariş paneli, dashboard, sağlama, İşlem geçmişi). Every string the
  server makes is stored in both languages, `{ en, tr }` (`Text`).

## Layout and owners

```
package.json                  back end   bin ai-analyst -> src/cli.js; scripts build, build:demo, dev, test, serve, seed-demo, mcp, check
src/cli.js                    back end   serve [--port] [--host] [--data-dir] · seed-demo · mcp · ask "<q>" · check [--days]
src/dev.js                    back end   bun run dev: the server on 8788 and Vite on 5190 (Vite proxies /api)
src/config.js, settings.js    back end   env > ai-analyst.config.json > <data_dir>/secrets.json; writing settings
src/actions/*.js              back end   the action registry and every action
src/engine.js                 back end   queries with comparisons, the tally's series and weeks, periods, chart grammar
src/metrics/                  back end   pack loading (load.js), SQL compiling (compile.js), the accepted-metric overlay (overlay.js)
src/checks/reconcile.js       back end   the tally
src/agent/                    back end   agent.js (turns), planner.js, providers.js (Anthropic SDK, OpenAI-compatible fetch), mode.js, validate.js
src/explore/                  back end   guard.js (the SQL guard), run.js (exploratory results)
src/dashboards.js, state.js   back end   dashboards and tiles; GET /api/state
src/store/store.js            back end   node:sqlite at <data_dir>/app.db
src/warehouse/                back end   duckdb.js (demo, read-only, no external access), bigquery.js (dry run, cap, timeout)
src/server.js, mcp.js         back end   HTTP API + web/dist; stdio MCP server
src/text.js, format.js        back end   bilingual server strings; number and date formats
test/                         back end   node:test; fixtures/mock-parity.json and mock-explore.json are recorded from the prototype
metrics/, checks/, models/    data       the metric pack and the BigQuery models
web/                          front end  the React app (own package.json and bun.lock); builds to web/dist (served) and web/dist-demo (fixtures demo)
src/pack.js                   back end   npm pack: prepack builds the web app and copies web/dist to web-dist/ (web/.gitignore keeps web/dist out); postpack removes it
```

## The mart

Unchanged from 0.1. One model, `daily_channel_device`, one row per date × channel × device: `date`, `channel`
(`organic`, `direct`, `google_ads`, `meta_ads`, `tiktok_ads`, `email`), `device` (`mobile`, `desktop`),
`sessions`, `orders`, `revenue`, `ga4_purchases`, `ga4_revenue`, `platform_conversions`, `ad_spend`. In DuckDB the
table is `daily_channel_device`; in BigQuery `` `{data_project}.{dataset}.daily_channel_device` ``. The demo seed
is the prototype's generator (seed 20261023, 25 Jul to 22 Oct 2026, 1,080 rows; planted bug: mobile GA4 capture
drops from 9 Oct 2026, release v4.12). The prototype's `fixtures/mart.json` is byte-for-byte the same data.

## Metric pack

`metrics/<id>.yaml` and `checks/<id>.yaml` as in 0.1, plus an optional `history:` list on a metric, newest first:

```yaml
history:
  - version: 3
    date: 2026-08-18
    actor: Analitik İşler
    change: { en: "...", tr: "..." }
```

The repo has one commit, so there is no earlier git history to draw on; the entries are the dated notes from the
prototype's data dictionary, matching each metric's version. Turkish labels use the house term "sipariş paneli".

Accepted metric proposals are written to `<data_dir>/metrics/<metric_id>.yaml` (an overlay; never the shipped
pack) with `status: accepted`, `source: model`, the model's SQL, the question and the history. They are listed
and shown on the Metrics page, not queried by `run_query`, and stay "not checked".

## Shapes

`web/src/api/types.ts` is the type file (the front end copies it; the back end follows it). Server-made strings
are `Text` (`{ en, tr }`); a typed question stays as typed. Agreed additions in 0.2, to be added to types.ts by the
lead at integration:

```ts
// Tracking audits on own data are handed off to ai tag debugger (agreed with the lead, 24 Oct).
export interface AuditRun {
  // … existing fields …
  status: "done" | "handoff";
  /** While status is "handoff": what the chat app runs. null once a finding is attached. */
  handoff?: { mcp_steps: string[]; deep_link: string | null } | null;
  /** null while status is "handoff". */
  result: AuditResult | null;
  /** null while status is "handoff". */
  finished_at: string | null;
}
// What the value column of a model's query measures; "other" when it is none of the named ones.
export interface ExploreSpec { measure: "revenue" | "orders" | "sessions" | "ad_spend" | "aov" | "spend_growth" | "other"; dims: ("weekday" | "channel" | "device" | "week" | "other")[]; /* … */ }
// Multi-table queries (docs/design/multi-table-queries.md, built 25 Oct 2026):
export interface ExploreResult { /* … */ tables: string[] }   // the tables the query read (BigQuery: from the dry run)
export interface AllowEntry { project: string | null; dataset: string; table: string | null; meta?: { tables; rows; bytes; modified; location } }
// Settings.data_source.explore = { allow: AllowEntry[], allow_setting: { source, locked, env? }, mart: string | null,
//   protected_columns: Record<table, string[]>, confirmed: string[], descriptions: Record<table, string>,
//   max_bytes_per_question: number, demo_tables: string[] | null }
// TableListing, DescribedTable: see types.ts. BqStepId gains "allowed"; BqTest gains warnings.
// Currency (built 25 Oct 2026): AppState.currency: string (ISO 4217, default "TRY"); Settings.data_source.currency:
//   SettingValue<string> (AI_ANALYST_CURRENCY locks it). Every money figure (unit "try", the name kept for
//   compatibility) is written in it: TRY "1,240 TL" / "1.240 TL", "1.84M TL" / "1,84 mn TL"; USD, EUR, GBP
//   "$1,240", "$1.84M" (en) and "1.240 $", "1,84 mn $" (tr); any other code after the number ("1,240 CHF").
//   The server text, the *_formatted tool fields, the system prompt's number examples and the web formatters agree.
// Errors may carry params (already in ApiErrorBody): e.g. { env } for locked, { bytes, cap } for bytes_cap.
// Real-service fixes (25 Oct): token usage per model turn; Turn.text (already Text | null) is stored and returned.
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
export interface Turn { /* … */ usage?: TurnUsage | null }
// A source that cannot be reached (a deleted or revoked credential, no network): GET /api/state still answers 200
// with the workspace dates and rows null and this error; every read that needs the warehouse answers 503 with it.
export interface AppState { /* … */ source: { /* … */ error?: ApiErrorBody | null } }  // code "source_unavailable", params { service, reason, status? }
```

`deep_link` is always `null` in 0.2 (ai tag debugger has no deep link scheme yet); `mcp_steps` are four lines,
each starting with the MCP server and tool: `ai-tag-debugger start_audit {url, journey: "purchase", providers,
device}`, `ai-tag-debugger browser_action …`, `ai-tag-debugger finish_audit`, `ai-analyst attach_audit_finding
{audit_id, …}`.

## HTTP API (src/server.js)

- `GET /api/state?lang=` → `AppState`.
- `POST /api/actions/:name`, JSON body → `200 { ok: true, result }`, or `{ ok: false, error: { code, message,
  params? } }` with 400 (`invalid_input`, `bad_request`), 401 (`unauthorized`), 403 (`forbidden`,
  `loopback_only`), 404 (`not_found`, `unknown_action`), 409 (`locked`, `not_pending`, `already_undone`,
  `undo_gone`, `only_one`, `test_required`, `over_ceiling`, `no_data`, `unavailable`, `not_undoable`), 413
  (`too_large`), 415 (`unsupported_media`), 409 (`sql_location_mismatch`, `sql_table_not_allowed` from a settings action), 422 (`bytes_cap`), 500 (`internal`, a fixed sentence, never a stack or
  a path). Actions take the language from `Accept-Language`.
- `POST /api/ask` `{ question, lang, conversation_id?: string | "new", context? }` → `text/event-stream` of
  `event: <name>\ndata: <json>\n\n`, in this order: `turn { turn_id, conversation_id, question_text }` · `step
  { tool, summary: Text, ok }`* · then `answer { answer }` | `refusal Refusal` | `approval { proposal }` · `text {
  text: Text }`? · `error { code, message }`? · `done {}`. A text event carries the full latest text (replace,
  do not append). No `conversation_id` continues the most recently updated conversation; `"new"` starts one; an
  unknown id is `404 not_found` before the stream starts. Closing the connection stops the turn.
- `POST /api/turns/:id/stop` → `{ ok: true, result: { stopped } }`; the turn ends with `error { code: "stopped" }`.
- Every other non-API path serves `web/dist`: `index.html` (no-cache, with the CSP) for `/` and any unknown path
  without a file extension; hashed files under `/assets/` with `Cache-Control: public, max-age=31536000,
  immutable`; other files no-cache; a missing file with an extension is 404. Without `web/dist` the page answers
  503 and says to run `bun run build`; the API still works.

## Actions

Each action: `defineAction({ name, description, input: zod, kind, agent, person, mcp, settings, run, forModel?,
summary? })`. `ctx = { actor: "person"|"agent"|"chat_app"|"system", lang, app, turn, client?, loopback, log }`.
Writes log Activity (`detail: Text`) with an undo record where the change can be reversed. `settings: true`
actions are refused (`loopback_only`) unless the request comes from 127.0.0.1 or ::1.

Who: P person (web app), A agent tool, M chat app over MCP, S settings (loopback only).

| name | kind | who | notes |
|---|---|---|---|
| `list_sources` | read | P A M | demo: the demo shop's six systems (described, not connected); own data: the mart table and its row count |
| `list_suggestions` | read | P | four planner questions; with a model and exploratory on, the GA4 one plus the four exploratory ones |
| `list_metrics`, `explain_metric`, `list_checks` | read | P A M | as in 0.1; `list_metrics` adds `definition`; `list_checks` adds findings |
| `list_metric_entries`, `get_metric` | read | P | the data dictionary; a metric page (definition rows, compiled SQL, 90 days, checks, used in, history, proposal) |
| `decide_metric` | write | P | accept writes the overlay file; Activity row |
| `run_query` | read | P A M | `QueryParams` (+ `compare`) → `QueryResult` with `comparison`, `partial`, `provisional_from` |
| `reconcile` | read | P A M | → `CheckResult` with `series` (period plus 14 days before), `findings[].release/confirmed` |
| `run_all_checks` | write | P A M | stores a check run; flags watches whose 14-day verdict changed |
| `get_check` | read | P | result, previous period, 7 complete weeks, runs, watch (opening it clears `changed`) |
| `watch_check`, `unwatch_check` | write | P | undoable |
| `mark_checks_seen` | write | P | |
| `list_conversations`, `get_conversation` | read | P | |
| `decide_proposal` | write | P | approve runs the watch, pin or event; Activity row with `proposal_id` |
| `undo` | write | P | every undo kind of the prototype (tiles, order, period, watch, dashboards, events, GTM import); `undo_gone` when what it changed was removed since |
| `list_dashboards`, `get_dashboard` | read | P (`list_dashboards` also A, so `propose_pin` gets a real id) | `get_dashboard` → `DashboardResult` (tiles follow the dashboard period and compare; the strip over the same period) |
| `create_dashboard`, `rename_dashboard`, `delete_dashboard`, `set_dashboard_period` | write | P | undoable; one dashboard always stays |
| `pin_answer`, `update_tile`, `move_tile`, `duplicate_tile`, `remove_tile` | write | P | undoable; chart grammar and width rules enforced |
| `list_events` | read | P A M | sorted by date; the model sees them labelled as data |
| `save_event`, `delete_event` | write | P | undoable |
| `import_gtm_events` | write | P | demo: the simulated three GTM versions, undoable; own data: `unavailable` (needs Google Tag Manager API access, planned for ai cloud). No call to Google |
| `start_tracking_audit` | write | P | demo: the simulated run (`status: "done"`); own data: `status: "handoff"` with the MCP steps, no network call |
| `get_audit` | read | P M | |
| `attach_audit_finding` | write | M | `{ audit_id, ok, title, evidence?, fix?, console?, steps? }` from the chat app after the ai tag debugger run; stores the result and, when not ok, a finding on the check |
| `get_chat_app_setup` | read | P | the real snippet: this Node, this repo's `src/cli.js`, this config file and data dir |
| `list_chat_app_calls` | read | P | the last 5 MCP calls (client name from the MCP handshake) |
| `get_settings` | read | P | `Settings`; keys only as `hint` ("…wxyz"), never the key |
| `test_bigquery` | read | P S | seven steps (credentials, jobs, dataset, table, read, `allowed`: "can read the allowed tables", cost) and `warnings: [{ code: "credential_broader", params: { n, datasets } }]` when the credential sees more datasets in the job project (`INFORMATION_SCHEMA.SCHEMATA`) than the list; one real BigQuery round only when the person presses Test. Errors of the `allowed` step: `allowed_denied`, `allowed_location` |
| `save_data_source`, `set_bytes_cap`, `rebuild_demo` | write | P S | write `ai-analyst.config.json`; reopen the warehouse |
| `set_currency` | write | P S | `{ currency }`: an ISO 4217 code Intl knows (case-insensitive), saved as `currency` in `ai-analyst.config.json`; `locked` under `AI_ANALYST_CURRENCY`, `invalid_input` otherwise; Activity row; returns `Settings` |
| `test_model_key`, `save_model_key`, `remove_model_key`, `set_model_provider` | read (test), write | P S | one small real call only when the person presses Test or Save; keys to `secrets.json` (0600) |
| `set_preference` | write | P | `make_it_yours`, `not_now`, `exploratory` |
| `get_workspace` | read | A M | name, demo, data range, rows |
| `publish_answer` | write | A | `{ sentence: Text, title?: Text, query_id? , check_id?, explore_id?, kind?: "answer"\|"why", segment?: { dimension: "device"\|"channel", key }, lead?: "metric"\|"check", followups?: Text[] }`; the number-grounding validator checks both languages; refused twice, then published with `validation.ok = false`. `kind: "why"` needs a check that does not add up and fills `why`; `segment` makes a `check_split` with the segment's figures and `overall`; `lead: "metric"` (the default when the query has a comparison or is not one of the check's metrics) leads with the metric and keeps the check below. `explore_id` with `check_id` is refused: exploratory answers never carry a verdict |
| `decline_question` | write | A | `{ missing?, heading: Text, body: Text, nearest: Text[] }` → the turn's refusal card (`not_in_data`), with the follow-up rule applied to `nearest` |
| `propose_watch`, `propose_pin`, `propose_event`, `propose_metric` | write | A | a pending `Proposal` (or a proposed metric); nothing changes until a person approves |
| `run_sql` | read | A | exploratory only (a model is set and the switch is on); `{ sql, measure, dims, dim_labels?, from, to, unit, label? }`, dims may be `"other"` (a dimension outside the mart, named by `dim_labels`); see "Exploratory SQL" |
| `describe_tables` | read | A P S | `{ refresh? }` → `{ dialect, tables: DescribedTable[] }`: the mart and the allowed tables with columns, types, column descriptions, row counts, partitioning, the description (the person's, else the demo's built-in one) and the protected columns. Read by the server from `INFORMATION_SCHEMA` and `__TABLES__` (BigQuery) or the demo file's catalogue, cached 10 minutes per warehouse and list; never table data. Offered to the model only with exploratory answers on |
| `list_tables` | read | P S | `TableListing`: datasets the credential can see in the data and job projects, with location, `same_location`, and their tables (rows, size, last change) in the mart's location; the demo lists its shop tables |
| `set_explore_tables` | write | P S | `{ allow?: AllowEntry[], max_bytes_per_question? }`: replaces the list for the source in use (BigQuery entries in `explore.allow`, demo entries in `explore.demoAllow` of `ai-analyst.config.json`); a new entry must be in the last `list_tables` (30 minutes) and in the mart's location (`sql_location_mismatch`), and stores its `meta`. `409 locked` under `AI_ANALYST_EXPLORE_ALLOW`. Each added or removed entry is an Activity row |
| `set_protected_columns` | write | P S | `{ table, columns }`: the person's confirmed list for an allowed table (`explore.protected[table] = { columns, confirmed: true }`); Activity row. Not locked by the env var |
| `set_table_description` | write | P S | `{ table, description }` (≤ 200 characters, empty removes): the line the agent sees in `describe_tables`; Activity row |

Removed from 0.1, replaced by the prototype's actions: `pin_answer` (frozen answers) → tiles; `unpin` →
`remove_tile`; `create_alert`, `decide_alert`, `remove_alert` → watches and proposals.

## The agent (src/agent)

- Who answers (`AppState.agent`): the provider chosen in Settings (or `AI_ANALYST_PROVIDER`) when it has a key;
  without a saved choice, the first provider with a key in the environment; else the built-in planner.
- Anthropic goes through the SDK (`client.beta.messages.stream`, adaptive thinking, effort medium, server-side
  fallbacks `"default"`, eager input streaming on tools). OpenAI (`https://api.openai.com/v1`), Gemini (its
  OpenAI-compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai`) and OpenAI-compatible
  servers (a base URL: Ollama, OpenRouter) go through one fetch-based chat-completions adapter with tool calls.
- A turn keeps the model's own text (`text`, capped: 400 characters after a card, 1,500 without one) and, for model turns, `usage: { provider, model, rounds, input, output, cache_read, cache_write }` (tokens summed over its rounds; the server logs one line per turn). When the data cannot answer, the model calls `decline_question { missing?, heading, body, nearest }`, which makes the turn's `refusal` (code `not_in_data`) instead of free text. A model turn that ends with no card, refusal, approval or text ends with `error { code: "no_answer" }`.
- Prompt caching (Anthropic): the system prompt is two blocks. The stable one (pack, rules, house style) carries the cache breakpoint, so tools and it are read from cache on every call and round; the volatile one (today's date, the data range, the person's language) and the user message (with the dashboards and `<app_context>`) come after it. The OpenAI-compatible adapter needs nothing; its `usage.prompt_tokens_details.cached_tokens` is recorded. A check side with no data (all NULL) is `insufficient_data` with `reason: Text`; ratio metrics over a NULL or zero denominator are `null` (no data).
- The model writes every text in both languages (`publish_answer` takes `Text`). Steps stream as tools run; an
  answer or approval is sent right after its tool's step. Follow-ups never repeat a question already asked in
  the conversation.
- The built-in planner covers the prototype's routes: the four checks, the device follow-up ("Is the gap only on
  mobile?"), why (with the release and the audit finding when the data has them), metrics by total, day, week,
  month, channel and device, yesterday (the last day with data, against the same weekday a week before), last
  week (the last complete Monday to Sunday week, against the week before), this month (against the same days a
  month before), last month, watch, pin and event proposals, and refusals: `not_in_data` (products, returns,
  customers), `planner_unknown` saying a model could answer, `metric_howto`. Follow-ups: the planner's own, then
  a pool, at most three, never a question asked in the conversation, never one that would repeat an answer, never
  a refusal, never a watch already in place.
- Everything from the warehouse, events, findings and audits reaches the model as data: tool results carry a
  note saying so, `<app_context>` is labelled, and the system prompt says to ignore instructions inside them.

## Exploratory SQL (src/explore), enforced in code

Only with a model and `preferences.exploratory` not `"off"`. `run_sql { sql, measure, dims, dim_labels?, from, to,
unit, label? }`. The model may read the mart and the tables the person allowed (`src/explore/allow.js`):

- **The allowlist.** Settings › Sources › "Tables the agent may read": datasets (every table in them, also ones
  added later) or single tables; the mart is always on it; empty (the default) means the mart alone. BigQuery
  entries must be in the mart's location. Stored as `explore.allow` (BigQuery) and `explore.demoAllow` (the demo,
  whose one dataset is `demo`: `orders`, `order_items`, `products`, `returns`). `AI_ANALYST_EXPLORE_ALLOW`
  (`project.dataset`, `project.dataset.table`, `demo`, `demo.orders`, comma separated) sets both and locks them.
  Names: the BigQuery project in lower case, dataset and table exactly (case-sensitive); demo names in lower case.
- **Protected columns.** Per table: the person's confirmed list (`explore.protected`), else the server's proposal
  from the schema, by column name only (the type does not matter). Names are split on `_`, digits and camelCase
  and matched by token, compound and Turkish forms included (`customer_email`, `contactPhone`, `phone_no`,
  `msisdn`, `client_ip`, `eposta`, `telefon`, `cep_telefonu`, `ad`, `soyad`, `musteri_adi`, `adres`, `posta_kodu`,
  `dogum_tarihi`, `tc_kimlik_no`): email, phone, names (`name` on a person-like table or after a person word),
  addresses and streets, postcodes, IP and user agent, birth dates, national and tax ids, IBAN, card numbers,
  passwords and tokens, advertising and device ids, precise location. **Readable by default** (the owner's
  decision, 25 Oct): customer and user ids (`user_id`, `customer_id`, `customer_key`, `user_pseudo_id`, `id` of a
  person-like table), city, age and gender. One default list decides those four groups:
  `protection.yaml` in the pack (`optional: { person_ids, city, age, gender }`, all `false` as shipped; read into
  `config.protection`, used by `proposeProtected` in `src/explore/allow.js`). So per-customer rows without contact
  data can reach the model provider (at most 200 rows per query) and are stored on this machine (at most 1,000
  rows per query; a query's result is pruned after 30 days, at start and daily, while a published answer keeps its
  rows in app.db until that file is deleted); Settings › Sources can protect them. Protection is by column name: a column
  with an unusual name, or a view that renames one, is not protected until the person adds it, and a view is
  readable only when added by name (not through its dataset). The proposal is enforced until confirmed; a table
  whose schema cannot be read is refused. No masking.
- **Where a protected column may appear** (security review 2, H2, V1, V2): only as a join key compared with a
  column of another allowed base table (`JOIN … ON a.col = b.col`, each side a bare column qualified by a base
  table's alias, never a CTE's or derived table's column; or `USING (col)` when no CTE or derived table is read),
  the same inside a parenthesised join, and alone inside
  `COUNT(DISTINCT col)`. Everywhere else it is `sql_protected_column`: the select list, `GROUP BY`, `ORDER BY`,
  `WINDOW`, `WHERE`, `HAVING`, `QUALIFY`, an `ON` condition against a value, `CASE`, `LIKE`, `IN`, `COUNTIF`, a
  bare `COUNT(col)`, any function, any comparison with a constant. What can leave is the number of distinct values.
  A self-join, or a join to any column of an allowed table, is allowed; it tells whether values are equal, never what they are. A query that uses a protected column cannot contain a CTE or a subquery. (security review 2, V2: enforced structurally, any CTE or subquery in such a query is
  `sql_protected_column`.) A tile re-run guards the query inside its outer `LIMIT` wrapper.
- **The per-question cap.** All exploratory queries of one turn share `explore.maxBytesPerQuestion` (5 GB by
  default; `set_explore_tables`, at most ten times `BIGQUERY_MAX_BYTES`, `over_ceiling` above); on BigQuery a
  query's cap is the lower of `BIGQUERY_MAX_BYTES` and what is left, and its dry-run bytes count before it runs,
  so a run that fails after billing still counts. DuckDB is local and not billed: no per-question cap there.
- **Warehouse errors on exploratory queries** never pass their text to the model or the UI: BigQuery a fixed
  sentence; DuckDB a fixed sentence per kind (`explore_sql_error`, `params.kind`: `syntax`, `names`, `values`,
  `other`), only the kind logged, since DuckDB's text can quote a value from the data.
- **describe_tables** gives the model the structure (no data); the model may never query `INFORMATION_SCHEMA`.

Three fences, each enough on its own to keep other tables out (security review H1, 24 Oct):

1. **The guard** (`src/explore/guard.js`, refusal codes with plain words in `GUARD_MESSAGES`):
   - the query is read the way the warehouse reads it; whatever could be read differently is refused
     (`sql_unsupported_syntax`): block comments (DuckDB nests them, BigQuery does not), backslash escapes,
     `E''`/`r''`/`b''` prefixes, triple quotes, `$` strings, `@` variables, `?` parameters, non-ASCII punctuation;
     `#` is a comment only in BigQuery;
   - one statement (a single trailing `;` is dropped; any other is `sql_multiple_statements`), starting with
     `SELECT` or `WITH` (`sql_not_select`);
   - no keyword that writes, loads, changes settings or names a statement form the guard does not walk, anywhere
     (`sql_forbidden_keyword`): `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `CREATE`, `DROP`, `ALTER`, `COPY`,
     `ATTACH`, `INSTALL`, `LOAD`, `PRAGMA`, `SET`, `CALL`, `EXPORT`, `EXECUTE`, `DECLARE`, `INTO`, `TABLE`,
     `PIVOT`, `UNPIVOT`, `SAMPLE`, `TABLESAMPLE`, `MODEL`, `SESSION_USER`, `CURRENT_USER`, `INFORMATION_SCHEMA`,
     `EXTERNAL_QUERY`, …;
   - **functions by allowlist** (`ALLOWED_FUNCTIONS`, security review M3): only aggregate, window, math, date,
     string, conditional and cast functions may be called, plus BigQuery's `SAFE.` prefix on one of them; any
     other name before `(`, any other qualified call (`AI.*`, `ML.*`, `OBJ.*`, `KEYS.*`, `AEAD.*`, `NET.*`,
     `main.getenv`) and any quoted function name is `sql_forbidden_function`;
   - every table after `FROM`, `JOIN`, a comma in a `FROM` list, or the opening parenthesis of a `FROM` item or a
     parenthesised join, is on the allowlist (BigQuery: written in full, `project.dataset.table`; no wildcard, no
     `__TABLES__`) or a CTE of the top-level `WITH`; a CTE defined inside a subquery does not count, a string used
     as a table, `LATERAL`, `UNNEST` and anything else is `sql_table_not_allowed` with `params.table`; a comma at
     the depth of a `WHERE`, `HAVING`, `QUALIFY` or `ON` condition is refused;
   - **protected columns** (`sql_protected_column`, `params.column`): allowed only as a join key compared with
     another column (`ON a.col = b.col`, `USING (col)`) and alone inside `COUNT(DISTINCT col)`; refused anywhere
     else, in any clause and any subquery. A `*` or `t.*` when any table read has a protected column, or a table
     alias alone (a whole row as a struct), is refused in a select list. Unqualified names count against every
     table read; qualified ones against their own table. After the run, a result column named like a protected
     column is refused too;
   - a top-level `WITH` name equal to an allowed table, or to a table the query reads, is `sql_table_not_allowed`
     (DuckDB would resolve the name to the table inside the CTE's own body or before it is defined).
2. **The warehouse checks again.** BigQuery: the dry run is authoritative; the query is refused before it runs
   unless every entry of `statistics.query.referencedTables` and `referencedViews` is on the allowlist (not empty,
   fewer than 50) and `statementType` is `SELECT`; a dry run that fails on location is `sql_location_mismatch`,
   any other failure a fixed sentence. Then it runs with `maximumBytesBilled` = the cap, `useLegacySql: false` and
   a job timeout; compiled metric queries keep the mart-only check. DuckDB: the query runs in a separate database
   file, `<demo>.explore-<hash of the list>.duckdb`, holding copies of the allowed tables and nothing else, rebuilt
   when the demo file or the list changes, opened read-only with `enable_external_access=false` and the
   configuration locked, on its own connection with a 10 s timeout; another table cannot be named at all.
3. **The result:** the statement runs wrapped as `SELECT * FROM (<sql>) AS q LIMIT 1000`; the model sees at most
   200 rows (labelled when cut) and the tables read; the answer is `kind: "explore"`, never a verdict or a
   definition, and lists `explore.tables` under the SQL. Warehouse errors reach the model and the UI without
   paths (DuckDB) or as a fixed sentence (BigQuery; the detail goes to the server log).

`test/guard.test.js` holds the attack list (`test/attacks.js`) with the mart alone: every query of the security
review's scripts plus ours, each refused by the guard and also run unguarded on the real DuckDB explore path
against a demo file that holds a secret table. `test/explore.test.js` runs the same list with two allowed tables
and a decoy in the same dataset (guard and DuckDB path), cross-table attacks, stubbed BigQuery dry runs
(referenced tables, views, statement type, location, the per-question cap), protected columns, the settings and
the env lock, `describe_tables`, the demo shop's totals and a model turn across tables.

The demo shop (`src/demo/seed.js` `generateShop`): `orders` (one row per order: date, channel, device, invented
`customer_id`, `is_first_order`, `order_total`), `order_items`, `products` (120, eight categories) and `returns`,
generated from the mart's own rows with the same seed, so `COUNT(*)` and `SUM(order_total)` of `orders` equal the
mart's orders and revenue for every day, channel and device, and order lines sum to their order. No names or
contact data. On the demo, Ask offers one cross-table chip with a model: "Which product categories are returned
most often?".

## Connectors and the local source (CONNECTORS.md, 25 Oct)

**Sources.** The active source is one of `demo`, `bigquery` and `local` (`AI_ANALYST_WAREHOUSE` or the config
file's `warehouse`: `duckdb` for the demo, `bigquery`, `local`). `local` is `<data_dir>/warehouse.duckdb`, a DuckDB
file the connectors feed. The mart reads only from the active source. A connect or an import switches to `local`
only when the app is on the demo and `AI_ANALYST_WAREHOUSE` does not fix the source. From BigQuery, or from a source
the environment fixes, the data lands in `warehouse.duckdb` but the app keeps reading what it read: the person
switches by hand (`save_data_source { kind: "local" }` in Settings › Sources, or `AI_ANALYST_WAREHOUSE=local`
and a restart), and the connect or import result's `warnings` carries one line that says so (the line is in the
result only, not in the stored state). `save_data_source { kind: "demo" }` switches back, keeping the local data.
Resetting the demo (`rebuild_demo`) empties the demo workspace but keeps the connectors' data: their state, landing
rows and covered days.
Disconnecting the last connected source while on `local` switches back to the demo (the `disconnect_source` result's
`warnings` says so); when `AI_ANALYST_WAREHOUSE` fixes the source, it stays, and the warning says that instead.
On `local`, `list_suggestions` and the follow-ups offer only questions and checks the connected sources can answer
(no Meta or Google Ads check and no ROAS, CPA or ad spend without ad data; no GA4 check without GA4 and an orders
source); replacements come from revenue by channel, conversion rate, orders and AOV by device, revenue by day.
Events belong to a data source (`data_source`: `demo`, `bigquery` or `local`, set when an event is added or
proposed): the demo's events stay with the demo, and each source lists only its own (events saved before this field
existed show on every source, except the demo's own four). An insufficient-data reason names the metric by its
pack label ("No data for GA4 purchases…").

**Privacy.** Only daily aggregates are kept. For a shop with few orders a day, one aggregate (a day, channel and
device) can be a single order, so its amount and time of day can be told apart even though no order row is stored.
`AppState.connectors` seen from another machine (a token holder) carries no shop domain, GA4 property or file name,
and errors by code only.

**Landing tables and the mart.** Connectors store **daily aggregates only**, in `landing_ga4` (date, channel,
device, sessions, ga4_purchases, ga4_revenue) and `landing_orders` (source: `orders_file` | `shopify` |
`woocommerce`; date, channel, device, orders, revenue). After every sync or import the server writes a fresh
`warehouse.duckdb` (landing tables plus `daily_channel_device` built from them with DuckDB SQL, a full outer join on
date, channel and device) and swaps it in atomically, so readers such as the MCP server never see a half-written file.
A sync replaces exactly the days (and source) it fetched. Columns a connector does not fill stay NULL: on `local`
`platform_conversions` and `ad_spend` are always NULL, so ROAS, CPA, ad spend and the Meta and Google Ads checks say
"no data". When both an orders connector and the file cover a day, each source keeps its own rows and the mart sums
orders per date, channel and device across them (the person should use one orders source; the Sources screen says so).

**Dimensions.** Channel gains `referral` (en "Referral", tr "Yönlendirme"), `organic_social` (en "Organic social", tr
"Organik sosyal"), `other` (a group or source with no mart channel) and `unknown` (the source cannot attribute);
device gains `unknown`. In the orders file, Shopify and WooCommerce, a `referral` medium, a referring site with no
medium, or WooCommerce's `referral` source type is referral; a social medium, or a social network as the source
without a paid medium, is organic social; a paid medium from Facebook or Instagram stays meta_ads. Breakdowns list only the segments present in the data, so the demo's
breakdowns stay mobile and desktop. When a check side has no device split (all `unknown`), the check runs on totals
with `breakdown: []` and `breakdown_available: false`.

**GA4 (Analytics Data API v1beta `runReport`, REST through google-auth-library, scope `analytics.readonly`).**
Dimensions `date`, `sessionDefaultChannelGroup`, `deviceCategory`; metrics `sessions`, `transactions` (purchase
events with a transaction id, the closest match to the mart's distinct-`transaction_id` GA4 purchases),
`purchaseRevenue`. Channel groups: Organic Search → organic, Direct → direct, Paid Search → google_ads, Paid Social →
meta_ads only when the session source is Facebook or Instagram (TikTok → tiktok_ads; Paid Search → google_ads only
from Google; any other paid platform → other; the report adds `sessionSource` for this), Email → email, Referral →
referral, Organic Social → organic_social, Unassigned and (not set) → unknown, every other group (Organic Video,
Affiliates, Display…) → other. Devices: mobile and tablet →
mobile, desktop → desktop, anything else → unknown. Auth as BigQuery: application default credentials, a key file,
or impersonating a service account. Test steps: credentials, property, report (one day), range (first and last day
with data), flags (thresholding, sampling, `(other)` row: a warning, not a failure), quota (tokens left per day).
Only `analyticsdata.googleapis.com` is called. When impersonating, the source credential is scoped
`cloud-platform` (IAM `generateAccessToken` needs it) and the minted token `analytics.readonly`.

**Orders file (CSV or XLSX, at most 25 MB).** `POST /api/uploads/orders` with the raw file as the body (loopback
only; Host, Origin and Sec-Fetch-Site checks as for actions; streamed to `<data_dir>/uploads/` mode 0600). XLSX is
read without a new dependency (the zip directory and `node:zlib`, the first sheet, shared strings, serial dates).
An XLSX may unpack to 50 times its size, at most 200 MB, else `file_unreadable`; a damaged character reference is
`file_unreadable` too.
The server returns the header, a guessed mapping, the status values with counts, and a preview of the **daily
aggregates** only. `import_orders_file` writes the aggregates and deletes the file; uploads older than an hour are
deleted. Times: an ISO time with an offset is converted to the chosen time zone (default `Europe/Istanbul`); a time
without one is read as local time there; Excel serial dates as local times. Currency: a mapped currency column must
match the workspace currency on every counted row, else `currency_mismatch`; no column means the workspace currency.
Excluded: the statuses in `exclude_statuses` (the guess pre-selects test orders only; cancelled orders are counted,
as in Orders v3, since GA4 records the purchase before any cancellation, and the preview says so in one line), rows
without a date and rows without a readable total. Channel from a channel column or UTM
source/medium; device from a device column or a user agent; else `unknown`.

**Shopify (Admin GraphQL API, a custom app's Admin API access token with `read_orders`; shop `*.myshopify.com`).**
Orders by created time; per order only the creation time, test and cancelled flags, total and currency, and the last
visit's source and UTM source/medium (`customerJourneySummary`); device is `unknown` (the GraphQL API has no user
agent). Test orders are left out; cancelled orders are counted, as in Orders v3. Scopes are read from `currentAppInstallation.accessScopes`; a
`write_*` scope is refused (`scope_write`), and so is any scope beyond `read_orders`, `read_all_orders` and the
short read-only allowlist `read_products`, `read_analytics`, `read_reports`, `read_locations` (`scope_extra`, with
the reason; `read_customers` and the other scopes that read people's data are named as such). Pagination by cursor; THROTTLED or 429 stops the sync with `rate_limited`
and stores nothing for that run.

**WooCommerce (REST API v3, a consumer key and secret with Read permission, HTTPS only).** `GET /wp-json/wc/v3/orders`
with `_fields=id,status,date_created_gmt,total,shipping_total,currency,meta_data` (no names, emails or addresses are requested), by
page. The REST API cannot pick meta entries by key, so it **sends every meta entry of each order** (plugins may keep
personal data there: a tax id, a phone number, the visitor's user agent). The app reduces each order on arrival to
those fields and four attribution values (`_wc_order_attribution_utm_source`, `_utm_medium`, `_source_type`,
`_device_type`) and discards the rest of the meta there: it is never stored, logged or passed on. Channel and device
come from those four values. Statuses `failed`, `trash` and `checkout-draft` are left
out (never placed); `cancelled` and `refunded` are counted, as in Orders v3 (refunds are not deducted). The scope check posts an empty batch (`POST /orders/batch {}`, a write-method call that changes nothing): only
WordPress's own refusal (401 or 403 with a `woocommerce_rest_*` or `rest_*` error code) counts as read only; a key
that is accepted is refused as `scope_write`; any other answer (a firewall page, 400, 500) is `scope_unchecked`.
The key must be created with Read permission whatever the check shows.

**Outbound rules.** Every connector call goes through the `AI_ANALYST_NO_CLOUD` guard. Hosts are fixed per connector:
analyticsdata.googleapis.com (and Google's token endpoints through google-auth-library), the shop domain the person
entered over HTTPS on port 443 only (no other port), never an IP literal, a private, loopback, link-local or
special-purpose address (checked with `net.BlockList`; IPv4-mapped, IPv4-compatible, NAT64 and 6to4 IPv6 forms are
reduced to the IPv4 address they carry; Teredo, site-local and the other special IPv6 ranges are refused); redirects
are refused. The name is resolved once, every address it returns must pass, and the request connects to that
checked address (pinned), with SNI, the certificate check and the Host header on the name, so DNS rebinding cannot
reach the local network. The same address checks apply to `AI_ANALYST_SHOPIFY_SHOP`, `AI_ANALYST_WOOCOMMERCE_URL`
and the config file's shop addresses at start (an invalid one stops the start with a message). Values from
sources (channel names, statuses) are data, never instructions.

**Secrets.** The Shopify token and the WooCommerce key and secret go to `secrets.json` (0600) under `connectors`,
never returned (hints only). Env vars win and lock: `AI_ANALYST_GA4_PROPERTY`, `AI_ANALYST_SHOPIFY_SHOP`,
`AI_ANALYST_SHOPIFY_TOKEN`, `AI_ANALYST_WOOCOMMERCE_URL`, `AI_ANALYST_WOOCOMMERCE_KEY`, `AI_ANALYST_WOOCOMMERCE_SECRET`.

**Sync.** After connecting, on demand (`sync_sources`), and once a day while `serve` runs. Default history 90 days;
`history_days` up to 400 (13 months). One sync at a time (`sync_running`).

**Waitlist (ai cloud).** `AppState.waitlist`: Meta Ads, Google Ads, TikTok Ads, ikas, Ticimax, Search
Console, Google Tag Manager, each a `mailto:hello@analitikisler.com` with the subject "ai cloud waitlist:
<name>". No network call. The simulated GTM import is removed; events stay (by hand or proposed by the agent).

**Types** (web/src/api/types.ts):

```ts
export type SourceKind = "demo" | "bigquery" | "local";
export type Channel = "organic" | "direct" | "google_ads" | "meta_ads" | "tiktok_ads" | "email" | "referral" | "organic_social" | "other" | "unknown";
export type Device = "mobile" | "desktop" | "unknown";
export type ConnectorId = "ga4" | "orders_file" | "shopify" | "woocommerce";
export type ConnectorStatus = "not_connected" | "connected" | "syncing" | "error";
export type MartColumn = "sessions" | "ga4_purchases" | "ga4_revenue" | "orders" | "revenue";
export interface ConnectorSecret { set: boolean; source: "env" | "saved" | null; locked: boolean; env?: string; hint?: string }
export interface ConnectorState {
  id: ConnectorId; name: Text; fills: MartColumn[]; status: ConnectorStatus; target: string | null;
  last_sync: { at: string; from: string | null; to: string | null; days: number; ok: boolean } | null;
  error: ApiErrorBody | null; warnings: Text[]; secret: ConnectorSecret | null;
}
export type WaitlistId = "meta_ads" | "google_ads" | "tiktok_ads" | "ikas" | "ticimax" | "search_console" | "gtm";
export interface WaitlistItem { id: WaitlistId; name: Text; mailto: string }
export interface ConnStep { id: string; status: "ok" | "failed" | "skipped" | "warning"; detail?: Record<string, string | number>; error?: { code: string; params: Record<string, string | number> } }
export interface ConnectorTest { test_id: string; connector: ConnectorId; ok: boolean; steps: ConnStep[]; warnings: Text[] }
export interface OrdersMapping {
  order_id: string | null; created_at: string; status: string | null; total: string; currency: string | null;
  channel: string | null; utm_source: string | null; utm_medium: string | null; device: string | null; user_agent: string | null;
  exclude_statuses: string[];
}
export interface OrdersPreview {
  from: string | null; to: string | null; days: number; orders: number; revenue: number; currency: string;
  excluded: { status: number; no_date: number; bad_total: number };
  daily: { date: string; orders: number; revenue: number }[];
  channels: { key: Channel; orders: number }[]; devices: { key: Device; orders: number }[]; warnings: Text[];
}
export interface OrdersUpload {
  upload_id: string; file_name: string; kind: "csv" | "xlsx"; columns: string[]; mapping: OrdersMapping;
  statuses: { value: string; count: number }[]; time_zone: string; preview: OrdersPreview;
}
// AppState: source.kind: SourceKind; connectors: ConnectorState[]; waitlist: WaitlistItem[]
// Settings.data_source.kind: SettingValue<SourceKind>
// CheckResult: breakdown_available?: boolean
```

Actions: `list_connectors`, `test_ga4 { property_id, auth }`, `connect_ga4 { test_id, history_days? }`,
`test_shopify { shop, token? }`, `connect_shopify { test_id, history_days? }`, `test_woocommerce { url, key?,
secret? }`, `connect_woocommerce { test_id, history_days? }`, `preview_orders_file { upload_id, mapping?,
time_zone? }`, `import_orders_file { upload_id, mapping, time_zone }`, `sync_sources { connector?, history_days? }`,
`disconnect_source { connector }` (removes its settings, secrets and landing rows); `save_data_source` accepts
`{ kind: "local" }`; `import_gtm_events` is removed. All of them are person-only and settings (loopback only).
Results: `list_connectors` and `sync_sources` return `ConnectorState[]`; `test_*` return `ConnectorTest`;
`connect_*`, `import_orders_file` and `disconnect_source` return the one `ConnectorState` of that connector (after a
disconnect it reads `not_connected`; `list_connectors` gives all four); `preview_orders_file` returns `OrdersUpload`
(the columns, mapping, statuses and time zone with the `preview: OrdersPreview` under them), as does
`POST /api/uploads/orders`. Upload content types: `text/csv`, `application/vnd.ms-excel` (what browsers on Windows
send for a .csv when Excel is installed; read as CSV, a real .xls file is refused as `upload_kind`), the XLSX type
and `application/octet-stream` (kind from the name and the first bytes).
Action names are lower case with digits and underscores (`/^[a-z][a-z0-9_]*$/`: `test_ga4`, `connect_ga4`).
New error codes: `upload_too_large` (413), `upload_kind`, `file_unreadable`, `upload_not_found`, `mapping_invalid`,
`currency_mismatch`, `connector_not_connected`, `sync_running`, `scope_write`, `scope_extra`, `scope_unchecked`, `api_disabled` (params `service`, `project`, `link`: a console.cloud.google.com page that enables the Data API), `property_api_denied`, `property_not_found`,
`host_not_allowed`, `shop_unreachable`; reused: `key_rejected`, `rate_limited`, `no_cloud`, `source_unavailable`.

## Settings, secrets and configuration

Order: environment, then `ai-analyst.config.json` (non-secret, safe to commit; unknown keys kept on write), then
`<data_dir>/secrets.json` (model keys only, written with mode 0600). An environment variable wins and locks the
field (`SettingValue.locked`, `env`); writing a locked field is `409 locked`. Keys never leave the server except
as a four-character hint.

| Variable | Meaning |
|---|---|
| `PORT` (8787), `HOST` (127.0.0.1) | where the server listens; `--port`, `--host` on the command line |
| `AI_ANALYST_DATA_DIR` (`./data`), `--data-dir` | demo.duckdb, app.db, secrets.json, metrics/ (the overlay) |
| `AI_ANALYST_CONFIG` | the config file (default `./ai-analyst.config.json`) |
| `AI_ANALYST_TOKEN` | required for any host but loopback; at least 24 characters |
| `AI_ANALYST_ALLOWED_HOSTS` | extra Host names, comma separated (also `allowedHosts` in the file) |
| `AI_ANALYST_WAREHOUSE` | `duckdb` (the demo), `bigquery` or `local` (your shop's data from the connectors); set, it fixes the source, and a connect or import does not switch it |
| `BIGQUERY_PROJECT`, `BIGQUERY_JOB_PROJECT`, `BIGQUERY_DATASET`, `BIGQUERY_LOCATION` (EU) | the mart and where jobs run |
| `BIGQUERY_MAX_BYTES` (2 GB) | the ceiling of the bytes cap; Settings can only lower the cap below it |
| `BIGQUERY_JOB_TIMEOUT_MS` (60000) | job timeout |
| `AI_ANALYST_CURRENCY` (TRY) | the ISO 4217 code money is written in; locks Settings › Sources › Currency (also `currency` in the file) |
| `AI_ANALYST_EXPLORE_ALLOW` | the tables exploratory answers may read besides the mart, comma separated: `project.dataset`, `project.dataset.table`, `demo`, `demo.orders`; locks the list in Settings |
| `GOOGLE_APPLICATION_CREDENTIALS` | a key file path; otherwise gcloud application default credentials. Never stored |
| `AI_ANALYST_PROVIDER` | `planner`, `anthropic`, `openai`, `gemini`, `openai_compatible` |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `AI_ANALYST_OPENAI_COMPATIBLE_KEY` | model keys |
| `AI_ANALYST_OPENAI_COMPATIBLE_URL` | base URL of an OpenAI-compatible server |
| `AI_ANALYST_MODEL` | the active provider's model (defaults: claude-opus-5-5, gpt-5.5, gemini-pro-latest) |
| `AI_ANALYST_CLOUD_URL`, `AI_ANALYST_CLOUD_TOKEN` | ai cloud, an Anthropic-compatible endpoint |
| `AI_ANALYST_NO_CLOUD` | `1`: every call to an outside service is refused with `no_cloud` (see below); `--no-cloud` on `serve` sets it |
| `AI_ANALYST_WORKSPACE`, `AI_ANALYST_LANG`, `AI_ANALYST_HELP`, `AI_ANALYST_HELP_EMAIL`, `AI_ANALYST_PACK_DIR` | as in 0.1; with no workspace name set, demo data is "Örnek Moda" and own data is named after the BigQuery dataset (else the project) |

Watched checks run again when the server starts, every hour while it runs, and on every `ai-analyst check`.

## No outside calls (src/cloud.js)

With `AI_ANALYST_NO_CLOUD=1` the process makes no call to an outside service. The check sits where the real
clients are made, so nothing can go around it, while a stub a test injects still works:
`bigQueryClient()` (the BigQuery warehouse and the real `test_bigquery` tester), the Anthropic client in
`test_model_key` and in model turns, and the `fetch` of the OpenAI-compatible adapter (OpenAI, Gemini, a base
URL) and of `test_model_key`. A refused call is `{ code: "no_cloud", message, params: { service } }` (HTTP 503);
a model turn ends with `error { code: "no_cloud" }`. Local work keeps going: the demo warehouse, the planner,
reading local credential files.

It is on by default for `npm test` / `bun run test` / `bun test` (`test/setup.js`, imported by every test file and
preloaded by the scripts), for `bun run dev` (`src/dev.js`) and for the smoke server (`serve --no-cloud`,
`bun run smoke:server`). `AI_ANALYST_NO_CLOUD=0` overrides it for `dev` and the smoke server, to try a real key
or BigQuery on purpose.

## Security baseline (src/server.js)

- Binds 127.0.0.1 by default. Any other address needs `AI_ANALYST_TOKEN`, and then every request needs it: a
  `Authorization: Bearer` header, or the `ai_analyst_token` cookie (HttpOnly, SameSite=Strict, Secure on TLS) set
  by one visit to `/?token=…`, which then redirects to drop the token from the address bar.
- Host header allowlist: `localhost`, `127.0.0.1`, `[::1]` with the server's port, the bound address, and
  configured names; anything else is 403 (DNS rebinding).
- `Origin`, when present, must equal the Host on every `/api/*` request and every non-GET; `Sec-Fetch-Site` other
  than same-origin or none is refused on `/api/*`; a POST without an Origin must be JSON; no CORS headers at all
  and no preflight answer.
- JSON bodies up to 1 MB (413), `requestTimeout` 60 s, `headersTimeout` 15 s; errors without stack traces or paths.
- The page: `Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-…'` (the hash of each inline
  script in `index.html`, the theme bootstrap, computed when the file changes); `style-src 'self'
  'unsafe-inline'` (React and the chart library set style attributes); `img-src 'self' data:`; `connect-src
  'self'`; `object-src 'none'`; `base-uri 'none'`; `form-action 'self'`; `frame-ancestors 'none'`. All responses:
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
  `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`.
- Settings-changing actions only from this machine (`loopback_only`), decided by the socket address alone, never by
  a header. A request that carries any forwarding header (`Forwarded`, `X-Forwarded-For`, `X-Forwarded-Host`,
  `X-Forwarded-Proto`, `X-Real-IP`, `Via`) is never local, whatever the header says, so a reverse proxy on the
  same machine cannot open settings to remote users. Behind a proxy, change settings on the machine itself
  (the server's own port, not through the proxy) or with the config file and env vars. A proxy must send at
  least one forwarding header (Caddy and nginx's usual `proxy_set_header X-Forwarded-For` do); one that sends
  none makes every request look local, so do not run token mode behind such a proxy. `get_chat_app_setup` is
  local only too, and `get_settings` from elsewhere carries no paths (security review M4, L2).
- Token mode is for a trusted network: the server speaks plain HTTP, so the token and cookie travel in clear
  text unless a TLS proxy is in front (then the cookie is `Secure` when the proxy sends `X-Forwarded-Proto:
  https`). After the one `?token=` visit the server always redirects to `/`. The `Origin` check compares the
  scheme too (`http://`, or `https://` behind a TLS proxy that says so).
- The data dir is created `0700`; `app.db`, `demo.duckdb` and `secrets.json` are `0600`; temporary files have
  unpredictable names and are created exclusively. On Windows file modes are not enforced: keep the data dir in
  the user's profile.
- Model servers: an OpenAI-compatible key that is saved or set in the environment is only ever sent to the saved
  (or env-locked) base URL; a different base URL in a request needs its own key in the same request
  (`key_required`) and cannot replace an env-locked one (`locked`); plain `http://` only to this machine
  (127.0.0.1, localhost, [::1]); never link-local or cloud metadata addresses, never a URL with a user name
  (`invalid_base_url`) (security review M2). Model calls time out (two minutes per response for the fetch
  adapter, five minutes with two retries for the Anthropic client).

## Parity with the prototype

`test/parity.test.js` replays the prototype mock server's recorded results (`test/fixtures/mock-parity.json`,
recorded with Bun from `PROTO/src/api/mock/*.ts` on its demo mart export) against this server on the same demo:
the seeded state, every catalogue action, metric pages, check details, the example dashboard and its periods,
run_query and reconcile cases, the simulated audit and GTM import, and five scripted conversations (32 turns, en
and tr: steps, sentences, titles, interpretations, follow-ups, refusals, proposals). Ids, times and durations are
ignored. `test/guard.test.js` checks the four exploratory queries against `fixtures/mock-explore.json`.

### Where the mock and the repo disagreed, and what 0.2 does

| Topic | 0.1 repo | Prototype mock | 0.2 |
|---|---|---|---|
| Server strings | one language per record | `Text` everywhere | mock |
| Answers | `metric`, sentence string, a check added to revenue questions | `kind`, `metrics[]`, `interpretation`, `why`, `overall`, `explore`, no unasked check | mock |
| Pins and alerts | `pin_answer` freezes an answer; alerts with approval | dashboards and tiles that follow the period; watches; proposals | mock; alert actions removed |
| Planner routes and default periods | 14 days for everything, plain sentences | the routes above; 7 days for a number, 28 for a split, 90 for weeks | mock |
| Verdict at exactly the tolerance | `<=` on floats | `<= tolerance + 1e-12` | mock |
| Date ranges across years | end year only | both years | mock |
| Turkish labels | "arka ofis" | "sipariş paneli" | mock, written into metrics/*.yaml and checks/*.yaml |
| `list_sources` | `{ sources }`, included Search Console | an array of six | mock |
| `/api/state` | 0.1 shape | `AppState` | mock |
| Turn `created_by` | agent or planner | person (who asked) | mock |
| Metric history | none | seeded in code | in `metrics/*.yaml` `history:` |
| Tracking audit | none | simulated always | simulated on demo; handoff on own data |

### Deliberate differences from the mock

- The Meta "why" sentence keeps the capital in "ai tag debugger found that Meta counts …" (the mock lower-cased
  the first letter of the finding).
- `list_events` is sorted by date (the mock listed insertion order; its state was already sorted).
- The exploratory suggestions are known questions too, so a turn started from one keeps both languages.
- The v4.12 event proposal is offered on demo data only; the release is the demo's.
- A check in an answer carries `findings[].confirmed` once an audit confirmed it (the mock showed it only on the
  strip and the check sheet).
- `AuditRun.status` is always present; `audit_fixed` is always false (the reviewer menu's "Simulate the fix" does
  not exist here).
- The proposed-metric note says accepting writes `metrics/` in the data folder (the mock's demo note said it was
  saved in the prototype only).
- The why sentence names the release and the audit finding only when the data has them (on the demo it reads
  exactly as the mock's).

### Simulated and real

Real: every figure (SQL compiled from the pack, run on DuckDB or BigQuery), checks, series and weeks, the planner,
the model loop (with a key), exploratory SQL through the guard, settings and secrets, dashboards, events,
proposals, undo, the MCP server and its call log, the chat-app snippets. Simulated, on demo data only: the demo
shop's source list, the GTM import (three scripted versions), the tracking audit run (scripted to the planted
bug). On own data the GTM import is unavailable and the audit is a handoff to ai tag debugger in the chat app.

## Exceptions

- zod 4.6.6 was published on 11 Oct 2026, 13 days before this pin, one day short of the two-week rule. It is the
  first release with the fix for GHSA-mrhx-c7xc-m3w5 (high: memory exhaustion while validating oversized
  constrained collections, zod < 4.6.6); 4.6.7 (12 Oct) is newer still. The advisory outweighs one day of age;
  `npm audit` reports 0 vulnerabilities. Chosen at the lead engineer's request, 24 Oct; move to a later release once it is two weeks old.

## Packaging

`npm pack` and `npm publish` run `prepack` (`bun run build`, then `src/pack.js copy`: web/dist → web-dist/) and
`postpack` (removes web-dist/). The package ships `src`, `web-dist`, `metrics`, `checks`, `models`, `docs`,
`README.md` and `LICENSE`; no tests, fixtures, data or secrets. The server serves `web/dist` in a checkout and
`web-dist` in an installed package.

## Commands

```sh
bun install && bun run build                    # web/dist
ai-analyst serve --data-dir /tmp/aa-smoke       # a fresh data dir seeds the demo on first start (port 8787)
rm -rf /tmp/aa-smoke && node src/cli.js serve --port 8788 --data-dir /tmp/aa-smoke --no-cloud
                                                # the smoke server for the web app's smoke:http (bun run smoke:server
                                                # without the rm); no outside calls; AI_ANALYST_NO_CLOUD=0 to override
bun run dev                                     # server on 8788 + Vite on 5190, no outside calls unless AI_ANALYST_NO_CLOUD=0
bun run test  |  bun test ./test/               # Node's runner, or Bun's
```
