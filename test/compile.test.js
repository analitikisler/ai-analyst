// The pack loader and the SQL compiler: identifiers only from the pack, values only from the mart.
import "./setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../src/config.js";
import { compileAggregate, compileQuery, mergeWhere, normalizeFilters, resolveQuery } from "../src/metrics/compile.js";
import { loadPack } from "../src/metrics/load.js";
import { tempDir } from "./helpers.js";

const pack = loadPack(ROOT);
const range = { from: "2026-07-25", to: "2026-10-22" };

test("the pack in the repo loads: 11 metrics, 4 checks", () => {
  assert.equal(Object.keys(pack.metrics).length, 11);
  assert.deepEqual(Object.keys(pack.checks).sort(), ["ga4_rev_vs_revenue", "ga4_vs_orders", "gads_vs_orders", "meta_vs_orders"]);
  assert.equal(pack.metrics.orders.version, 3);
  assert.deepEqual(pack.metrics.roas.ratio, { numerator: "revenue", denominator: "ad_spend" });
});

async function packWith(file, text) {
  const dir = tempDir("pack-");
  await cp(path.join(ROOT, "metrics"), path.join(dir, "metrics"), { recursive: true });
  await cp(path.join(ROOT, "checks"), path.join(dir, "checks"), { recursive: true });
  await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
  await writeFile(path.join(dir, file), text);
  return dir;
}

test("a pack that names an unknown column, a bad id or a bad filter value is refused", async () => {
  const base = "version: 1\nlabel: { en: X, tr: X }\nunit: count\nsource: ga4\nowner: A\ndescription: { en: x, tr: x }\nmodel: daily_channel_device\ndimensions: [day]\n";
  await assert.rejects(async () => loadPack(await packWith("metrics/bad.yaml", `id: bad\n${base}sum: "orders; DROP TABLE x"\n`)), /not a valid metric/);
  await assert.rejects(async () => loadPack(await packWith("metrics/bad.yaml", `id: other\n${base}sum: orders\n`)), /must equal the file name/);
  await assert.rejects(async () => loadPack(await packWith("metrics/bad.yaml", `id: bad\n${base}sum: orders\nwhere: { channel: [instagram] }\n`)), /not a valid metric/);
  await assert.rejects(async () => loadPack(await packWith("metrics/bad.yaml", `id: bad\n${base}sum: orders\nratio: { numerator: orders, denominator: sessions }\n`)), /either sum or ratio/);
  await assert.rejects(
    async () => loadPack(await packWith("checks/bad.yaml", "id: bad\nlabel: { en: X, tr: X }\nexpected: { metric: orders, label: { en: a, tr: a } }\nmeasured: { metric: roas, label: { en: b, tr: b } }\ntolerance: 0.1\nbreakdown: device\n")),
    /must be a sum/,
  );
});

test("defaults: to is the last day with data, from 27 days before", () => {
  const q = resolveQuery(pack, { metric: "orders" }, range);
  assert.deepEqual(q, { metric: "orders", group_by: "none", from: "2026-09-25", to: "2026-10-22", filters: {} });
});

test("dates are clamped to the data range and swapped when reversed", () => {
  assert.deepEqual(resolveQuery(pack, { metric: "orders", from: "2025-01-01", to: "2030-01-01" }, range).from, "2026-07-25");
  const q = resolveQuery(pack, { metric: "orders", from: "2026-10-10", to: "2026-10-01" }, range);
  assert.equal(q.from, "2026-10-01");
  assert.equal(q.to, "2026-10-10");
  assert.throws(() => resolveQuery(pack, { metric: "orders", from: "10/01/2026" }, range), /YYYY-MM-DD/);
  assert.throws(() => resolveQuery(pack, { metric: "orders", from: "2026-02-30" }, range), /YYYY-MM-DD/);
});

test("weekly results keep complete Monday–Sunday weeks only", () => {
  // 25 Jul 2026 is a Saturday, 22 Oct a Thursday.
  const q = resolveQuery(pack, { metric: "revenue", group_by: "week", from: "2026-07-25", to: "2026-10-22" }, range);
  assert.equal(q.from, "2026-07-27");
  assert.equal(q.to, "2026-10-18");
  // Already whole weeks stay as they are.
  const w = resolveQuery(pack, { metric: "revenue", group_by: "week", from: "2026-10-05", to: "2026-10-18" }, range);
  assert.deepEqual([w.from, w.to], ["2026-10-05", "2026-10-18"]);
});

test("unknown metrics, group_by and filter values are refused with the allowed values", () => {
  assert.throws(() => resolveQuery(pack, { metric: "profit" }, range), (e) => e.code === "unknown_metric" && /orders/.test(e.message));
  assert.throws(() => resolveQuery(pack, { metric: "orders", group_by: "hour" }, range), (e) => e.code === "invalid_group_by");
  assert.throws(() => normalizeFilters({ channel: "instagram" }), (e) => e.code === "invalid_filter" && /meta_ads/.test(e.message));
  assert.throws(() => normalizeFilters({ channel: ["meta_ads", "x' OR 1=1 --"] }), (e) => e.code === "invalid_filter");
  assert.throws(() => normalizeFilters({ country: "TR" }), (e) => e.code === "invalid_filter");
  assert.deepEqual(normalizeFilters({ channel: ["meta_ads", "meta_ads"], device: "mobile" }), { channel: ["meta_ads"], device: ["mobile"] });
});

test("fixed filters intersect with the person's; an empty intersection is an error", () => {
  assert.deepEqual(mergeWhere({ channel: ["google_ads", "meta_ads", "tiktok_ads"] }, { channel: ["meta_ads"] }), { channel: ["meta_ads"] });
  assert.throws(() => mergeWhere({ channel: ["google_ads", "meta_ads", "tiktok_ads"] }, { channel: ["organic"] }), /covers only google_ads/);
});

test("DuckDB SQL for a sum by day", () => {
  const q = resolveQuery(pack, { metric: "orders", group_by: "day", from: "2026-10-09", to: "2026-10-22", filters: { device: "mobile" } }, range);
  assert.equal(
    compileQuery(pack, q, { dialect: "duckdb", table: "daily_channel_device" }),
    [
      "-- metric orders v3",
      "SELECT",
      "  date AS day,",
      "  SUM(orders) AS value",
      "FROM daily_channel_device",
      "WHERE date BETWEEN DATE '2026-10-09' AND DATE '2026-10-22'",
      "  AND device = 'mobile'",
      "GROUP BY day",
      "ORDER BY day",
    ].join("\n"),
  );
});

test("BigQuery SQL for a ratio by channel: sums of parts, SAFE_DIVIDE, the metric's fixed filter", () => {
  const q = resolveQuery(pack, { metric: "roas", group_by: "channel", from: "2026-09-25", to: "2026-10-22" }, range);
  const sql = compileQuery(pack, q, { dialect: "bigquery", table: "`proj-123.marts.daily_channel_device`" });
  assert.match(sql, /SUM\(revenue\) AS numerator,\n {2}SUM\(ad_spend\) AS denominator,\n {2}SAFE_DIVIDE\(SUM\(revenue\), SUM\(ad_spend\)\) AS value/);
  assert.match(sql, /FROM `proj-123\.marts\.daily_channel_device`/);
  assert.match(sql, /channel IN \('google_ads', 'meta_ads', 'tiktok_ads'\)/);
  assert.match(sql, /ORDER BY value DESC/);
});

test("week and month buckets per dialect", () => {
  const m = pack.metrics.revenue;
  const o = { from: "2026-08-03", to: "2026-10-18", table: "t" };
  assert.match(compileAggregate(m, { ...o, dims: ["week"], dialect: "duckdb" }), /CAST\(DATE_TRUNC\('week', date\) AS DATE\) AS week/);
  assert.match(compileAggregate(m, { ...o, dims: ["week"], dialect: "bigquery" }), /DATE_TRUNC\(date, WEEK\(MONDAY\)\) AS week/);
  assert.match(compileAggregate(m, { ...o, dims: ["month"], dialect: "bigquery" }), /DATE_TRUNC\(date, MONTH\) AS month/);
  assert.throws(() => compileAggregate(m, { ...o, dims: ["week"], dialect: "postgres" }), /dialect/);
  assert.throws(() => compileAggregate(m, { ...o, from: "2026-08-03' OR '1", dims: [], dialect: "duckdb" }), /YYYY-MM-DD/);
  assert.throws(() => compileAggregate(m, { ...o, dims: [], where: { channel: ["x'--"] }, dialect: "duckdb" }), /not in the mart/);
});
