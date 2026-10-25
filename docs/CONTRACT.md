# AI Analyst · build contract, version 0.2

AI Analyst is Analitik İşler's analytics tool that people and an agent use together. A person asks a question in Turkish or English; the
agent answers with a chart, the SQL it ran, the versioned metric definition and a tracking check that reconciles
the figure against the system that owns it. Every UI action, agent tool and chat-app tool is the same action
from one registry.

This file is the binding spec between the engineers. Change it only through the lead engineer, never silently on
one side. Version 0.2 (24 Oct 2026) replaces 0.1: the web app is the approved prototype's React app, its API is
`web/src/api/types.ts`, and the prototype's mock server is the reference behaviour (see "Parity" below).

## Conventions

- Runtime: Bun ≥ 1.3 is the primary tool (`bun install`, `bun run build`, `bun run test`, `bun test ./test/`);
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
    actor: Bahadır Ölez
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
// Tracking audits on own data are handed off to AI Tag Debugger (agreed with the lead, 24 Oct).
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
export interface ExploreSpec { measure: "revenue" | "orders" | "sessions" | "ad_spend" | "aov" | "spend_growth" | "other"; /* … */ }
// Errors may carry params (already in ApiErrorBody): e.g. { env } for locked, { bytes, cap } for bytes_cap.
```

`deep_link` is always `null` in 0.2 (AI Tag Debugger has no deep link scheme yet); `mcp_steps` are four lines,
each starting with the MCP server and tool: `ai-tag-debugger start_audit {url, journey: "purchase", providers,
device}`, `ai-tag-debugger browser_action …`, `ai-tag-debugger finish_audit`, `ai-analyst attach_audit_finding
{audit_id, …}`.

## HTTP API (src/server.js)

- `GET /api/state?lang=` → `AppState`.
- `POST /api/actions/:name`, JSON body → `200 { ok: true, result }`, or `{ ok: false, error: { code, message,
  params? } }` with 400 (`invalid_input`, `bad_request`), 401 (`unauthorized`), 403 (`forbidden`,
  `loopback_only`), 404 (`not_found`, `unknown_action`), 409 (`locked`, `not_pending`, `already_undone`,
  `undo_gone`, `only_one`, `test_required`, `over_ceiling`, `no_data`, `unavailable`, `not_undoable`), 413
  (`too_large`), 415 (`unsupported_media`), 422 (`bytes_cap`), 500 (`internal`, a fixed sentence, never a stack or
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
| `import_gtm_events` | write | P | demo: the simulated three GTM versions, undoable; own data: `unavailable` (needs Google Tag Manager API access, planned for Analitik İşler Cloud). No call to Google |
| `start_tracking_audit` | write | P | demo: the simulated run (`status: "done"`); own data: `status: "handoff"` with the MCP steps, no network call |
| `get_audit` | read | P M | |
| `attach_audit_finding` | write | M | `{ audit_id, ok, title, evidence?, fix?, console?, steps? }` from the chat app after the AI Tag Debugger run; stores the result and, when not ok, a finding on the check |
| `get_chat_app_setup` | read | P | the real snippet: this Node, this repo's `src/cli.js`, this config file and data dir |
| `list_chat_app_calls` | read | P | the last 5 MCP calls (client name from the MCP handshake) |
| `get_settings` | read | P | `Settings`; keys only as `hint` ("…wxyz"), never the key |
| `test_bigquery` | read | P S | six steps; one real BigQuery round only when the person presses Test |
| `save_data_source`, `set_bytes_cap`, `rebuild_demo` | write | P S | write `ai-analyst.config.json`; reopen the warehouse |
| `test_model_key`, `save_model_key`, `remove_model_key`, `set_model_provider` | read (test), write | P S | one small real call only when the person presses Test or Save; keys to `secrets.json` (0600) |
| `set_preference` | write | P | `make_it_yours`, `not_now`, `exploratory` |
| `get_workspace` | read | A M | name, demo, data range, rows |
| `publish_answer` | write | A | `{ sentence: Text, title?: Text, query_id? , check_id?, explore_id?, kind?: "answer"\|"why", segment?: { dimension: "device"\|"channel", key }, lead?: "metric"\|"check", followups?: Text[] }`; the number-grounding validator checks both languages; refused twice, then published with `validation.ok = false`. `kind: "why"` needs a check that does not add up and fills `why`; `segment` makes a `check_split` with the segment's figures and `overall`; `lead: "metric"` (the default when the query has a comparison or is not one of the check's metrics) leads with the metric and keeps the check below. `explore_id` with `check_id` is refused: exploratory answers never carry a verdict |
| `propose_watch`, `propose_pin`, `propose_event`, `propose_metric` | write | A | a pending `Proposal` (or a proposed metric); nothing changes until a person approves |
| `run_sql` | read | A | exploratory only (a model is set and the switch is on); see "Exploratory SQL" |

Removed from 0.1, replaced by the prototype's actions: `pin_answer` (frozen answers) → tiles; `unpin` →
`remove_tile`; `create_alert`, `decide_alert`, `remove_alert` → watches and proposals.

## The agent (src/agent)

- Who answers (`AppState.agent`): the provider chosen in Settings (or `AI_ANALYST_PROVIDER`) when it has a key;
  without a saved choice, the first provider with a key in the environment; else the built-in planner.
- Anthropic goes through the SDK (`client.beta.messages.stream`, adaptive thinking, effort medium, server-side
  fallbacks `"default"`, eager input streaming on tools). OpenAI (`https://api.openai.com/v1`), Gemini (its
  OpenAI-compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai`) and OpenAI-compatible
  servers (a base URL: Ollama, OpenRouter) go through one fetch-based chat-completions adapter with tool calls.
- A turn keeps the model's own text (`text`, capped: 400 characters after a card, 1,500 without one) and, for model turns, `usage: { input, output, cache_read, cache_write, calls }` summed over its calls. A check side with no data (all NULL) is `insufficient_data` with `reason: Text`; ratio metrics over a NULL or zero denominator are `null` (no data).
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

Only with a model and `preferences.exploratory` not `"off"`. `run_sql { sql, measure, dims, from, to, unit,
label? }`. Three fences, each enough on its own to keep other tables out (security review H1, 24 Oct):

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
     `main.getenv`) and any quoted function name is `sql_forbidden_function`. This keeps out file, URL and system
     functions, AI and other billed calls, and identity functions in both dialects;
   - every table after `FROM`, `JOIN`, a comma in a `FROM` list, or the opening parenthesis of a `FROM` item or a
     parenthesised join, is the mart (as the warehouse writes it) or a CTE of the top-level `WITH`; a CTE defined
     inside a subquery does not count, a string used as a table, `LATERAL`, `UNNEST` and anything else is
     `sql_table_not_allowed`; a comma at the depth of a `WHERE`, `HAVING`, `QUALIFY` or `ON` condition is refused.
2. **The warehouse checks again.** BigQuery: the dry run is authoritative; the query is refused before it runs
   unless `statistics.query.referencedTables` is exactly the mart (and not empty) and `statementType` is
   `SELECT`, then it runs with `maximumBytesBilled` = the cap, `useLegacySql: false` and a job timeout (compiled
   metric queries get the same check whenever the dry run reports tables). DuckDB: the query runs in a separate
   database file, `<demo>.explore-mart.duckdb`, rebuilt from the mart whenever the demo file changes and holding
   nothing else, opened read-only with `enable_external_access=false` and the configuration locked, on its own
   connection with a 10 s timeout; another table cannot be named at all.
3. **The result:** the statement runs wrapped as `SELECT * FROM (<sql>) AS q LIMIT 1000`; the model sees at most
   200 aggregated rows; the answer is `kind: "explore"`, never a verdict or a definition. Warehouse errors reach
   the model and the UI without paths (DuckDB) or as a fixed sentence (BigQuery, whose message can name other
   projects; the detail goes to the server log).

`test/guard.test.js` holds the attack list: every query of the security review's scripts plus ours, each refused
by the guard and also run unguarded on the real DuckDB explore path against a demo file that holds a secret table,
which none of them can read; and the BigQuery referenced-tables check with stubbed dry runs.

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
| `AI_ANALYST_WAREHOUSE` | `duckdb` (the demo) or `bigquery` |
| `BIGQUERY_PROJECT`, `BIGQUERY_JOB_PROJECT`, `BIGQUERY_DATASET`, `BIGQUERY_LOCATION` (EU) | the mart and where jobs run |
| `BIGQUERY_MAX_BYTES` (2 GB) | the ceiling of the bytes cap; Settings can only lower the cap below it |
| `BIGQUERY_JOB_TIMEOUT_MS` (60000) | job timeout |
| `GOOGLE_APPLICATION_CREDENTIALS` | a key file path; otherwise gcloud application default credentials. Never stored |
| `AI_ANALYST_PROVIDER` | `planner`, `anthropic`, `openai`, `gemini`, `openai_compatible` |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `AI_ANALYST_OPENAI_COMPATIBLE_KEY` | model keys |
| `AI_ANALYST_OPENAI_COMPATIBLE_URL` | base URL of an OpenAI-compatible server |
| `AI_ANALYST_MODEL` | the active provider's model (defaults: claude-opus-5-5, gpt-5.5, gemini-pro-latest) |
| `AI_ANALYST_CLOUD_URL`, `AI_ANALYST_CLOUD_TOKEN` | Analitik İşler Cloud, an Anthropic-compatible endpoint |
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

- The Meta "why" sentence keeps the capital in "AI Tag Debugger found that Meta counts …" (the mock lower-cased
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
bug). On own data the GTM import is unavailable and the audit is a handoff to AI Tag Debugger in the chat app.

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
