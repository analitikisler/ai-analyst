# AI Analyst · build contract

AI Analyst is Analitik İşler's agent-native analytics tool. A person asks a question in Turkish or English; the
agent answers with a chart, the SQL it ran, the versioned metric definition and a tally against the system that
owns the number. Every UI action and every agent tool is the same action from one registry.

This file is the contract between the engineers. Change it only through the lead engineer.

## Conventions (match the sibling repo `~/Documents/Projects/ai-tag-debugger`)

- Node ≥ 22, plain ES modules (`"type": "module"`), no TypeScript build. JSDoc where types help.
- Tests: `node --test test/*.test.js`. No test framework.
- Dependencies, keep to these: `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `zod` (v4, use `z.toJSONSchema`),
  `yaml`, `@duckdb/node-api` (local demo warehouse), `@google-cloud/bigquery` (real warehouse). App database:
  built-in `node:sqlite`. HTTP: built-in `node:http`, no framework. Front end: static files, no build step.
- Comments explain why, briefly. Names say what things are. English (en-GB) in code and docs.
- Never call a real cloud account (gcloud, bq, BigQuery client, Google Ads, Meta) during development, not even a
  dry run, unless the owner asks for it. Test BigQuery code with stubbed clients and SQL assertions.

## Layout and owners

```
package.json                     back end   name @analitikisler/ai-analyst, bin ai-analyst -> src/cli.js
src/cli.js                       back end   serve [--port 8787] · seed-demo · mcp · ask "<question>" · check
src/config.js                    back end   env + ai-analyst.config.json
src/actions/registry.js          back end   defineAction, the registry, tool/JSON-schema export, callAction
src/actions/*.js                 back end   the actions below
src/metrics/load.js              back end   loads and validates metrics/*.yaml and checks/*.yaml
src/metrics/compile.js           back end   metric + query params -> SQL for a dialect (duckdb | bigquery)
src/warehouse/duckdb.js          back end   local demo warehouse at data/demo.duckdb
src/warehouse/bigquery.js        back end   real warehouse: dry run first, maximumBytesBilled cap
src/checks/reconcile.js          back end   the tally: expected vs measured, Δ, verdict, breakdown, since-date
src/agent/agent.js               back end   Claude tool loop over the registry, streams events
src/agent/planner.js             back end   no-model fallback: fixed plans for common questions, same tools
src/agent/validate.js            back end   number grounding for answers
src/store/store.js               back end   node:sqlite app database at data/app.db
src/demo/seed.js                 back end   generates the Örnek Moda demo mart into DuckDB, seeds findings
src/server.js                    back end   HTTP API + serves web/
src/mcp.js                       back end   stdio MCP server exposing the read actions
test/*.test.js                   back end
metrics/*.yaml, checks/*.yaml    data       the metric pack (lead wrote v1; data analyst reviews)
models/                          data       BigQuery SQL that builds the mart from GA4 export, back office, ads
docs/connecting-bigquery.md      data
web/                             front end  index.html, app.js, i18n.js, app.css, vendor/ (design system)
```

## The mart

Every metric reads one model, `daily_channel_device`, one row per date × channel × device:

| column | type | meaning |
|---|---|---|
| `date` | DATE | Europe/İstanbul calendar date |
| `channel` | STRING | `organic`, `direct`, `google_ads`, `meta_ads`, `tiktok_ads`, `email` |
| `device` | STRING | `mobile`, `desktop` |
| `sessions` | INT | GA4 sessions |
| `orders` | INT | back-office orders, test orders excluded, cancellations kept |
| `revenue` | NUMERIC | back-office order value in TRY incl. VAT, excl. shipping |
| `ga4_purchases` | INT | GA4 purchase events with a distinct transaction_id |
| `ga4_revenue` | NUMERIC | GA4 purchase revenue in TRY |
| `platform_conversions` | INT | conversions the ad platform itself reports (ad channels only, else 0) |
| `ad_spend` | NUMERIC | ad platform cost in TRY (ad channels only, else 0) |

In DuckDB the table is `daily_channel_device`; in BigQuery `` `{project}.{dataset}.daily_channel_device` ``.
The demo seed reproduces the prototype's generator exactly (seed 20261023, 25 Jul – 22 Oct 2026, planted bug:
mobile GA4 capture drops from 9 Oct 2026, release v4.12).

## Metric pack format

`metrics/<id>.yaml`:

```yaml
id: orders                      # [a-z0-9_]+, equals the file name
version: 3                      # bump on any definition change
label: { en: Orders, tr: Sipariş }
unit: count                     # count | try | pct | ratio
source: backoffice              # backoffice | ga4 | ads, joined with + when mixed
owner: Bahadır Ölez
description: { en: "...", tr: "..." }
model: daily_channel_device
sum: orders                     # either sum: <column>
# ratio: { numerator: revenue, denominator: ad_spend }   # or a ratio of two column sums
where: { channel: [google_ads, meta_ads, tiktok_ads] }   # optional fixed filter, column -> allowed values
dimensions: [day, week, month, channel, device]
check: ga4_vs_orders            # optional: the check that verifies this metric
```

`checks/<id>.yaml`:

```yaml
id: ga4_vs_orders
label: { en: GA4 purchases against back-office orders, tr: GA4 satın almaları ile arka ofis siparişleri }
expected: { metric: orders, label: { en: Back office orders, tr: Arka ofis siparişi } }
measured: { metric: ga4_purchases, label: { en: GA4 purchases, tr: GA4 satın alma } }
where: { channel: [meta_ads] }  # optional, applied to both sides
tolerance: 0.05                 # |delta_pct| <= tolerance -> adds_up
breakdown: device               # dimension for the per-segment split
```

No free-form SQL from the agent in this build: SQL is compiled only from the pack. Filter values are checked
against the dimension's known values; identifiers come only from the pack.

## Shapes

`QueryParams`: `{ metric, group_by: "none"|"day"|"week"|"month"|"channel"|"device", from, to, filters?: { channel?, device? } }`.
Dates `YYYY-MM-DD`, clamped to the data range; `from` defaults to 27 days before `to`; `to` defaults to the last
date with data. Weekly results keep complete Monday–Sunday weeks only (from/to are narrowed to match).

`QueryResult`: `{ id, metric, metric_version, group_by, from, to, filters, unit, rows: [{ key, value }], total, sql, dialect, ran_at }`.
`rows` for channel are sorted by value descending; for dates ascending. Ratios are computed from sums, never averaged.

`CheckResult`: `{ id, check, from, to, filters, expected: { metric, label, value }, measured: { metric, label, value },
delta, delta_pct, tolerance, verdict: "adds_up"|"does_not_add_up"|"insufficient_data", breakdown: [{ key, expected, measured, delta_pct, verdict }],
out_of_tolerance_since, findings: [{ id, source, text: { en, tr }, since }], sql: { expected, measured }, ran_at }`.
`out_of_tolerance_since` is the first date of the current unbroken run of days outside tolerance (null if the
last day is within). `insufficient_data` when expected is 0.

`Answer`: `{ id, turn_id, question, sentence, title, followups: [string], query: QueryResult, check: CheckResult|null,
metric: { id, label, version, description, source }, validation: { ok, unmatched: [string] }, created_by: "agent"|"planner", created_at }`.

`Pin`: `{ id, answer_id, title|null, created_by: "person"|"agent", created_at, answer }`.
`Alert`: `{ id, check|null, metric|null, title, rule, schedule, status: "active"|"pending", created_by, created_at }`.
`Activity`: `{ id, at, actor: "person"|"agent", action, detail, undo: { type, id }|null, undone }`.

## Actions

Each action: `defineAction({ name, description, input: zodSchema, kind: "read"|"write", agent: true|false, person: true|false, run(ctx, input) })`.
`ctx = { actor: "person"|"agent", lang: "en"|"tr", store, warehouse, pack, turn }`. Writes log to activity.

| name | kind | who | notes |
|---|---|---|---|
| `list_metrics` | read | both | ids, labels, units, descriptions, checks |
| `explain_metric` | read | both | full definition + compiled SQL example |
| `list_checks` | read | both | |
| `run_query` | read | both | QueryParams → QueryResult; stored |
| `reconcile` | read | both | `{ check, from?, to?, filters? }` → CheckResult; stored |
| `run_all_checks` | write | both | `{ days = 14 }`; stores a check run; logs activity |
| `list_sources` | read | both | connected sources, row counts, last sync |
| `get_workspace` | read | both | name, data range, counts |
| `publish_answer` | write | agent only | `{ sentence, query_id, check_id?, title?, followups? }`; runs the validator; throws with the unmatched numbers so the model can fix them (after 2 failed tries it publishes with `validation.ok = false`) |
| `pin_answer` | write | both | `{ answer_id, title? }`; undoable |
| `unpin` | write | person | `{ pin_id }` |
| `create_alert` | write | both | person → `active`; agent → `pending`, needs a person's approval |
| `decide_alert` | write | person only | `{ alert_id, approve }` |
| `remove_alert` | write | person | |
| `undo` | write | person | `{ activity_id }`: pins and alerts |

The agent sees only `agent: true` actions as tools. MCP exposes the read actions plus `run_all_checks`.

## Number grounding (validate.js)

Extract every number in `sentence` (EN `1,240` `4.2%` `−10.1%`, TR `1.240` `%4,2` `−%10,1`, `2.66×`, `22.07M TL`,
`22,07 mn TL`; ignore dates, years 2000–2100 and ordinals of days next to month names). Each must match, after
rounding to the precision written, a value in the referenced query (total, row values) or check (expected, measured,
delta, delta_pct, breakdown values). Percentages compare against ratios × 100.

## HTTP API (src/server.js)

- `GET /` and static files from `web/`.
- `GET /api/state` → `{ workspace: { name, demo, data_from, data_to, refreshed_at }, agent: { mode: "model"|"planner", model },
  pins, alerts, activity (latest 100), checks: [CheckResult] (latest run), conversations: [{ id, turns: [Turn] }] (latest 1) }`.
  `Turn = { id, question, steps: [{ tool, summary, ok }], answers: [Answer], approvals: [Alert], text, error, created_by }`.
- `POST /api/actions/:name` JSON input → `{ ok: true, result }` or `{ ok: false, error: { code, message } }` (actor = person).
- `POST /api/ask` `{ question, lang, conversation_id?, context?: { view, answer_id? } }` → `text/event-stream`:
  `turn {turn_id, conversation_id}` · `step {tool, summary, ok}` · `answer {answer}` · `approval {alert}` ·
  `text {text}` · `error {code, message}` · `done {}`. The agent also receives `context` (what the person is looking at).
- `POST /api/turns/:id/stop`.
- Mode: with `ANTHROPIC_API_KEY` the model answers (`AI_ANALYST_MODEL`, default `claude-opus-5-5`); without it the
  planner answers with the same tools and every answer says `created_by: "planner"`.

## Config

Env first, then `ai-analyst.config.json`: `PORT` (8787), `AI_ANALYST_WAREHOUSE` (`duckdb` | `bigquery`),
`AI_ANALYST_DATA_DIR` (`./data`), `BIGQUERY_PROJECT`, `BIGQUERY_DATASET`, `BIGQUERY_LOCATION` (`EU`),
`BIGQUERY_MAX_BYTES` (2 GB), `ANTHROPIC_API_KEY`, `AI_ANALYST_MODEL`, `AI_ANALYST_WORKSPACE` ("Örnek Moda").
Credentials are the person's own (`GOOGLE_APPLICATION_CREDENTIALS`); the tool never stores them.

## Settled during the build (23 Oct 2026)

- CheckResult also carries `label`, `unit`, `breakdown_by` and `dialect`; state carries `check_run`; a Turn also
  carries `lang`, `context` and `status`. Tool results the model sees add `*_formatted` strings.
- `/api/ask` without `conversation_id` continues the latest conversation; `"new"` starts one.
- A `text` event carries the turn's full latest text: replace, do not append.
- Turn `approvals` are alert ids; a declined alert is deleted.
- `list_sources` returns `{ sources }`; actions take the language from `Accept-Language`.
- `AI_ANALYST_LANG` (`en` | `tr`) is the workspace language; the demo seed uses it.
- Dependencies are pinned to exact versions at least two weeks old.

## Brand

The UI follows the Analitik İşler design system exactly (dark navy ground, one data blue, one orange answer
mark per section, red only for gaps with a glyph and a word, Google Sans family, sharp corners, the tally).
Copy: en-GB, short sentences, no superlatives, no exclamation marks, no em dashes, no emoji, nothing uppercase;
Turkish native and impersonal. The product name is "AI Analyst"; its lockup is lowercase "ai analyst",
"by Analitik İşler".
