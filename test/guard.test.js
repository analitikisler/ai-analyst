// Exploratory SQL, three fences deep. (1) The guard refuses every query on the attack list, each with a code and
// plain words. (2) DuckDB: every attack is also run unguarded through the real explore path, against a demo file
// that holds a secret table next to the mart; the explore database holds only the mart, so none can read it, and
// the connection is read-only with no file access. (3) BigQuery: the dry run's referenced tables must be exactly
// the mart. The attack list includes every query of the security review's two scripts (sec/guard-attacks*.mjs).
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDemoWarehouse, generateFacts } from "../src/demo/seed.js";
import { ALLOWED_FUNCTIONS, GUARD_MESSAGES, guardSql } from "../src/explore/guard.js";
import { referenceSql, runExploreSql } from "../src/explore/run.js";
import { openBigQuery } from "../src/warehouse/bigquery.js";
import { openDuckDB } from "../src/warehouse/duckdb.js";
import { demoWorkspace, normalize } from "./helpers.js";

const DUCK = { table: "daily_channel_device", dialect: "duckdb" };
const BQ = { table: "`ornek-data.ai_analyst.daily_channel_device`", dialect: "bigquery" };
const M = "daily_channel_device";
const B = "`ornek-data.ai_analyst.daily_channel_device`";

// [sql, code]. Every one must be refused, except the few marked null, which are harmless and must also read nothing else.
const DUCK_ATTACKS = [
  // From the security review (guard-attacks.mjs, guard-attacks2.mjs).
  [`SELECT 1 /* /* */ ' */ , s FROM secret_table --' FROM ${M}`, "sql_unsupported_syntax"],
  [`SELECT * FROM ${M} /* /* */ UNION ALL SELECT s,null,null,null,null,null,null,null,null,null FROM secret_table */`, "sql_unsupported_syntax"],
  [`SELECT * FROM (PIVOT secret_table ON s USING count(*)) p, ${M}`, "sql_forbidden_keyword"],
  [`SELECT * FROM (UNPIVOT secret_table ON s INTO NAME k VALUE v) p, ${M}`, "sql_forbidden_keyword"],
  [`SELECT * FROM (TABLE secret_table) p, ${M}`, "sql_forbidden_keyword"],
  [`SELECT * FROM ${M} WHERE date IN (FROM secret_table SELECT DATE '2026-01-01')`, "sql_table_not_allowed"],
  [`SELECT * FROM (WITH secret_table AS (SELECT 1 AS s) SELECT * FROM ${M}) a, secret_table`, "sql_table_not_allowed"],
  [`SELECT json_execute_serialized_sql(json_serialize_sql('SELECT s FROM secret_table')) FROM ${M}`, "sql_forbidden_function"],
  [`SELECT * FROM ${M}, json_execute_serialized_sql(json_serialize_sql('SELECT s FROM secret_table'))`, "sql_forbidden_function"],
  [`SELECT which_secret('s3://x/y', 's3') FROM ${M}`, "sql_forbidden_function"],
  [`SELECT current_setting('home_directory') FROM ${M}`, "sql_forbidden_function"],
  [`SELECT "current_setting"('home_directory') FROM ${M}`, "sql_forbidden_function"],
  [`SELECT main.getenv('HOME') FROM ${M}`, "sql_forbidden_function"],
  [`SELECT version(), current_database(), current_schema() FROM ${M}`, "sql_forbidden_function"],
  [`SELECT (SELECT string_agg(name||'='||value, ',') FROM pragma_settings()) FROM ${M}`, "sql_forbidden_function"],
  [`SELECT * FROM ${M} WHERE 1=(SELECT count(*) FROM duckdb_tables())`, "sql_forbidden_function"],
  [`SELECT * FROM ${M}, sqlite_master`, "sql_table_not_allowed"],
  [`SELECT * FROM ${M} NATURAL JOIN secret_table`, "sql_table_not_allowed"],
  [`SELECT * FROM ${M} POSITIONAL JOIN secret_table`, "sql_table_not_allowed"],
  [`SELECT * FROM ${M} ASOF JOIN secret_table ON true`, "sql_table_not_allowed"],
  [`SELECT * FROM ${M} UNION ALL BY NAME FROM secret_table`, "sql_table_not_allowed"],
  [`SELECT * FROM ${M} UNION ALL BY NAME SELECT * FROM secret_table`, "sql_table_not_allowed"],
  [`SELECT * FROM "secret_table", ${M}`, "sql_table_not_allowed"],
  [`SELECT * FROM 'x.csv'`, "sql_table_not_allowed"],
  [`SELECT * FROM "x.csv"`, "sql_table_not_allowed"],
  [`SELECT * FROM ${M}, "x.csv"`, "sql_table_not_allowed"],
  [`SELECT * FROM ${M}\n;\nSELECT * FROM secret_table`, "sql_multiple_statements"],
  [`SELECT * FROM ${M}；SELECT 1`, "sql_unsupported_syntax"],
  [`SELECT * FROM ${M} UNION SELECT * FROM secret_table`, "sql_table_not_allowed"],
  // One string literal ("x'; select 1 --"), not a second statement: allowed, and harmless.
  [`select * from ${M} where channel = 'x''; select 1 --'`, null],
  [`SELECT s FROM secret_table AS ${M}`, "sql_table_not_allowed"],
  [`SELECT * FROM ${M} AS t(a) JOIN LATERAL (SELECT 1) x ON true`, "sql_forbidden_function"],
  [`SELECT * FROM ${M} WHERE EXISTS (SELECT 1 FROM main.secret_table)`, "sql_table_not_allowed"],
  [`SELECT * FROM ${M}, (SELECT * FROM secret_table) z`, "sql_table_not_allowed"],
  [`SELECT * FROM ${M} t, t2 AS (SELECT 1)`, "sql_table_not_allowed"],
  [`SELECT list_transform([1], x -> x) FROM ${M}`, "sql_forbidden_function"],
  [`SELECT * FROM ${M}, ${M}.secret_table`, "sql_table_not_allowed"],
  [`SELECT * FROM memory.main.secret_table, ${M}`, "sql_table_not_allowed"],
  [`SELECT * FROM t.main.secret_table, ${M}`, "sql_table_not_allowed"],
  [`SELECT * FROM ${M} JOIN (secret_table) ON true`, "sql_table_not_allowed"],
  [`SELECT * FROM (${M} JOIN secret_table ON true)`, "sql_table_not_allowed"],
  [`SELECT * FROM (${M} CROSS JOIN secret_table)`, "sql_table_not_allowed"],
  [`SELECT * FROM ${M}, (secret_table)`, "sql_table_not_allowed"],
  [`SELECT * FROM (${M}), secret_table`, "sql_table_not_allowed"],
  [`SELECT * FROM ${M} WHERE (1,1) IN (SELECT 1, 1 FROM ${M}), secret_table`, "sql_unsupported_syntax"],
  [`SELECT COLUMNS(*) FROM ${M}`, "sql_forbidden_function"],
  [`SELECT * FROM ${M} USING SAMPLE 1, secret_table`, "sql_forbidden_keyword"],
  [`SELECT * FROM ${M} SAMPLE 1`, "sql_forbidden_keyword"],
  [`WITH ${M} AS (SELECT 1 AS x) SELECT * FROM ${M}`, null], // a CTE shadowing the mart: the data is the query's own
  [`SELECT * FROM ${M} -- ; DROP\n`, null],
  [`SELECT * FROM ${M} QUALIFY row_number() OVER () = 1`, null],
  [`SELECT * FROM (secret_table JOIN ${M} ON true)`, "sql_table_not_allowed"],
  [`SELECT * FROM ${M}, (secret_table CROSS JOIN ${M})`, "sql_table_not_allowed"],
  [`SELECT * FROM ((secret_table)) , ${M}`, "sql_table_not_allowed"],
  [`SELECT s FROM (secret_table AS x JOIN ${M} AS y ON true)`, "sql_table_not_allowed"],
  // Our own.
  ["SELECT 1 FROM daily_channel_device; DROP TABLE daily_channel_device", "sql_multiple_statements"],
  ["DELETE FROM daily_channel_device", "sql_not_select"],
  ["INSERT INTO daily_channel_device VALUES (1)", "sql_not_select"],
  ["COPY daily_channel_device TO '/tmp/out.csv'", "sql_not_select"],
  ["ATTACH '/tmp/other.db' AS other", "sql_not_select"],
  ["INSTALL httpfs", "sql_not_select"],
  ["PRAGMA database_list", "sql_not_select"],
  ["SET enable_external_access = true", "sql_not_select"],
  ["EXPLAIN SELECT * FROM daily_channel_device", "sql_not_select"],
  ["TABLE secret_table", "sql_not_select"],
  ["FROM secret_table", "sql_not_select"],
  ["   ", "sql_empty"],
  ["-- only a comment", "sql_empty"],
  ["WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x", "sql_forbidden_keyword"],
  ["SELECT * INTO new_table FROM daily_channel_device", "sql_forbidden_keyword"],
  ["SELECT * FROM daily_channel_device WHERE 1 = 1 /* ; */", "sql_unsupported_syntax"],
  ["SELECT * FROM read_csv('/etc/passwd')", "sql_forbidden_function"],
  ["SELECT * FROM READ_JSON_AUTO('x.json')", "sql_forbidden_function"],
  ["SELECT * FROM glob('/Users/*')", "sql_forbidden_function"],
  ["SELECT * FROM duckdb_settings()", "sql_forbidden_function"],
  ["SELECT getenv('HOME') FROM daily_channel_device", "sql_forbidden_function"],
  ["SELECT * FROM daily_channel_device, read_csv('x')", "sql_forbidden_function"],
  ["SELECT * FROM (SELECT * FROM glob('*')) AS g", "sql_forbidden_function"],
  ["SELECT * FROM '/etc/passwd'", "sql_table_not_allowed"],
  ["SELECT * FROM information_schema.tables", "sql_forbidden_keyword"],
  ["SELECT * FROM \"information_schema\".\"tables\"", "sql_table_not_allowed"],
  ["SELECT * FROM other_table", "sql_table_not_allowed"],
  ["WITH x AS (SELECT 1) SELECT * FROM y", "sql_table_not_allowed"],
  ["SELECT 1", "sql_table_not_allowed"],
  ["SELECT * FROM daily_channel_device # , read_csv('x')", "sql_forbidden_function"],
  ["SELECT 'a\\' , read_csv(' FROM daily_channel_device", "sql_unsupported_syntax"],
  ["SELECT E'a\\'' FROM daily_channel_device", "sql_unsupported_syntax"],
  ["SELECT $$ ' $$, read_csv('x') FROM daily_channel_device", "sql_unsupported_syntax"],
  ["SELECT * FROM daily_channel_device WHERE x = ?", "sql_unsupported_syntax"],
  ["SELECT * FROM daily_channel_device /* never closed", "sql_unsupported_syntax"],
  ["SELECT 'never closed FROM daily_channel_device", "sql_unterminated"],
  [`SELECT ${"1 + ".repeat(3000)}1 FROM daily_channel_device`, "sql_too_long"],
  ["SELECT * FROM daily_channel_device, LATERAL (SELECT 1)", "sql_forbidden_function"],
  ["SELECT * FROM (SELECT * FROM daily_channel_device) a JOIN (VALUES (1)) v(x) ON true, secret_table", "sql_forbidden_function"],
  ["SELECT * FROM daily_channel_device AS a, (SELECT 1 FROM daily_channel_device) b, (secret_table)", "sql_table_not_allowed"],
  ["WITH a AS (SELECT * FROM daily_channel_device) SELECT * FROM a, (WITH b AS (SELECT 1) SELECT * FROM b) c", "sql_table_not_allowed"],
  ["SELECT * FROM daily_channel_device TABLESAMPLE SYSTEM (10)", "sql_forbidden_keyword"],
  ["SELECT repeat('x', 100000000) FROM daily_channel_device", "sql_forbidden_function"],
  ["SELECT * FROM daily_channel_device WHERE current_user = 'x'", "sql_forbidden_keyword"],
];

const BQ_ATTACKS = [
  // From the security review.
  [`SELECT AI.GENERATE('hi', connection_id => 'us.c', endpoint => 'gemini-2.5-flash') FROM ${B}`, "sql_forbidden_function"],
  [`SELECT SESSION_USER() FROM ${B}`, "sql_forbidden_keyword"],
  [`SELECT * FROM ${B} /* /* */ , \`ornek-data.hr.salaries\` */`, "sql_unsupported_syntax"],
  ["SELECT * FROM `region-us`.INFORMATION_SCHEMA.JOBS", "sql_forbidden_keyword"],
  ["SELECT * FROM `region-us.INFORMATION_SCHEMA.JOBS`", "sql_table_not_allowed"],
  ["SELECT * FROM `ornek-data.ai_analyst.*`", "sql_table_not_allowed"],
  ["SELECT * FROM `ornek-data.ai_analyst.daily_channel_*`", "sql_table_not_allowed"],
  ["SELECT * FROM `ornek-data`.ai_analyst.daily_channel_device, `ornek-data`.hr.salaries", "sql_table_not_allowed"],
  [`SELECT * FROM ${B} WHERE 1 IN (SELECT 1 FROM (TABLE \`ornek-data.hr.salaries\`))`, "sql_forbidden_keyword"],
  // Reads a constant and the mart: harmless, allowed.
  [`SELECT * FROM (WITH x AS (SELECT 1) SELECT 1), ${B}`, null],
  [`SELECT * FROM ${B} PIVOT(SUM(orders) FOR channel IN ('a'))`, "sql_forbidden_keyword"],
  [`SELECT OBJ.GET_ACCESS_URL(ref, 'r') FROM ${B}`, "sql_forbidden_function"],
  [`SELECT * FROM ${B}\nUNION ALL SELECT * FROM \`ornek-data\`.\`hr\`.\`salaries\``, "sql_table_not_allowed"],
  [`SELECT * FROM ${B} WHERE x = "a\\""`, "sql_unsupported_syntax"],
  ["SELECT * FROM (`ornek-data.hr.salaries` JOIN `ornek-data.ai_analyst.daily_channel_device` ON true)", "sql_table_not_allowed"],
  ["SELECT * FROM (`ornek-data.hr.salaries` CROSS JOIN `ornek-data.ai_analyst.daily_channel_device`)", "sql_table_not_allowed"],
  [`SELECT * FROM ${B}, (\`ornek-data.hr.salaries\` CROSS JOIN ${B})`, "sql_table_not_allowed"],
  [`SELECT * FROM ${B} /* /* */ UNION ALL SELECT * FROM x */`, "sql_unsupported_syntax"],
  [`SELECT * FROM (${B} JOIN \`ornek-data.hr.salaries\` USING (x))`, "sql_table_not_allowed"],
  [`SELECT * FROM ${B}, (\`ornek-data.hr.salaries\`)`, "sql_table_not_allowed"],
  [`SELECT KEYS.NEW_KEYSET('AEAD_AES_GCM_256') FROM ${B}`, "sql_forbidden_function"],
  // Our own.
  ["SELECT * FROM `ornek-data.ai_analyst.INFORMATION_SCHEMA.TABLES`", "sql_table_not_allowed"],
  ["SELECT * FROM `other-project.ai_analyst.daily_channel_device`", "sql_table_not_allowed"],
  ["SELECT * FROM EXTERNAL_QUERY('conn', 'SELECT 1')", "sql_forbidden_keyword"],
  ["SELECT * FROM ML.PREDICT(MODEL `m`, TABLE `t`)", "sql_forbidden_function"],
  ["SELECT * FROM `ornek-data.ai_analyst.__TABLES__`", "sql_table_not_allowed"],
  [`SELECT * FROM ${B} # \n; DROP TABLE x`, "sql_multiple_statements"],
  [`SELECT * FROM "ornek-data.ai_analyst.daily_channel_device"`, "sql_table_not_allowed"],
  ["SELECT r'\\' FROM x", "sql_unsupported_syntax"],
  ["EXPORT DATA OPTIONS(uri='gs://b/*') AS SELECT 1", "sql_not_select"],
  [`SELECT @@project_id FROM ${B}`, "sql_unsupported_syntax"],
  [`SELECT VECTOR_SEARCH(1) FROM ${B}`, "sql_forbidden_function"],
  [`SELECT AEAD.ENCRYPT(k, 'x', 'y') FROM ${B}`, "sql_forbidden_function"],
  [`SELECT NET.HOST('https://x') FROM ${B}`, "sql_forbidden_function"],
  [`SELECT * FROM ${B}, UNNEST([1, 2])`, "sql_forbidden_function"],
  [`SELECT * FROM ${B} FOR SYSTEM_TIME AS OF TIMESTAMP '2026-01-01'`, null], // the mart at an earlier time: still the mart
  ["SELECT * FROM daily_channel_device", null], // the guard allows the bare name; the dry run then resolves it (or fails)
];

const refusal = (sql, wh) => {
  try {
    guardSql(sql, wh);
    return null;
  } catch (err) {
    assert.ok(GUARD_MESSAGES[err.code], `${err.code} has plain words`);
    assert.ok(err.message.length > 20);
    return err.code;
  }
};

test("the guard refuses every DuckDB attack, each with a code and plain words", () => {
  for (const [sql, code] of DUCK_ATTACKS) assert.equal(refusal(sql, DUCK), code, sql.slice(0, 100));
});

test("the guard refuses every BigQuery attack", () => {
  for (const [sql, code] of BQ_ATTACKS) assert.equal(refusal(sql, BQ), code, sql.slice(0, 100));
});

test("allowed: SELECT and WITH … SELECT on the mart, self-joins, top-level CTEs, line comments, subqueries, allowlisted functions", () => {
  for (const sql of [
    `SELECT channel, SUM(revenue) AS revenue FROM ${M} GROUP BY channel`,
    `-- a comment\nSELECT device, SUM(orders) FROM main.${M} GROUP BY 1`,
    `WITH a AS (SELECT * FROM ${M}), b AS (SELECT * FROM a) SELECT COUNT(*) FROM b`,
    `SELECT x.date FROM ${M} x JOIN ${M} y ON x.date = y.date AND x.channel = y.channel`,
    `SELECT * FROM (SELECT date, SUM(orders) AS o FROM ${M} GROUP BY date) AS d ORDER BY o DESC`,
    `SELECT * FROM (${M} JOIN ${M} AS b USING (date))`,
    `SELECT 'it''s' AS label, "date" FROM "${M}"`,
    `SELECT dayname(date) AS d, ROUND(SUM(revenue) / NULLIF(SUM(orders), 0), 2) AS aov FROM ${M} WHERE date BETWEEN DATE '2026-10-01' AND DATE '2026-10-22' GROUP BY d`,
  ]) assert.equal(refusal(sql, DUCK), null, sql);
  assert.equal(refusal(`SELECT SAFE.LOG(SUM(revenue)) FROM ${B}`, BQ), null);
  const g = guardSql(`SELECT 1 AS n FROM ${M};`, DUCK);
  assert.equal(g.wrapped, `SELECT * FROM (\nSELECT 1 AS n FROM ${M}\n) AS q\nLIMIT 1000`);
  assert.ok(ALLOWED_FUNCTIONS.size > 80 && !ALLOWED_FUNCTIONS.has("getenv"));
});

// A demo file with a secret table next to the mart, opened the way the app opens it.
let dir, wh, ws;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "aa-guard-"));
  const file = path.join(dir, "demo.duckdb");
  await buildDemoWarehouse(file, generateFacts().slice(0, 48));
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const i = await DuckDBInstance.create(file);
  const c = await i.connect();
  await c.run("CREATE TABLE secret_table AS SELECT 'TOPSECRET' AS s");
  await c.run("CHECKPOINT");
  c.closeSync();
  i.closeSync();
  wh = await openDuckDB(file);
  ws = await demoWorkspace({ seed: false });
});
after(() => {
  wh.close();
  ws.close();
  rmSync(dir, { recursive: true, force: true });
});

test("DuckDB: the demo file does hold the secret, so the fence below is tested for real", async () => {
  assert.deepEqual(await wh.query("SELECT s FROM secret_table"), [{ s: "TOPSECRET" }]);
});

test("DuckDB: every attack, run unguarded on the real explore path, reads nothing but the mart and writes nothing", async () => {
  for (const [sql] of DUCK_ATTACKS) {
    // A 100 MB string per row is a memory attack on the test itself; the guard refuses repeat() above.
    if (sql.includes("repeat(")) continue;
    let out = null;
    try {
      out = await wh.explore(sql);
    } catch (err) {
      assert.ok(["explore_sql_error", "explore_timeout"].includes(err.code), `${sql.slice(0, 80)}: ${err.code}`);
      assert.ok(!/\/(Users|var|tmp|private)\//.test(err.message), "no path in the error");
    }
    assert.ok(!JSON.stringify(out ?? "").includes("TOPSECRET"), `${sql.slice(0, 100)} read the secret`);
  }
  assert.ok(!existsSync("/tmp/out.csv") || readFileSync("/tmp/out.csv", "utf8").indexOf("organic") < 0, "COPY wrote nothing");
  // Guarded, the same queries never reach the database.
  for (const [sql, code] of DUCK_ATTACKS) if (code) await assert.rejects(runExploreSql({ warehouse: wh }, { sql, measure: "other", dims: [], from: "2026-07-25", to: "2026-07-26", unit: "count" }), /./);
});

test("DuckDB: the explore database is read-only, has no file access, a locked configuration, and only the mart", async () => {
  for (const sql of ["SELECT * FROM read_csv('/etc/passwd')", "COPY daily_channel_device TO '/tmp/aa-x.csv'", "CREATE TABLE t (a INT)", "SET enable_external_access = true", "SELECT * FROM secret_table", "ATTACH ':memory:' AS m"]) {
    await assert.rejects(wh.explore(sql), (e) => e.code === "explore_sql_error", sql);
  }
  const tables = await wh.explore("SELECT table_name FROM information_schema.tables");
  assert.deepEqual(tables.rows.map((r) => r.table_name), ["daily_channel_device"]);
});

/** A BigQuery client whose dry run reports the given tables and statement type. */
const bqClient = (refs, statementType = "SELECT") => {
  const calls = [];
  return {
    calls,
    async createQueryJob(o) {
      calls.push(["dry", o]);
      return [{ metadata: { statistics: { totalBytesProcessed: "100", query: { statementType, ...(refs ? { referencedTables: refs } : {}) } } } }];
    },
    async query(o) {
      calls.push(["run", o]);
      return [[{ n: 1 }]];
    },
  };
};
const MART = { projectId: "ornek-data", datasetId: "ai_analyst", tableId: "daily_channel_device" };
const cfg = { project: "ornek-data", dataset: "ai_analyst", location: "EU", maxBytes: 1024 ** 3 };

test("BigQuery: the dry run decides; any other referenced table, a non-SELECT or a missing report is refused before the run", async () => {
  const ok = bqClient([MART]);
  assert.equal((await (await openBigQuery(cfg, { client: ok })).explore("SELECT 1")).rows.length, 1);
  assert.deepEqual(ok.calls.map(([k]) => k), ["dry", "run"]);
  for (const [client, code] of [
    [bqClient([MART, { projectId: "ornek-data", datasetId: "hr", tableId: "salaries" }]), "sql_table_not_allowed"],
    [bqClient([{ projectId: "ornek-data", datasetId: "hr", tableId: "salaries" }]), "sql_table_not_allowed"],
    [bqClient([]), "sql_table_not_allowed"],
    [bqClient(null), "sql_table_not_allowed"],
    [bqClient([MART], "SCRIPT"), "sql_not_select"],
  ]) {
    const w = await openBigQuery(cfg, { client });
    await assert.rejects(w.explore("SELECT 1"), (e) => e.code === code);
    assert.deepEqual(client.calls.map(([k]) => k), ["dry"], "never run");
  }
  // Compiled metric queries are checked too when the dry run reports tables.
  await assert.rejects((await openBigQuery(cfg, { client: bqClient([{ projectId: "x", datasetId: "y", tableId: "z" }]) })).query("SELECT 1"), (e) => e.code === "sql_table_not_allowed");
});

test("the prototype's four exploratory questions: the same SQL, accepted by the guard, the same rows on DuckDB", async () => {
  const mock = JSON.parse(readFileSync(new URL("./fixtures/mock-explore.json", import.meta.url), "utf8"));
  for (const m of mock) {
    assert.equal(referenceSql(m.spec), m.sql, "the SQL a model would write, as the prototype wrote it");
    const x = await runExploreSql(ws, { ...m.spec, unit: m.unit, sql: m.sql }, ws.pack);
    assert.equal(x.shape, m.shape);
    assert.deepEqual(normalize(x.rows), normalize(m.rows), JSON.stringify(m.spec));
  }
});
