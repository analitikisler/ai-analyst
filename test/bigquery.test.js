// BigQuery cannot run here, so this checks the SQL target, the job options and the dry-run cap with a fake client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRow, openBigQuery, queryOptions, tableName } from "../src/warehouse/bigquery.js";
import { loadConfig } from "../src/config.js";

const cfg = { project: "ornek-moda", dataset: "marts", location: "EU", maxBytes: 2 * 1024 ** 3 };

function fakeClient({ bytes = 1000, rows = [] } = {}) {
  const calls = [];
  return {
    calls,
    async createQueryJob(opts) {
      calls.push(["dry", opts]);
      return [{ metadata: { statistics: { totalBytesProcessed: String(bytes) } } }];
    },
    async query(opts) {
      calls.push(["run", opts]);
      return [rows];
    },
  };
}

test("the table name is validated and quoted", () => {
  assert.equal(tableName(cfg), "`ornek-moda.marts.daily_channel_device`");
  assert.equal(tableName({ project: "example.com:ornek-moda", dataset: "marts" }), "`example.com:ornek-moda.marts.daily_channel_device`");
  assert.throws(() => tableName({ project: "x`; DROP", dataset: "marts" }), /not a valid project/);
  assert.throws(() => tableName({ project: "ornek-moda", dataset: "marts.x" }), /not a valid dataset/);
  assert.throws(() => tableName({ project: null, dataset: "marts" }), /BIGQUERY_PROJECT/);
});

test("job options: standard SQL, the location, the bytes cap as a string, dry run on request", () => {
  assert.deepEqual(queryOptions(cfg, "SELECT 1"), { query: "SELECT 1", location: "EU", useLegacySql: false, maximumBytesBilled: "2147483648" });
  assert.equal(queryOptions(cfg, "SELECT 1", { dryRun: true }).dryRun, true);
});

test("every query is dry-run first, then run with maximumBytesBilled", async () => {
  const client = fakeClient({ rows: [{ day: { value: "2026-10-09" }, value: { toString: () => "12.5" } }] });
  const wh = await openBigQuery(cfg, { client });
  assert.equal(wh.dialect, "bigquery");
  assert.equal(wh.demo, false);
  await wh.query("SELECT 1");
  assert.deepEqual(client.calls.map(([k]) => k), ["dry", "run"]);
  assert.equal(client.calls[0][1].dryRun, true);
  assert.equal(client.calls[1][1].dryRun, undefined);
  assert.equal(client.calls[1][1].maximumBytesBilled, "2147483648");
});

test("a query over the cap is refused before it runs", async () => {
  const client = fakeClient({ bytes: 5 * 1024 ** 3 });
  const wh = await openBigQuery(cfg, { client });
  await assert.rejects(wh.query("SELECT 1"), (e) => e.code === "bytes_cap" && /5\.00 GB, more than the 2\.00 GB cap/.test(e.message));
  assert.deepEqual(client.calls.map(([k]) => k), ["dry"]);
});

test("BigQuery values become plain dates and numbers", () => {
  assert.deepEqual(normalizeRow({ day: { value: "2026-10-09" }, channel: "meta_ads", value: "12.50", numerator: 3, denominator: null }), { day: "2026-10-09", channel: "meta_ads", value: 12.5, numerator: 3, denominator: null });
});

test("config: env first, then the config file, with the CONTRACT defaults", () => {
  const c = loadConfig({ env: {}, cwd: "/nonexistent" });
  assert.equal(c.port, 8787);
  assert.equal(c.host, "127.0.0.1");
  assert.equal(c.warehouse, "duckdb");
  assert.equal(c.bigquery.location, "EU");
  assert.equal(c.bigquery.maxBytes, 2 * 1024 ** 3);
  assert.equal(c.model, "claude-opus-5-5");
  assert.equal(c.workspace, "Örnek Moda");
  assert.equal(c.anthropicApiKey, null);
  const e = loadConfig({ env: { AI_ANALYST_WAREHOUSE: "bigquery", BIGQUERY_PROJECT: "p-12345", AI_ANALYST_MODEL: "claude-sonnet-5-5", PORT: "9000" }, cwd: "/nonexistent" });
  assert.deepEqual([e.warehouse, e.bigquery.project, e.model, e.port], ["bigquery", "p-12345", "claude-sonnet-5-5", 9000]);
  assert.throws(() => loadConfig({ env: { AI_ANALYST_WAREHOUSE: "snowflake" }, cwd: "/nonexistent" }), /duckdb or bigquery/);
});
