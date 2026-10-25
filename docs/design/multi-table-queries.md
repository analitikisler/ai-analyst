# Design: exploratory queries across several tables

Status: approved and built, 25 Oct 2026, with the proposed answers to the three open questions (the mart alone by default with one-click "add this dataset"; protected columns refused, no masking; Cloud packs out of scope for the code). The real BigQuery test with theLook has not been run. See docs/CONTRACT.md, Exploratory SQL.

## Problem

Exploratory answers today may read one table, the mart `daily_channel_device`. That keeps answers safe, but it rules
out the questions people ask first about their own shop: which products are returned most often, which categories
sell on mobile, how first orders differ from repeat orders. Those need order lines, products, customers or the GA4
export, and joins between them.

The limit was a quick fix for a real risk. The model writes exploratory SQL, the query runs with the person's own
BigQuery credentials, and those usually reach far more than analytics: HR, finance, other clients. A prompt injection
could make the model read such a table and send rows of it to the model provider.

## Goal

The agent can answer with one read-only query that joins any tables the person has allowed, and nothing else.

Non-goals for this version:
- writing, creating or changing tables;
- tracking checks or metric definitions on the new tables (the mart stays the checked layer);
- other warehouses than BigQuery and the DuckDB demo.

## How it works

### 1. An allowlist chosen by the person

Settings › Data source gets a new section, "Tables the agent may read":

- The person adds datasets (every table in it, including ones added later) or single tables. The mart is always on
  the list.
- Each entry shows the table count, size, last modified date and location.
- Only datasets in the mart's location can be added, because a BigQuery query runs in one location.
- Stored in `ai-analyst.config.json` as `explore.allow: [{ project, dataset, table | null }]`. An env var,
  `AI_ANALYST_EXPLORE_ALLOW`, sets it on the server and locks it, as other settings do.
- Changing the list is a settings change: loopback only, written to the activity log.
- Empty list (the default) means today's behaviour: the mart only.

### 2. The agent can see the structure

A new agent tool, `describe_tables`, returns the allowed tables with their columns, types, descriptions, row counts
and partitioning, read from `INFORMATION_SCHEMA` (no table data). Results are cached for 10 minutes.

- The prompt tells the agent to call it before writing SQL across tables, and to filter partitioned tables by date.
- The person can add a one-line description per table in Settings, for example "order lines from the back office,
  one row per item"; the agent sees it.
- `INFORMATION_SCHEMA` is read by the server for this tool only. The model may still not query it.

### 3. Enforcement stays in code, at three layers

The same structure that held in the real BigQuery test, with a wider list:

| Layer | Today | With the allowlist |
|---|---|---|
| SQL guard (parser) | one statement, SELECT or WITH, mart only | same, but every table name must be on the allowlist, fully qualified |
| BigQuery dry run | `referencedTables` must be exactly the mart | every referenced table must be on the allowlist; views must resolve to allowed tables; `statementType` SELECT |
| Credentials | person's own login, or a dataset-scoped service account | a service account with read access to the allowed datasets only, recommended and checked in the connection test |

Other limits stay as they are: the bytes cap and dry run first, the function allowlist, no `INFORMATION_SCHEMA`, no
external or wildcard tables, a job timeout, at most 1,000 rows returned and 200 rows shown to the model.

New: a query over the bytes cap gets a hint to filter by date on a partitioned table, and the per-question cap can be
lower than the per-query cap (`explore.max_bytes_per_question`, default 5 GB) so retries can't add up.

The DuckDB demo gets the same model: a separate read-only file holding only the allowed demo tables.

### 4. Personal data

Order lines and customers hold personal data. Three rules:

- **Columns that never leave the warehouse.** Settings lists protected columns, for example `email`, `phone`,
  `first_name`, `last_name`, `street_address`, `ip_address`. The server proposes a list by column name (compound
  and Turkish forms included) when a table is added; the person confirms it. A protected column may appear only as
  a join key compared with another column (`a.col = b.col`, `USING (col)`) or alone inside `COUNT(DISTINCT col)`;
  anywhere else (selected, `*`, grouped, ordered, filtered, compared with a value, `CASE`, `LIKE`, `IN`, `COUNTIF`,
  any function) the query is refused before it runs (security review 2, H2). Customer and user ids, city, age and
  gender stay readable by default (the owner's decision); `protection.yaml` in the pack is the one list that turns
  them on.
- **Small groups.** A result row describing fewer than 5 customers or orders is not shown to the model when the
  query groups by a customer-level column. (Simple version first: refuse a GROUP BY on a protected column.)
- **Rows stay aggregated where possible.** The prompt prefers aggregate queries; a row-level result is cut to 200
  rows for the model and labelled as such.

The README's privacy section changes from "the model never sees order-level data" to what is true: the model sees
query results from the tables the person allowed, minus the protected columns.

### 5. Answers stay honest

- Answers from these tables are "Exploratory · not checked", show the SQL, and name the tables they read.
- No verdict. If a figure overlaps a checked metric (revenue, orders), the agent may run the checked metric for the
  same period and say whether the two agree, as a sentence, not a verdict.
- "Turn this into a metric" works as now; a metric on a new table needs a tracking check before it counts as
  checked.

## Demo data

The demo gets the tables that make the feature worth trying, generated with the same seed as the mart so totals
agree: `orders` (one row per order), `order_items`, `products` (about 120 items, categories, prices) and `returns`.
Customers are invented ids only, with no names or contact details. A suggestion chip shows one cross-table question
on the demo, such as "Which product categories are returned most often?".

## Settings and screens

- Data source: the new "Tables the agent may read" list with Add dataset, Add table and Remove; protected columns
  per table; the connection test gains a step, "can read the allowed tables", and a warning when the credential can
  read more than the list (detected from `INFORMATION_SCHEMA.SCHEMATA` in the job project).
- Answer card: the tables read, listed under the SQL.
- Activity: list changes and protected-column changes.

## Contract changes

- Settings: `data_source.explore = { allow: AllowEntry[], protected_columns: Record<table, string[]>,
  max_bytes_per_question: number }`.
- Actions: `list_tables` (what the credential can see, for the picker), `set_explore_tables`,
  `set_protected_columns`; agent tool `describe_tables`.
- Errors: `sql_table_not_allowed` keeps its code and gains `params.table`; new `sql_protected_column`,
  `sql_location_mismatch`.
- `ExploreResult` gains `tables: string[]`.

## Tests

- Guard and dry-run: the attack list from the security review, now run with two allowed tables and one decoy in the
  same dataset; views over a disallowed table; wildcard tables; a protected column through `*`, an alias, a CTE and
  a subquery.
- Real BigQuery test: theLook in a test dataset in Frankfurt (orders, order_items, products, users, events), a decoy
  table in the same dataset, a dataset-scoped service account, and 10 cross-table questions, including "which
  products are returned most often".
- Demo: the same questions on DuckDB, with figures that match the mart where they overlap.

## Risks

- **Credential breadth.** With a personal login, the allowlist is the only boundary. The connection test warns, and
  the docs lead with the service account.
- **Cost.** Joins on large tables (the GA4 export) can scan a lot. The per-query and per-question caps and the
  date-filter hint keep it bounded; the cap error says how much a query would read.
- **Wrong answers from joins.** Fan-out (joining orders to items and summing order revenue) inflates figures. The
  prompt warns about it, `describe_tables` shows grain, and answers stay "not checked".
- **Protected-column detection by name** misses oddly named columns. The person confirms the list; the default is
  to protect anything that looks like contact data.

## Open questions

1. Should the allowlist default to the mart's dataset (convenient) or the mart alone (safest)? Proposed: mart alone,
   with a one-click "add this dataset".
2. Is masking (hashing) protected columns worth adding, so they can still be grouped on, or is refusing enough for
   now? Proposed: refuse now, masking later.
3. Should ai cloud offer this with managed connectors and curated table descriptions per store platform
   (ikas, Ticimax, Shopify)? Proposed: yes, as part of the curated packs.

## Estimate

About two working sessions: back end and guard (1), settings screen, demo tables and the real BigQuery test (1).
