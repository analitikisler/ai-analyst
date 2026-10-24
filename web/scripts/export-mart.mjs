#!/usr/bin/env node
// Exports the demo mart (daily_channel_device) from the DuckDB file the capture server built, so the fixture API
// can answer any period and comparison with the demo's real rows, using the server's own rules (sum of columns,
// ratios of sums, complete weeks, the tally). Read-only on the DuckDB file; uses ai-analyst's installed driver.
//   node scripts/export-mart.mjs [path/to/demo.duckdb]   (default: web/.capture/data/demo.duckdb)
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(process.argv[2] ?? path.join(here, "..", ".capture", "data", "demo.duckdb"));
// The repo root installs the DuckDB driver; web/ does not depend on it.
const { DuckDBInstance } = await import(path.join(here, "..", "..", "node_modules", "@duckdb", "node-api", "lib", "index.js"));
const db = await DuckDBInstance.create(file, { access_mode: "READ_ONLY" });
const con = await db.connect();
const reader = await con.runAndReadAll(
  "SELECT strftime(date, '%Y-%m-%d') AS date, channel, device, sessions, orders, CAST(revenue AS DOUBLE) AS revenue, ga4_purchases, CAST(ga4_revenue AS DOUBLE) AS ga4_revenue, platform_conversions, CAST(ad_spend AS DOUBLE) AS ad_spend FROM daily_channel_device ORDER BY date, channel, device",
);
const rows = reader.getRowObjectsJson();
const columns = ["date", "channel", "device", "sessions", "orders", "revenue", "ga4_purchases", "ga4_revenue", "platform_conversions", "ad_spend"];
const out = { source: "ai-analyst demo seed 20261023 (DuckDB daily_channel_device)", columns, rows: rows.map((r) => columns.map((c) => (typeof r[c] === "string" && c !== "date" && c !== "channel" && c !== "device" ? Number(r[c]) : r[c]))) };
await writeFile(path.join(here, "..", "src", "api", "fixtures", "mart.json"), JSON.stringify(out) + "\n");
console.log(`wrote mart.json: ${rows.length} rows`);
