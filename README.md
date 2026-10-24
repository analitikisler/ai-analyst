# AI Analyst

Agent-native analytics by Analitik İşler. Ask a question in Turkish or English; the agent answers with a chart,
the SQL it ran, the versioned metric definition and a tracking check against the system that owns the number:
back-office orders against GA4 purchases, Meta and Google Ads conversions against orders. No number stands alone.

The person and the agent share one set of actions. A button and an agent tool call the same function, every
write lands in one activity log with undo, and anything the agent wants to change (a tile, a watch, an event, a
new metric) waits as a proposal for a person to approve.

## Run it

```bash
bun install
bun install --cwd web
bun run build
bun run test
bun run serve -- --port 8788
```

Open http://localhost:8788. The first run builds the demo warehouse (Örnek Moda, an invented online fashion
shop: 90 days of generated data with one planted tracking bug) and seeds a workspace. Node 22.13 or later works
too: `npm install`, `npm test`, `node src/cli.js serve`.

`bun run dev` starts the server on 8788 and the web app on 5190 with hot reload. `bun run build:demo` builds the
web app on its own, on recorded demo data, with no server.

Other commands:

```bash
node src/cli.js ask "Do GA4 purchases match our orders in the last 14 days?"
node src/cli.js check            # runs every tracking check; exits 1 when one does not add up
node src/cli.js mcp              # the tools over MCP, for Claude Desktop, Claude Code, Cursor and Codex
node src/cli.js seed-demo        # rebuilds the demo and starts a fresh workspace
```

`--data-dir` (or `AI_ANALYST_DATA_DIR`) keeps the app database, settings and keys in another folder.

## What is in the app

- **Ask**: a chat. Answers carry their chart, SQL, definition and tracking check; agent steps fold above each
  reply; follow-ups never repeat a question already asked.
- **Dashboards**: tiles pinned from answers, with chart type, size, period and comparison. Each dashboard opens
  with a Tracking health strip; a row opens the check with its tally, split by device and history.
- **Metrics**: the data dictionary. Every metric's definition, compiled SQL, last 90 days, tracking checks, where
  it is used and its version history. Exploratory answers can be proposed as new metrics.
- **Events**: releases, campaigns, tag changes and price changes, shown as markers on every time chart and used
  by the agent to explain gaps and spikes.
- **Tracking audit**: a failing GA4 check offers "Test the purchase journey", which hands the journey, device and
  site to AI Tag Debugger and links its finding back to the check.
- **Settings**: data source, model, chat apps, events, language and theme, help, activity.

## Models

Without a model, the built-in planner answers the common questions with the same tools and says so. Add a model
in Settings or by environment variable:

| Provider | Variable |
|---|---|
| Anthropic (Claude, `claude-opus-5-5` by default) | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` |
| OpenAI-compatible (Ollama, OpenRouter and others) | `AI_ANALYST_OPENAI_COMPATIBLE_URL`, `AI_ANALYST_OPENAI_COMPATIBLE_KEY` |

`AI_ANALYST_PROVIDER` picks one when several are set and `AI_ANALYST_MODEL` changes the model. Keys saved in
Settings are kept in `secrets.json` in the data folder, readable by your user only, and are never sent back to
the browser.

To use the plan you already pay for, connect a chat app over MCP instead (Settings › Chat apps shows the config
for each). The chat app's model does the thinking; AI Analyst supplies the metrics and the checks.

## Exploratory answers

With a model, questions the metric pack does not cover get an exploratory answer: the model writes one read-only
query against the mart. These answers are labelled "Exploratory · not checked", show the SQL the model wrote and
never carry a verdict. The limits are enforced in code: one `SELECT` against the mart table only, an allowlist of
functions, a BigQuery dry run that must reference only the mart and stay under the bytes cap, a separate
read-only DuckDB file holding only the mart, at most 1,000 rows, and at most 200 aggregated rows passed to the
model. Settings › Model turns it off.

## Hosted version

AI Analyst is free and open source under the MIT licence. **Analitik İşler Cloud** runs it for teams that would
rather not run it themselves, and adds what is hard to do alone:

- managed connectors for Google Ads, Meta, TikTok, ikas and Ticimax, and Google Tag Manager event import
- curated metric packs per store platform, with each client's expected gap learned from its own history
- scheduled tracking checks with alert emails
- team workspaces with roles and an audit log
- a model with EU inference that needs no key of your own

Analitik İşler Cloud is in early access: email hello@analitikisler.com with the subject "Analitik İşler Cloud".
When a check does not add up, the app offers an email to Analitik İşler with the tally filled in, so the cause
can be found. `AI_ANALYST_HELP_EMAIL` sends it to your own team instead; `AI_ANALYST_HELP=off` removes it.

With early-access credentials, set `AI_ANALYST_CLOUD_URL` and `AI_ANALYST_CLOUD_TOKEN` to answer through Analitik
İşler Cloud. A model key of your own always takes precedence.

## Privacy

A self-hosted copy sends no usage data, telemetry or update checks to anyone. The only outbound calls are to the
warehouse you configure and the model provider you choose (Anthropic, OpenAI, Google, or the base URL you set;
`ANTHROPIC_BASE_URL` is honoured), and to Analitik İşler Cloud only if you set its credentials. Links the person
clicks, such as the help email or "request this metric" on GitHub, open in their own mail app or browser with the
question filled in. Fonts are served by the app itself.

The model sees aggregated figures from the mart, metric definitions and the conversation, never order-level or
personal data. The mart has no order-level rows.

`AI_ANALYST_NO_CLOUD=1` (or `serve --no-cloud`) blocks every outbound call; tests and `bun run dev` set it by
default.

## Security

The server listens on 127.0.0.1 only. Another address needs `AI_ANALYST_TOKEN` (24 characters or more) and is
meant for a trusted network; behind a reverse proxy, settings cannot be changed. Requests from other websites are
refused (Host, Origin and Sec-Fetch-Site checks, no CORS), and settings can be changed only from the machine
running the app. Details in `docs/CONTRACT.md`. To report a security problem, email hello@analitikisler.com.

## How an answer is checked

1. For metric questions the agent queries metrics from the pack in `metrics/`. That SQL is compiled from the
   pack, never written by the model, and filter values are checked against known values.
2. When the metric has a tracking check in `checks/`, the agent reconciles it for the same period: expected
   against measured, Δ, a verdict against the tolerance, a split by device, the date the gap started and any
   linked AI Tag Debugger finding.
3. `publish_answer` compares every number in the agent's sentence with the query and the check. A number it
   cannot find goes back to the model to fix; after two failed tries the answer is shown as "not checked".

## Real data

`docs/connecting-bigquery.md` covers connecting a client's GA4 export, Google Ads transfer, back-office orders
and ad costs in BigQuery, with the SQL in `models/` that builds the mart every metric reads. Connect it in
Settings › Data source, or set `AI_ANALYST_WAREHOUSE=bigquery`, `BIGQUERY_PROJECT`, `BIGQUERY_DATASET` and, for
jobs billed to another project, `BIGQUERY_JOB_PROJECT`. A service account scoped to the mart's dataset is the
safest credential. Every BigQuery job runs a dry run first and carries a bytes-billed cap (`BIGQUERY_MAX_BYTES`,
2 GB by default).

## Layout

| Path | What |
|---|---|
| `src/actions/` | the action registry: every UI action and agent tool |
| `src/metrics/` | metric pack loader and SQL compiler (DuckDB, BigQuery) |
| `src/checks/reconcile.js` | the tally |
| `src/agent/` | model tool loop (Anthropic, OpenAI-compatible), the no-model planner, number grounding |
| `src/explore/` | the exploratory SQL guard and runner |
| `src/warehouse/` | DuckDB for the demo, BigQuery for clients |
| `src/store/` | the app database (`node:sqlite`) |
| `src/server.js`, `src/mcp.js`, `src/cli.js` | HTTP API, MCP server, command line |
| `web/` | the app (React, shadcn components on the Analitik İşler design system); see `web/README.md` |
| `metrics/`, `checks/` | the metric pack |
| `models/` | BigQuery SQL for the mart and order-level checks |
| `docs/CONTRACT.md` | the spec the code follows |

## Known limits

- Platform conversions use each platform's own attribution and click date, so the fixed 10% and 20% tolerances
  on the Google Ads and Meta checks will often fail on real data. Next: learn each client's expected band from its
  own last 90 days.
- An `fbclid` alone is counted as Meta Ads, though organic Meta clicks carry one too.
- ROAS by last non-direct click needs the store to keep UTMs on each order.
- The GA4 revenue check closes only if GA4 `value` includes VAT and excludes shipping.
- The model providers and the BigQuery connection test are tested against stubbed clients; they have not run
  against the real services yet.
- On demo data the GTM import and the tracking audit are simulated. On own data the audit is handed to AI Tag
  Debugger through a chat app, and GTM import is not available yet.
- Not built yet: Meta, TikTok and Search Console connectors, scheduled alert delivery, multi-workspace hosting.
