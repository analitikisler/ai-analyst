// BigQuery cannot run here, so this checks the SQL target, the job options and the dry-run cap with a fake client.
import "./setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRow, openBigQuery, queryOptions, tableName } from "../src/warehouse/bigquery.js";
import { loadConfig, workspaceName } from "../src/config.js";

const cfg = { project: "ornek-moda", dataset: "marts", location: "EU", maxBytes: 2 * 1024 ** 3 };

function fakeClient({ bytes = 1000, rows = [], refs = null } = {}) {
  const calls = [];
  return {
    calls,
    async createQueryJob(opts) {
      calls.push(["dry", opts]);
      return [{ metadata: { statistics: { totalBytesProcessed: String(bytes), ...(refs ? { query: { statementType: "SELECT", referencedTables: refs } } : {}) } } }];
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
  assert.equal(c.workspace, null);
  // B8: the demo name only on demo data; own data is named after the config, else the dataset or project.
  assert.equal(workspaceName(c, { demo: true }), "Örnek Moda");
  const own = loadConfig({ env: { AI_ANALYST_WAREHOUSE: "bigquery", BIGQUERY_PROJECT: "shop-data-1", BIGQUERY_DATASET: "marts" }, cwd: "/nonexistent" });
  assert.equal(workspaceName(own, { demo: false }), "marts");
  assert.equal(workspaceName({ ...own, bigquery: { ...own.bigquery, dataset: null } }, { demo: false }), "shop-data-1");
  const named = loadConfig({ env: { AI_ANALYST_WORKSPACE: "Acme", AI_ANALYST_WAREHOUSE: "bigquery", BIGQUERY_PROJECT: "shop-data-1" }, cwd: "/nonexistent" });
  assert.equal(workspaceName(named, { demo: false }), "Acme");
  assert.equal(c.anthropicApiKey, null);
  const e = loadConfig({ env: { AI_ANALYST_WAREHOUSE: "bigquery", BIGQUERY_PROJECT: "p-12345", AI_ANALYST_MODEL: "claude-sonnet-5-5", PORT: "9000" }, cwd: "/nonexistent" });
  assert.deepEqual([e.warehouse, e.bigquery.project, e.model, e.port], ["bigquery", "p-12345", "claude-sonnet-5-5", 9000]);
  assert.throws(() => loadConfig({ env: { AI_ANALYST_WAREHOUSE: "snowflake" }, cwd: "/nonexistent" }), /duckdb or bigquery/);
});

test("config: the help email is on by default, can be redirected or turned off; Cloud needs env only", () => {
  assert.deepEqual(loadConfig({ env: {}, cwd: "/nonexistent" }).help, { email: "hello@analitikisler.com" });
  assert.deepEqual(loadConfig({ env: { AI_ANALYST_HELP_EMAIL: "data@shop.test" }, cwd: "/nonexistent" }).help, { email: "data@shop.test" });
  assert.equal(loadConfig({ env: { AI_ANALYST_HELP: "off" }, cwd: "/nonexistent" }).help, null);
  const c = loadConfig({ env: { AI_ANALYST_CLOUD_URL: "https://cloud.example.test/v1", AI_ANALYST_CLOUD_TOKEN: "t" }, cwd: "/nonexistent" });
  assert.deepEqual(c.cloud, { url: "https://cloud.example.test/v1", token: "t" });
});

test("exploratory SQL on BigQuery: dry run first, then the run with the bytes cap, standard SQL and a job timeout", async () => {
  const client = fakeClient({ bytes: 4096, rows: [{ channel: "meta_ads", revenue: { toString: () => "1250.5" } }], refs: [{ projectId: "ornek-moda", datasetId: "marts", tableId: "daily_channel_device" }] });
  const wh = await openBigQuery({ ...cfg, jobTimeoutMs: 60000 }, { client });
  const out = await wh.explore("SELECT * FROM (SELECT channel, SUM(revenue) AS revenue FROM `ornek-moda.marts.daily_channel_device` GROUP BY channel) AS q LIMIT 1000", { timeoutMs: 20000 });
  assert.deepEqual(client.calls.map(([k]) => k), ["dry", "run"]);
  assert.deepEqual([client.calls[1][1].maximumBytesBilled, client.calls[1][1].useLegacySql, client.calls[1][1].jobTimeoutMs], ["2147483648", false, 20000]);
  assert.deepEqual(out, { rows: [{ channel: "meta_ads", revenue: 1250.5 }], columns: ["channel", "revenue"], bytes: 4096 });
  const over = await openBigQuery(cfg, { client: fakeClient({ bytes: 3 * 1024 ** 3, refs: [{ projectId: "ornek-moda", datasetId: "marts", tableId: "daily_channel_device" }] }) });
  await assert.rejects(over.explore("SELECT 1"), (e) => e.code === "bytes_cap");
});

test("config: a data project and a separate job project; the file can lower the cap, not raise it", () => {
  const c = loadConfig({ env: { BIGQUERY_PROJECT: "ornek-data", BIGQUERY_JOB_PROJECT: "ornek-jobs", BIGQUERY_DATASET: "ai_analyst" }, cwd: "/nonexistent" });
  assert.deepEqual([c.bigquery.project, c.bigquery.jobProject, c.bigquery.ceiling], ["ornek-data", "ornek-jobs", 2 * 1024 ** 3]);
  assert.equal(loadConfig({ env: { BIGQUERY_PROJECT: "ornek-data" }, cwd: "/nonexistent" }).bigquery.jobProject, "ornek-data", "the job project defaults to the data project");
});
