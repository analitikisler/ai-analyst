# AI Analyst

> **Alpha.** AI Analyst is an early version, not a finished product. Expect rough edges and breaking changes;
> the model providers and the BigQuery connection have not yet run against the real services.

Analytics you can ask, with every number checked. By Analitik İşler.

Ask a question in Turkish or English; the agent answers with a chart, the SQL it ran, the versioned metric
definition and a tracking check against the system that owns the number: back-office orders against GA4
purchases, Meta and Google Ads conversions against orders. No number stands alone.

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
- **Sources**: connect GA4, an orders file (CSV or Excel), or Shopify or WooCommerce, and the app builds its
  data from them on this machine. BigQuery and the demo stay available. Other connectors are on the Analitik
  İşler Cloud waitlist.
- **Settings**: sources, model, chat apps, events, language and theme, help, activity.

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
query against the tables it may read. By default that is the mart alone. In Settings › Sources › "Tables the
agent may read" you can add datasets (every table in them, also ones added later) or single tables, in the mart's
location; `AI_ANALYST_EXPLORE_ALLOW` sets the list on the server and locks it. On the demo, one click adds the demo
shop's own tables (orders, order lines, products, returns), generated from the same seed as the mart so their
totals agree with it.

These answers are labelled "Exploratory · not checked", show the SQL the model wrote, name the tables it read and
never carry a verdict. The limits are enforced in code, at three layers, each enough on its own: a SQL guard (one
`SELECT`, an allowlist of functions, every table written in full and on the list, no `INFORMATION_SCHEMA`, no
wildcard or meta-tables); on BigQuery a dry run whose referenced tables and views must all be on the list, as a
`SELECT`, under the bytes cap; on the demo a separate read-only DuckDB file holding only the allowed tables. A
query returns at most 1,000 rows and the model sees at most 200. The agent reads the structure of the allowed
tables (`describe_tables`) from the warehouse catalogue on the server, cached for 10 minutes, with a one-line
description per table that you can write. All queries for one question share a bytes cap (5 GB by default).
Settings › Model turns exploratory answers off.

## Hosted version

AI Analyst is free and open source under the MIT licence. **Analitik İşler Cloud** runs it for teams that would
rather not run it themselves, and adds what is hard to do alone:

- managed connectors, on the waitlist: Meta Ads, Google Ads, TikTok Ads, ikas, Ticimax, Search Console and
  Google Tag Manager (Settings › Sources has a "Join the waitlist" button for each)
- curated metric packs per store platform, with each client's expected gap learned from its own history, and
  curated table descriptions for exploratory answers on ikas, Ticimax and Shopify data
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
warehouse or the sources you connect (BigQuery, the GA4 Data API, your Shopify or WooCommerce shop), the model
provider you choose (Anthropic, OpenAI, Google, or the base URL you set;
`ANTHROPIC_BASE_URL` is honoured), and to Analitik İşler Cloud only if you set its credentials. Links the person
clicks, such as the help email or "request this metric" on GitHub, open in their own mail app or browser with the
question filled in. Fonts are served by the app itself.

The model sees query results from the tables you allowed, minus the protected columns, along with metric
definitions, the structure of the allowed tables and the conversation. With only the mart allowed (the default)
that means aggregated figures by day, channel and device, never order-level or personal data. Once you allow
order or customer tables, the model can see rows from them (at most 200 per query); prefer aggregates, and keep
contact data in protected columns.

Protected column values never leave the warehouse. A query may use a protected column in two places only: as a join
key compared with a column of an allowed table (`a.email = b.email`, both qualified, or `USING (email)`), also
inside a parenthesised join, or alone inside `COUNT(DISTINCT …)`. Anywhere else it is refused before the query
runs: selected, read through `*`, an alias, a CTE or a subquery, grouped or ordered by, used in `WHERE`, `HAVING`,
`QUALIFY` or a join condition against a value, inside `CASE`, `LIKE`, `IN`, `COUNTIF` or any function. So what can
leave about a protected column is the number of its distinct values in a group. A self-join, or a join to any
column of an allowed table, is allowed; it tells whether values are equal, never what they are. A query that uses a
protected column cannot contain a CTE or a subquery. When you add a table, the server proposes protected columns by
name, compound names included (`customer_email`, `contact_phone`, `client_ip`, Turkish `eposta`, `telefon`, `ad`,
`soyad`, `adres`, `dogum_tarihi`): email, phone, names, addresses, postcodes, IP addresses, birth dates, national
ids, IBAN and card numbers, and precise location. You confirm the list in Settings › Sources. Protection is by
column name, so a column with an unusual name, or a view that renames one, is not protected until you add it; a
view is readable only when you add it by name. There is no masking yet.

By default customer and user ids, city, age and gender stay readable. Per-customer rows without contact data (such
as an order history by customer id) can therefore reach the model provider, at most 200 rows per query, and are
stored on this machine, at most 1,000 rows per query. A query's result is deleted after 30 days (checked at start
and once a day), but an answer published from it keeps its rows in the app database (`app.db` in the data folder)
until that file is deleted. Protect those columns in Settings › Sources if they should not leave. Column
descriptions in the warehouse reach the model as data; whoever can edit them can write text the model reads.

Connected sources store daily totals only: orders, revenue, sessions, GA4 purchases and GA4 revenue by day, channel
and device. No order rows, names, emails, addresses or phone numbers are stored. An uploaded orders file is deleted
once its totals are written; WooCommerce sends each order's custom fields, which the app drops on arrival. For a
shop with very few orders, one day's total for a channel and device can be a single order.

`AI_ANALYST_NO_CLOUD=1` (or `serve --no-cloud`) blocks every outbound call; tests and `bun run dev` set it by
default.

## Security

The server listens on 127.0.0.1 only. Another address needs `AI_ANALYST_TOKEN` (24 characters or more) and is
meant for a trusted network; behind a reverse proxy, settings cannot be changed. Requests from other websites are
refused (Host, Origin and Sec-Fetch-Site checks, no CORS), and settings can be changed only from the machine
running the app. Changing the tables the agent may read, their protected columns or descriptions is a settings
change too, and each change is written to Activity. With a personal Google sign-in the allowlist is the only
boundary between the model's SQL and everything that sign-in can read; a service account with read access to the
allowed datasets only is safer, and the BigQuery connection test warns when the credential can see more datasets
than the list. Details in `docs/CONTRACT.md`. To report a security problem, see `SECURITY.md`.

## How an answer is checked

1. For metric questions the agent queries metrics from the pack in `metrics/`. That SQL is compiled from the
   pack, never written by the model, and filter values are checked against known values.
2. When the metric has a tracking check in `checks/`, the agent reconciles it for the same period: expected
   against measured, Δ, a verdict against the tolerance, a split by device, the date the gap started and any
   linked AI Tag Debugger finding.
3. `publish_answer` compares every number in the agent's sentence with the query and the check. A number it
   cannot find goes back to the model to fix; after two failed tries the answer is shown as "not checked".

## Real data

**Your shop, without a warehouse.** `docs/connecting-your-shop.md` covers giving the app read access to GA4,
exporting orders from ikas, Ticimax, Shopify or WooCommerce, and creating a read-only Shopify token or WooCommerce
key. Connect them in Settings › Sources. With GA4 and orders connected, the GA4 tracking check runs on your own
data; ROAS and the ad-platform checks need ad data, which comes with BigQuery or the Cloud connectors.

**BigQuery.** `docs/connecting-bigquery.md` covers connecting a client's GA4 export, Google Ads transfer,
back-office orders and ad costs in BigQuery, with the SQL in `models/` that builds the mart every metric reads.
Connect it in Settings › Sources, or set `AI_ANALYST_WAREHOUSE=bigquery`, `BIGQUERY_PROJECT`, `BIGQUERY_DATASET`
and, for jobs billed to another project, `BIGQUERY_JOB_PROJECT`. A service account scoped to the mart's dataset
(and any dataset you allow for exploratory answers) is the safest credential. Every BigQuery job runs a dry run
first and carries a bytes-billed cap (`BIGQUERY_MAX_BYTES`, 2 GB by default).

Money is written in Turkish lira (TL) by default. For data in another currency, pick it in Settings › Sources ›
Currency (TRY, USD, EUR, GBP or any ISO 4217 code) or set `AI_ANALYST_CURRENCY=USD`, which locks it. Answers,
cards, charts and the model's prompt all follow it.

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
- The GA4, Shopify and WooCommerce connectors, the OpenAI, Gemini and OpenAI-compatible models and the BigQuery
  connection test are tested against stubbed services only; they have not run against the real ones yet. The
  ikas, Ticimax and WooCommerce export steps in the guide are marked where they are unverified.
- The orders file and the shop connectors give no ad spend, so ROAS, CPA and the ad-platform checks say no data
  on a shop connected that way.
- On demo data the tracking audit is simulated. On own data it is handed to AI Tag Debugger through a chat app.
- Not built in the open-source app: Meta, Google Ads, TikTok, ikas, Ticimax, Search Console and Google Tag
  Manager connectors (on the Cloud waitlist), scheduled alert delivery, multi-workspace hosting.

## Licence and trademarks

The code is under the MIT licence (`LICENSE`). The Analitik İşler name and logo, and the AI Analyst and AI Tag
Debugger names, are trademarks of Analitik İşler and are not covered by the MIT licence: forks and redistributions
must not use them in a way that suggests they come from or are endorsed by Analitik İşler. The fonts are under the
SIL Open Font License 1.1 (`web/public/fonts/OFL-*.txt`). Security reports: see `SECURITY.md`.
