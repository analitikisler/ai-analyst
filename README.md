# AI Analyst

Agent-native analytics by Analitik İşler. Ask a question in Turkish or English; the agent answers with a chart,
the SQL it ran, the versioned metric definition and a tally against the system that owns the number: back-office
orders against GA4 purchases, Meta and Google Ads conversions against orders. No number stands alone.

The person and the agent share one set of actions. A button and an agent tool call the same function, every
write lands in one activity log, and anything the agent wants to change on a schedule (an alert) waits for a
person to approve it.

## Run it

```bash
npm install
npm test
node src/cli.js serve --port 8788
```

Open http://localhost:8788. The first run builds the demo warehouse (Örnek Moda, an invented online fashion
shop: 90 days of generated data with one planted tracking bug) and seeds a workspace.

Without `ANTHROPIC_API_KEY` the built-in planner answers the common questions with the same tools and says so on
every answer. With a key, Claude (`claude-opus-5-5` by default, `AI_ANALYST_MODEL` to change) answers anything the
metric pack covers.

Other commands:

```bash
node src/cli.js ask "Do GA4 purchases match our orders in the last 14 days?"
node src/cli.js check            # runs every check; exits 1 when one does not add up
node src/cli.js mcp              # the read tools over MCP, for Claude Desktop, Cursor and other chat apps
node src/cli.js seed-demo        # rebuilds the demo and starts a fresh workspace
```

`AI_ANALYST_LANG=tr` seeds the workspace in Turkish.

## How an answer is checked

1. The agent can only query metrics from the pack in `metrics/`. SQL is compiled from the pack, never written
   by the model, and filter values are checked against known values.
2. When the metric has a check in `checks/`, the agent reconciles it for the same period: expected against
   measured, Δ, a verdict against the tolerance, a split by device, the date the gap started and any linked
   AI Tag Debugger finding.
3. `publish_answer` compares every number in the agent's sentence with the query and the check. A number it
   cannot find goes back to the model to fix; after two failed tries the answer is shown as "not checked".

## Real data

`docs/connecting-bigquery.md` covers connecting a client's GA4 export, Google Ads transfer, back-office orders
and ad costs in BigQuery, with the SQL in `models/` that builds the mart every metric reads. Set
`AI_ANALYST_WAREHOUSE=bigquery`, `BIGQUERY_PROJECT` and `BIGQUERY_DATASET`; credentials stay the client's own.
Every BigQuery job runs a dry run first and carries a bytes-billed cap (`BIGQUERY_MAX_BYTES`, 2 GB by default).

## Layout

| Path | What |
|---|---|
| `src/actions/` | the action registry: every UI action and agent tool |
| `src/metrics/` | metric pack loader and SQL compiler (DuckDB, BigQuery) |
| `src/checks/reconcile.js` | the tally |
| `src/agent/` | Claude tool loop, the no-model planner, number grounding |
| `src/warehouse/` | DuckDB for the demo, BigQuery for clients |
| `src/store/` | the app database (`node:sqlite`) |
| `src/server.js`, `src/mcp.js`, `src/cli.js` | HTTP API, MCP server, command line |
| `web/` | the app, on the Analitik İşler design system, no build step |
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
- The live model path is tested against a stubbed client; it has not run against the API yet.
- Not built yet: Meta, TikTok and Search Console connectors, scheduled alert delivery, multi-workspace hosting.
