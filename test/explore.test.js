// Exploratory queries across several tables (docs/design/multi-table-queries.md). The three fences again, now with
// two more allowed tables and a decoy in the same dataset: (1) the guard, (2) BigQuery's dry run (stubbed:
// referencedTables, views, statementType, location), (3) the DuckDB explore file holding only the allowed tables.
// Then protected columns, the settings and the env lock, describe_tables, the demo shop's totals and a model turn
// across tables. Every Google and model call is a stub.
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { callAction } from "../src/actions/index.js";
import { runTurn } from "../src/agent/agent.js";
import { loadConfig } from "../src/config.js";
import { buildDemoWarehouse, DEMO, generateFacts, generateShop } from "../src/demo/seed.js";
import { parseAllowEnv, policyFor, proposeProtected } from "../src/explore/allow.js";
import { GUARD_MESSAGES, guardSql } from "../src/explore/guard.js";
import { runExploreSql } from "../src/explore/run.js";
import { openBigQuery } from "../src/warehouse/bigquery.js";
import { openDuckDB } from "../src/warehouse/duckdb.js";
import { BQ_ATTACKS, DUCK_ATTACKS } from "./attacks.js";
import { ctxFor, demoWorkspace } from "./helpers.js";

const refusal = (sql, wh, opts) => {
  try {
    guardSql(sql, wh, opts);
    return null;
  } catch (err) {
    assert.ok(GUARD_MESSAGES[err.code], `${err.code} has plain words`);
    return err.code;
  }
};

// ---------------------------------------------------------------- the guard, two allowed tables and a decoy

const DUCK = { table: "daily_channel_device", dialect: "duckdb" };
const BQ = { table: "`ornek-data.ai_analyst.daily_channel_device`", dialect: "bigquery" };
const bqCfg = { project: "ornek-data", dataset: "ai_analyst", location: "EU", maxBytes: 1024 ** 3 };
const duckTwo = (wh = { demo: true }) => policyFor({ bigquery: {}, explore: { allow: [], demoAllow: [{ project: null, dataset: "demo", table: "orders" }, { project: null, dataset: "demo", table: "products" }] } }, wh);
const bqTwo = policyFor({ bigquery: bqCfg, explore: { allow: [{ project: "ornek-data", dataset: "ai_analyst", table: "orders" }, { project: "ornek-data", dataset: "ai_analyst", table: "products" }], demoAllow: [] } }, { demo: false });
const bqViewByName = policyFor({ bigquery: bqCfg, explore: { allow: [{ project: "ornek-data", dataset: "shop", table: null }, { project: "ornek-data", dataset: "shop", table: "v_returns" }], demoAllow: [] } }, { demo: false });
const bqDataset = policyFor({ bigquery: bqCfg, explore: { allow: [{ project: "ornek-data", dataset: "shop", table: null }], demoAllow: [] } }, { demo: false });

// Cross-table attacks: the allowed tables next to a decoy (secret_table, and returns / order_items, which the demo
// file holds but the list does not allow).
const DUCK_MULTI = [
  ["SELECT * FROM orders JOIN secret_table ON true", "sql_table_not_allowed"],
  ["SELECT * FROM orders o JOIN returns r ON o.order_id = r.order_id", "sql_table_not_allowed"],
  ["SELECT * FROM (orders JOIN returns ON true)", "sql_table_not_allowed"],
  ["SELECT * FROM (returns JOIN orders ON true)", "sql_table_not_allowed"],
  ["SELECT * FROM orders, (order_items)", "sql_table_not_allowed"],
  ["SELECT * FROM products WHERE product_id IN (SELECT product_id FROM returns)", "sql_table_not_allowed"],
  ["SELECT * FROM (WITH returns AS (SELECT 1 AS x) SELECT * FROM orders) a, returns", "sql_table_not_allowed"],
  ["WITH o AS (SELECT * FROM orders) SELECT * FROM o, order_items", "sql_table_not_allowed"],
  ["SELECT * FROM main.returns", "sql_table_not_allowed"],
  ["SELECT * FROM memory.main.orders", "sql_table_not_allowed"],
  ['SELECT * FROM "returns"', "sql_table_not_allowed"],
  ["SELECT * FROM orders UNION ALL SELECT * FROM secret_table", "sql_table_not_allowed"],
  ["SELECT * FROM orders NATURAL JOIN order_items", "sql_table_not_allowed"],
  ["SELECT * FROM orders POSITIONAL JOIN secret_table", "sql_table_not_allowed"],
  ["SELECT * FROM products AS returns", null], // an alias named like the decoy reads products
  ["SELECT p.category, COUNT(*) AS n FROM orders o JOIN products p ON true GROUP BY 1", null],
];
const BQ_MULTI = [
  ["SELECT * FROM `ornek-data.ai_analyst.customers_pii`", "sql_table_not_allowed"],
  ["SELECT * FROM `ornek-data.ai_analyst.orders` o JOIN `ornek-data.ai_analyst.customers_pii` c ON true", "sql_table_not_allowed"],
  ["SELECT * FROM (`ornek-data.ai_analyst.customers_pii` JOIN `ornek-data.ai_analyst.orders` ON true)", "sql_table_not_allowed"],
  ["SELECT * FROM `ornek-data.ai_analyst.orders`, (`ornek-data.ai_analyst.customers_pii`)", "sql_table_not_allowed"],
  ["SELECT * FROM `ornek-data.ai_analyst.*`", "sql_table_not_allowed"],
  ["SELECT * FROM `ornek-data.ai_analyst.orders*`", "sql_table_not_allowed"],
  ["SELECT * FROM `ornek-data.ai_analyst.__TABLES__`", "sql_table_not_allowed"],
  ["SELECT * FROM `ornek-data.ai_analyst.INFORMATION_SCHEMA.COLUMNS`", "sql_table_not_allowed"],
  ["SELECT * FROM ai_analyst.orders", "sql_table_not_allowed"],
  ["SELECT * FROM orders", "sql_table_not_allowed"],
  ["SELECT * FROM `ornek-data.AI_ANALYST.orders`", "sql_table_not_allowed"], // datasets are case-sensitive
  ["SELECT * FROM `other-proj.ai_analyst.orders`", "sql_table_not_allowed"],
  ["SELECT * FROM `ornek-data.ai_analyst.orders` WHERE x IN (SELECT 1 FROM `ornek-data.hr.salaries`)", "sql_table_not_allowed"],
  ["WITH o AS (SELECT * FROM `ornek-data.ai_analyst.orders`) SELECT * FROM o, `ornek-data.ai_analyst.customers_pii`", "sql_table_not_allowed"],
  ["SELECT p.category, SUM(o.order_total) AS revenue FROM `ornek-data.ai_analyst.orders` o JOIN `ornek-data`.ai_analyst.products p ON true GROUP BY 1", null],
  ["SELECT COUNT(*) FROM `ornek-data.ai_analyst.daily_channel_device`", null],
];

test("guard, two allowed tables and a decoy in the same dataset: the whole attack list is still refused, each with the same code", () => {
  for (const [sql, code] of DUCK_ATTACKS) assert.equal(refusal(sql, DUCK, { policy: duckTwo() }), code, sql.slice(0, 100));
  for (const [sql, code] of BQ_ATTACKS) assert.equal(refusal(sql, BQ, { policy: bqTwo }), code, sql.slice(0, 100));
  for (const [sql, code] of DUCK_MULTI) assert.equal(refusal(sql, DUCK, { policy: duckTwo() }), code, sql);
  for (const [sql, code] of BQ_MULTI) assert.equal(refusal(sql, BQ, { policy: bqTwo }), code, sql);
  const g = guardSql("SELECT p.category, COUNT(*) AS n FROM orders o JOIN main.products p ON true GROUP BY 1", DUCK, { policy: duckTwo() });
  assert.deepEqual(g.tables, ["orders", "products"]);
  const e = (() => {
    try {
      guardSql("SELECT * FROM `ornek-data.ai_analyst.customers_pii`", BQ, { policy: bqTwo });
    } catch (err) {
      return err;
    }
  })();
  assert.equal(e.params.table, "ornek-data.ai_analyst.customers_pii", "sql_table_not_allowed names the table");
});

test("guard, a dataset on the list: any table in it (also one added later), nothing beside it, no meta-tables or wildcards", () => {
  for (const [sql, code] of [
    ["SELECT COUNT(*) FROM `ornek-data.shop.orders`", null],
    ["SELECT COUNT(*) FROM `ornek-data.shop.table_added_later`", null],
    ["SELECT COUNT(*) FROM `ornek-data`.`shop`.`orders` JOIN `ornek-data.shop.items` USING (order_id)", null],
    ["SELECT * FROM `ornek-data.shop2.orders`", "sql_table_not_allowed"],
    ["SELECT * FROM `ornek-data.Shop.orders`", "sql_table_not_allowed"],
    ["SELECT * FROM `ornek-data.shop.*`", "sql_table_not_allowed"],
    ["SELECT * FROM `ornek-data.shop.__TABLES__`", "sql_table_not_allowed"],
    ["SELECT * FROM `ornek-data.shop`.INFORMATION_SCHEMA.TABLES", "sql_forbidden_keyword"],
    ["SELECT * FROM shop.orders", "sql_table_not_allowed"],
  ]) assert.equal(refusal(sql, BQ, { policy: bqDataset }), code, sql);
});

// ---------------------------------------------------------------- BigQuery dry run, stubbed

const ref = (t, d = "ai_analyst", p = "ornek-data") => ({ projectId: p, datasetId: d, tableId: t });
const bqClient = ({ refs, views, statementType = "SELECT", dryError } = {}) => {
  const calls = [];
  return {
    calls,
    async createQueryJob(o) {
      calls.push(["dry", o]);
      if (dryError) throw new Error(dryError);
      return [{ metadata: { statistics: { totalBytesProcessed: "100", query: { statementType, ...(refs ? { referencedTables: refs } : {}), ...(views ? { referencedViews: views } : {}) } } } }];
    },
    async query(o) {
      calls.push(["run", o]);
      return [[{ n: 1 }]];
    },
  };
};

test("BigQuery dry run: every referenced table and view must be on the list; views resolve to allowed tables; SELECT only; location", async () => {
  for (const [opts, policy, code, table] of [
    [{ refs: [ref("orders"), ref("products"), ref("daily_channel_device")] }, bqTwo, null],
    [{ refs: [ref("orders"), ref("customers_pii")] }, bqTwo, "sql_table_not_allowed", "ornek-data.ai_analyst.customers_pii"],
    [{ refs: [ref("customers_pii")] }, bqTwo, "sql_table_not_allowed", "ornek-data.ai_analyst.customers_pii"],
    // A view on the list whose underlying table is not: the dry run reports the table, so it is refused.
    [{ refs: [ref("salaries", "hr")], views: [ref("v_returns", "shop")] }, bqDataset, "sql_table_not_allowed", "ornek-data.hr.salaries"],
    // A view not on the list over an allowed table.
    [{ refs: [ref("orders")], views: [ref("orders_view")] }, bqTwo, "sql_table_not_allowed", "ornek-data.ai_analyst.orders_view"],
    // A view reached only through its dataset entry: refused, since a view can rename a protected column (review 2, M3).
    [{ refs: [ref("orders", "shop")], views: [ref("v_returns", "shop")] }, bqDataset, "sql_table_not_allowed", "ornek-data.shop.v_returns"],
    // The same view added by name, over tables on the list.
    [{ refs: [ref("orders", "shop")], views: [ref("v_returns", "shop")] }, bqViewByName, null],
    [{ refs: [ref("table_added_later", "shop")] }, bqDataset, null],
    [{ refs: [ref("orders", "Shop")] }, bqDataset, "sql_table_not_allowed"],
    [{ refs: Array.from({ length: 50 }, (_, i) => ref(`t${i}`, "shop")) }, bqDataset, "sql_table_not_allowed"],
    [{ refs: [] }, bqTwo, "sql_table_not_allowed"],
    [{}, bqTwo, "sql_table_not_allowed"],
    [{ refs: [ref("orders")], statementType: "SCRIPT" }, bqTwo, "sql_not_select"],
    [{ dryError: "Not found: Dataset ornek-data:us_shop was not found in location EU" }, bqTwo, "sql_location_mismatch"],
    [{ dryError: "Syntax error: Unexpected keyword at [1:8]" }, bqTwo, "explore_sql_error"],
  ]) {
    const client = bqClient(opts);
    const wh = await openBigQuery(bqCfg, { client });
    if (code === null) {
      const out = await wh.explore("SELECT 1", { policy });
      assert.deepEqual(client.calls.map(([k]) => k), ["dry", "run"]);
      assert.ok(out.tables.length >= 1);
      continue;
    }
    await assert.rejects(wh.explore("SELECT 1", { policy }), (e) => e.code === code && (!table || e.params.table === table), JSON.stringify(opts).slice(0, 120));
    assert.deepEqual(client.calls.map(([k]) => k), ["dry"], "never run");
  }
});

test("BigQuery: the per-question cap lowers the query's cap and says so; the tables come from the dry run", async () => {
  const client = { calls: [], async createQueryJob(o) { this.calls.push(o); return [{ metadata: { statistics: { totalBytesProcessed: String(600 * 1024 ** 2), query: { statementType: "SELECT", referencedTables: [ref("orders")] } } } }]; }, async query() { return [[{ n: 1 }]]; } };
  const wh = await openBigQuery(bqCfg, { client });
  await assert.rejects(wh.explore("SELECT 1", { policy: bqTwo, maxBytes: 500 * 1024 ** 2 }), (e) => e.code === "bytes_cap" && e.params.question === 1 && /left of this question/.test(e.message));
  assert.equal(client.calls[0].maximumBytesBilled, String(500 * 1024 ** 2));
  const out = await wh.explore("SELECT 1", { policy: bqTwo });
  assert.deepEqual(out.tables, ["ornek-data.ai_analyst.orders"]);
});

// ---------------------------------------------------------------- DuckDB: the explore file holds only the allowed tables

let dir, wh;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "aa-explore-"));
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
});
after(() => {
  wh.close();
  rmSync(dir, { recursive: true, force: true });
});

test("DuckDB, two allowed tables: every attack, run unguarded on the explore path, reads neither the secret nor the decoys", async () => {
  const policy = duckTwo(wh);
  assert.deepEqual(policy.allowed.sort(), ["daily_channel_device", "orders", "products"]);
  const cat = await wh.explore("SELECT table_name FROM information_schema.tables ORDER BY 1", { policy });
  assert.deepEqual(cat.rows.map((r) => r.table_name), ["daily_channel_device", "orders", "products"], "only the allowed tables are there");
  for (const [sql] of [...DUCK_ATTACKS, ...DUCK_MULTI]) {
    if (sql.includes("repeat(")) continue;
    let out = null;
    try {
      out = await wh.explore(sql, { policy });
    } catch (err) {
      assert.ok(["explore_sql_error", "explore_timeout"].includes(err.code), `${sql.slice(0, 80)}: ${err.code}`);
    }
    const text = JSON.stringify(out ?? "");
    assert.ok(!text.includes("TOPSECRET"), `${sql.slice(0, 100)} read the secret`);
    assert.ok(!/"return_id"|"refund_amount"|"line_total"/.test(text), `${sql.slice(0, 100)} read a decoy`);
  }
  for (const t of ["returns", "order_items", "secret_table"]) await assert.rejects(wh.explore(`SELECT COUNT(*) FROM ${t}`, { policy }), (e) => e.code === "explore_sql_error", t);
  assert.equal((await wh.explore("SELECT COUNT(*) AS n FROM orders", { policy })).rows[0].n > 0, true);
  for (const sql of ["CREATE TABLE t (a INT)", "COPY orders TO '/tmp/aa-orders.csv'", "SET enable_external_access = true", "ATTACH ':memory:' AS m"]) await assert.rejects(wh.explore(sql, { policy }), (e) => e.code === "explore_sql_error", sql);
});

// ---------------------------------------------------------------- protected columns

const shopPolicy = policyFor({ bigquery: { project: "p-shop1", dataset: "d" }, explore: { allow: [{ project: "p-shop1", dataset: "d", table: null }], demoAllow: [] } }, { demo: false });
const PROT = { "p-shop1.d.customers": new Set(["email", "phone", "first_name", "name", "customer_id"]), "p-shop1.d.orders": new Set(["customer_id"]) };
const protectedCols = (k) => PROT[k] ?? new Set();
const shopWh = { table: "`p-shop1.d.daily_channel_device`", dialect: "bigquery" };
const C = "`p-shop1.d.customers`";
const O = "`p-shop1.d.orders`";
const P = "`p-shop1.d.products`";

test("protected columns: refused in the output through *, aliases, CTEs, subqueries and expressions, and in GROUP BY or ORDER BY", () => {
  for (const sql of [
    `SELECT email FROM ${C}`,
    `SELECT c.email FROM ${C} c`,
    `SELECT \`email\` FROM ${C}`,
    `SELECT email AS e FROM ${C}`,
    `SELECT LOWER(email) AS e FROM ${C}`,
    `SELECT CONCAT(first_name, ' ') AS n FROM ${C}`,
    `SELECT MAX(email) AS e FROM ${C}`,
    `SELECT ARRAY_AGG(email) AS e FROM ${C}`,
    `SELECT CASE WHEN email LIKE '%x' THEN 1 END AS e FROM ${C}`,
    `SELECT * FROM ${C}`,
    `SELECT c.* FROM ${C} c`,
    `SELECT o.order_id, c.* FROM ${O} o JOIN ${C} c USING (customer_id)`,
    `SELECT * FROM ${O} o JOIN ${P} p ON true`, // * over a join that holds a protected column
    `SELECT c FROM ${C} c`, // a whole row comes back as a struct
    `SELECT ARRAY_AGG(c) AS rows_ FROM ${C} c`,
    `SELECT customers FROM ${C}`,
    `SELECT ${C} FROM ${C}`,
    `WITH x AS (SELECT email FROM ${C}) SELECT COUNT(*) AS n FROM x`,
    `WITH x AS (SELECT * FROM ${C}) SELECT COUNT(*) AS n FROM x`,
    `WITH x AS (SELECT email AS e FROM ${C}) SELECT e FROM x`,
    `SELECT e FROM (SELECT email AS e FROM ${C}) s`,
    `SELECT customer_id, SUM(order_total) AS revenue FROM ${O} GROUP BY customer_id`,
    `SELECT SUM(order_total) AS revenue FROM ${O} GROUP BY customer_id`,
    `SELECT SUM(order_total) AS revenue FROM ${O} GROUP BY ROLLUP(customer_id)`,
    `SELECT order_id FROM ${O} ORDER BY customer_id LIMIT 1`,
    `SELECT COUNT(*) OVER (PARTITION BY customer_id) AS n FROM ${O}`,
    `SELECT channel IN (SELECT email FROM ${C}) AS x FROM ${O}`,
    `SELECT name FROM ${P} p JOIN ${C} c ON true`, // unqualified and ambiguous: protected
  ]) assert.equal(refusal(sql, shopWh, { policy: shopPolicy, protectedCols }), "sql_protected_column", sql);
});

test("protected columns: allowed only as a join key against another column and inside COUNT(DISTINCT col); another table's column of the same name is fine", () => {
  for (const sql of [
    `SELECT COUNT(DISTINCT customer_id) AS customers FROM ${O}`,
    `SELECT channel, COUNT(DISTINCT o.customer_id) AS customers FROM ${O} o GROUP BY channel`,
    `SELECT channel, COUNT(*) AS n FROM ${O} o JOIN ${C} c ON c.customer_id = o.customer_id GROUP BY channel`,
    `SELECT channel, COUNT(*) AS n FROM ${O} o JOIN ${C} c ON o.customer_id = c.customer_id AND o.channel = 'email' GROUP BY channel`,
    `SELECT channel, COUNT(*) AS n FROM ${O} o JOIN ${C} c USING (customer_id) GROUP BY channel`,
    `SELECT channel, SUM(order_total) AS revenue FROM ${O} GROUP BY channel HAVING COUNT(DISTINCT customer_id) > 5`,
    `SELECT p.name, COUNT(*) AS n FROM ${P} p JOIN ${C} c ON true GROUP BY p.name`,
    `SELECT category, COUNT(*) AS n FROM ${P} GROUP BY category`,
    `SELECT * FROM ${P}`,
    `SELECT COUNT(*) AS n FROM ${C}`,
  ]) assert.equal(refusal(sql, shopWh, { policy: shopPolicy, protectedCols }), null, sql);
});

test("protected columns: refused in filters, conditions, CASE, LIKE, IN, functions, COUNTIF, bare COUNT and any comparison with a constant", () => {
  for (const sql of [
    // protected_in_where: a filter on a protected column narrows (or rebuilds) a value, so it is refused.
    `SELECT channel, COUNT(*) AS n FROM ${O} o JOIN ${C} c ON c.customer_id = o.customer_id WHERE c.email LIKE '%@example.com' GROUP BY channel`,
    `SELECT channel, COUNT(*) AS n FROM ${O} WHERE customer_id IN (SELECT customer_id FROM ${C} WHERE email IS NOT NULL) GROUP BY channel`,
    `SELECT channel, COUNT(*) AS n FROM ${O} WHERE customer_id = 'c-1' GROUP BY channel`,
    `SELECT channel, COUNT(*) AS n FROM ${O} WHERE customer_id IN ('c-1', 'c-2') GROUP BY channel`,
    `SELECT channel, COUNT(*) AS n FROM ${O} WHERE customer_id IS NULL GROUP BY channel`,
    `SELECT channel, COUNTIF(customer_id IS NULL) AS n FROM ${O} GROUP BY channel`,
    `SELECT COUNT(customer_id) AS n FROM ${O}`,
    `SELECT COUNT(DISTINCT LOWER(email)) AS n FROM ${C}`,
    `SELECT COUNT(DISTINCT email || 'x') AS n FROM ${C}`,
    `SELECT COUNT(CASE WHEN email LIKE 'a%' THEN 1 END) AS n FROM ${C}`,
    `SELECT SUM(LENGTH(email)) AS n FROM ${C}`,
    `SELECT channel, COUNT(*) AS n FROM ${O} o JOIN ${C} c ON c.email = 'a@b.example' GROUP BY channel`,
    `SELECT channel, COUNT(*) AS n FROM ${O} o JOIN ${C} c ON LOWER(c.email) = LOWER(o.channel) GROUP BY channel`,
    `SELECT channel, COUNT(*) AS n FROM ${O} o JOIN ${C} c ON c.customer_id = o.customer_id AND c.phone LIKE '+90%' GROUP BY channel`,
    `SELECT channel, COUNT(*) AS n FROM ${O} o JOIN ${C} c ON c.customer_id > o.customer_id GROUP BY channel`,
    `SELECT channel, SUM(order_total) AS r FROM ${O} GROUP BY channel HAVING MAX(customer_id) > 'm'`,
    `SELECT channel, COUNT(*) AS n FROM ${O} GROUP BY channel QUALIFY COUNT(customer_id) > 1`,
  ]) assert.equal(refusal(sql, shopWh, { policy: shopPolicy, protectedCols }), "sql_protected_column", sql);
});

test("protected columns: proposed by name and type; contact data, location detail and birth dates, never a product name or a pseudonymous id", () => {
  assert.deepEqual(proposeProtected("customers", [{ name: "customer_id", type: "STRING" }, { name: "email", type: "STRING" }, { name: "phone_number", type: "STRING" }, { name: "first_name", type: "STRING" }, { name: "name", type: "STRING" }, { name: "city", type: "STRING" }, { name: "created_at", type: "TIMESTAMP" }, { name: "ip_address", type: "STRING" }, { name: "postcode", type: "STRING" }]), ["email", "phone_number", "first_name", "name", "ip_address", "postcode"]);
  assert.deepEqual(proposeProtected("products", [{ name: "name", type: "STRING" }, { name: "category", type: "STRING" }]), []);
  assert.deepEqual(proposeProtected("orders", [{ name: "customer_id", type: "VARCHAR" }, { name: "order_total", type: "DECIMAL(18,2)" }, { name: "msisdn", type: "INT64" }]), ["msisdn"], "the type does not matter: a phone stored as a number is a phone; customer_id follows the default list (off)");
  assert.deepEqual(proposeProtected("events", [{ name: "user_pseudo_id", type: "STRING" }, { name: "device_id", type: "STRING" }, { name: "event_name", type: "STRING" }]), ["device_id"]);
  assert.deepEqual(proposeProtected("people", [{ name: "dob", type: "DATE" }, { name: "birth_date", type: "DATE" }, { name: "birthday", type: "DATE" }, { name: "zip", type: "STRING" }, { name: "zip_code", type: "INT64" }, { name: "lat", type: "FLOAT64" }, { name: "lng", type: "FLOAT64" }, { name: "lon", type: "FLOAT64" }, { name: "geom", type: "GEOGRAPHY" }, { name: "mobile", type: "STRING" }, { name: "address_line_1", type: "STRING" }, { name: "street", type: "STRING" }, { name: "state", type: "STRING" }, { name: "country", type: "STRING" }]),
    ["dob", "birth_date", "birthday", "zip", "zip_code", "lat", "lng", "lon", "geom", "mobile", "address_line_1", "street"]);
});

test("protected columns: compound and Turkish names are proposed (security review 2, H1); product, campaign and ad columns are not", () => {
  const names = (list) => list.map((name) => ({ name, type: "STRING" }));
  const reviewer = ["customer_email", "billing_email", "contact_phone", "phone_no", "msisdn", "customer_name", "client_ip", "email"];
  assert.deepEqual(proposeProtected("customers", names([...reviewer, "user_id", "customer_id"])), reviewer, "ids follow the default list");
  const more = ["customerEmail", "contactPhone", "e_mail", "mail", "tel", "gsm", "mobile_number", "first_name", "lastName", "surname", "full_name", "shipping_address", "street", "postcode", "zip_code", "ip_address", "birth_date", "dob", "national_id", "tckn", "tc_kimlik_no", "iban", "card_number", "credit_card"];
  assert.deepEqual(proposeProtected("orders", names(more)), more.map((n) => n.toLowerCase()));
  const turkish = ["ad", "soyad", "ad_soyad", "musteri_adi", "telefon", "cep_telefonu", "adres", "teslimat_adresi", "eposta", "e_posta", "dogum_tarihi", "posta_kodu"];
  assert.deepEqual(proposeProtected("musteriler", names(turkish)), turkish);
  const readable = ["product_name", "campaign_name", "ad_spend", "ad_id", "ad_name", "channel", "device", "order_total", "gift_card_amount", "city", "age", "gender", "user_id", "customer_id", "mobile_sessions"];
  assert.deepEqual(proposeProtected("orders", names(readable)), [], "not contact data on a table that is not about people");
});

test("protected columns: the default list (protection.yaml) decides ids, city, age and gender; all off as shipped", async () => {
  const { loadConfig } = await import("../src/config.js");
  assert.deepEqual(loadConfig({ env: {}, cwd: "/nonexistent" }).protection, { person_ids: false, city: false, age: false, gender: false });
  const on = { person_ids: true, city: true, age: true, gender: true };
  assert.deepEqual(proposeProtected("users", cols({ id: "INT64", city: "STRING", age: "INT64", gender: "STRING", traffic_source: "STRING" }), on), ["id", "city", "age", "gender"]);
  assert.deepEqual(proposeProtected("orders", cols({ order_id: "INT64", user_id: "INT64", customer_key: "STRING", user_pseudo_id: "STRING" }), on), ["user_id", "customer_key", "user_pseudo_id"]);
  assert.deepEqual(proposeProtected("orders", cols({ order_id: "INT64", user_id: "INT64" })), []);
});

test("a WITH name equal to an allowed table is refused in both dialects (security review 2, M2)", () => {
  for (const sql of [
    `WITH customers AS (SELECT 1 AS x) SELECT COUNT(*) AS n FROM ${C}`,
    `WITH a AS (SELECT COUNT(*) AS n FROM ${C}), customers AS (SELECT n FROM a) SELECT n FROM customers`,
    `WITH \`customers\` AS (SELECT 1 AS x) SELECT COUNT(*) AS n FROM ${C} JOIN customers ON true`,
  ]) assert.equal(refusal(sql, shopWh, { policy: shopPolicy, protectedCols }), "sql_table_not_allowed", sql);
  const duckPolicy = { allowed: ["daily_channel_device", "orders"], entries: [], match: (p) => (p.length === 1 && ["orders", "daily_channel_device"].includes(p[0].toLowerCase()) ? p[0].toLowerCase() : null) };
  for (const sql of ["WITH orders AS (SELECT 1 AS x) SELECT * FROM orders", "WITH x AS (SELECT * FROM orders), orders AS (SELECT * FROM x) SELECT * FROM orders", "WITH orders AS (SELECT * FROM orders) SELECT COUNT(*) AS n FROM orders"]) {
    assert.equal(refusal(sql, { table: "daily_channel_device", dialect: "duckdb" }, { policy: duckPolicy }), "sql_table_not_allowed", sql);
  }
});

// theLook eCommerce's real column lists (bigquery-public-data.thelook_ecommerce).
const cols = (types) => Object.entries(types).map(([name, type]) => ({ name, type }));
const THELOOK = {
  users: cols({ id: "INT64", first_name: "STRING", last_name: "STRING", email: "STRING", age: "INT64", gender: "STRING", state: "STRING", street_address: "STRING", postal_code: "STRING", city: "STRING", country: "STRING", latitude: "FLOAT64", longitude: "FLOAT64", traffic_source: "STRING", created_at: "TIMESTAMP", user_geom: "GEOGRAPHY" }),
  orders: cols({ order_id: "INT64", user_id: "INT64", status: "STRING", gender: "STRING", created_at: "TIMESTAMP", returned_at: "TIMESTAMP", shipped_at: "TIMESTAMP", delivered_at: "TIMESTAMP", num_of_item: "INT64" }),
  order_items: cols({ id: "INT64", order_id: "INT64", user_id: "INT64", product_id: "INT64", inventory_item_id: "INT64", status: "STRING", created_at: "TIMESTAMP", shipped_at: "TIMESTAMP", delivered_at: "TIMESTAMP", returned_at: "TIMESTAMP", sale_price: "FLOAT64" }),
  products: cols({ id: "INT64", cost: "FLOAT64", category: "STRING", name: "STRING", brand: "STRING", retail_price: "FLOAT64", department: "STRING", sku: "STRING", distribution_center_id: "INT64" }),
};

test("protected columns on theLook: users' contact data and location detail; ids, city, state and country stay readable", () => {
  const users = proposeProtected("users", THELOOK.users);
  assert.deepEqual(users, ["first_name", "last_name", "email", "street_address", "postal_code", "latitude", "longitude", "user_geom"]);
  for (const c of ["id", "city", "state", "country", "age", "gender", "traffic_source"]) assert.ok(!users.includes(c), `users.${c} stays readable`);
  assert.deepEqual(proposeProtected("orders", THELOOK.orders), [], "orders.user_id is a pseudonymous key");
  assert.deepEqual(proposeProtected("order_items", THELOOK.order_items), [], "order_items.id and user_id stay readable");
  assert.deepEqual(proposeProtected("products", THELOOK.products), [], "products.id and products.name stay readable");
});

// ---------------------------------------------------------------- the demo workspace: settings, env lock, describe

let ws;
before(async () => (ws = await demoWorkspace({ seed: true })));
after(() => ws.close());
const act = (name, input = {}, extra = {}) => callAction(name, input, ctxFor(ws, "person", extra));
const DEMO_ALL = [{ project: null, dataset: "demo", table: null }];

test("demo shop: totals agree with the mart by day, channel and device; lines add up to orders; invented ids, no names or contact data", async () => {
  const q = (sql) => ws.warehouse.query(sql);
  const [d] = await q(`SELECT COUNT(*) AS n FROM (
      SELECT m.date, m.channel, m.device, m.orders, m.revenue, COUNT(o.order_id) AS n, COALESCE(SUM(o.order_total), 0) AS total
      FROM daily_channel_device m LEFT JOIN orders o ON o.order_date = m.date AND o.channel = m.channel AND o.device = m.device
      GROUP BY ALL) x WHERE n <> orders OR total <> revenue`);
  assert.equal(Number(d.n), 0, "every day, channel and device: COUNT(orders) = orders, SUM(order_total) = revenue");
  const [t] = await q("SELECT (SELECT SUM(revenue) FROM daily_channel_device) AS mart, (SELECT SUM(order_total) FROM orders) AS orders, (SELECT SUM(line_total) FROM order_items) AS lines, (SELECT COUNT(*) FROM products) AS products");
  assert.equal(Number(t.mart), Number(t.orders));
  assert.equal(Number(t.orders), Number(t.lines));
  assert.equal(Number(t.products), 120);
  const [bad] = await q("SELECT COUNT(*) AS n FROM returns r JOIN order_items i USING (order_id, line_no) WHERE r.refund_amount > i.line_total OR r.return_date > DATE '2026-10-22'");
  assert.equal(Number(bad.n), 0);
  const cols = await q("SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('orders', 'order_items', 'products', 'returns')");
  const names = cols.map((c) => c.column_name);
  assert.ok(!names.some((n) => /^(email|phone|first_name|last_name|full_name|address|street|postcode|ip_address|birth_date)$/.test(n)), names.join(","));
  assert.deepEqual(cols.filter((c) => c.column_name === "name").map((c) => c.table_name), ["products"]);
  const [ids] = await q("SELECT COUNT(*) AS n FROM orders WHERE NOT regexp_full_match(customer_id, 'c_[0-9]{6}')");
  assert.equal(Number(ids.n), 0);
  // The same seed every time, and the generator matches what is in the file.
  const shop = generateShop();
  assert.equal(shop.orders.length, Number((await q("SELECT COUNT(*) AS n FROM orders"))[0].n));
  assert.equal(shop.orders.reduce((a, o) => a + o.order_total, 0), generateFacts().reduce((a, r) => a + r.revenue, 0));
  assert.equal(DEMO.seed, 20261023);
});

test("defaults: the mart alone; the settings view says so; the demo file's tables are listed", async () => {
  const s = await act("get_settings");
  assert.deepEqual(s.data_source.explore.allow, []);
  assert.deepEqual(s.data_source.explore.allow_setting, { source: "default", locked: false });
  assert.equal(s.data_source.explore.mart, "daily_channel_device");
  assert.equal(s.data_source.explore.max_bytes_per_question, 5 * 1024 ** 3);
  assert.deepEqual(s.data_source.explore.demo_tables, ["daily_channel_device", "order_items", "orders", "products", "returns"]);
  assert.deepEqual(policyFor(ws.config, ws.warehouse).allowed, ["daily_channel_device"]);
  const d = await act("describe_tables");
  assert.deepEqual(d.tables.map((t) => t.table), ["daily_channel_device"]);
  await assert.rejects(runExploreSql(ws, { sql: "SELECT COUNT(*) AS n FROM orders", measure: "other", dims: [], from: "2026-07-25", to: "2026-10-22", unit: "count" }), (e) => e.code === "sql_table_not_allowed");
});

test("set_explore_tables: adds the demo dataset (with size and table count), logs it, removes it; loopback only; the agent may not", async () => {
  const listing = await act("list_tables");
  assert.deepEqual(listing.datasets[0].tables.map((t) => t.table), ["order_items", "orders", "products", "returns"]);
  const s = await act("set_explore_tables", { allow: DEMO_ALL });
  assert.deepEqual(s.data_source.explore.allow.map((e) => [e.dataset, e.table, e.meta.tables]), [["demo", null, 4]]);
  assert.deepEqual(s.data_source.explore.allow_setting.source, "file");
  assert.deepEqual(JSON.parse(readFileSync(ws.config.configFile, "utf8")).explore.demoAllow.map((e) => e.dataset), ["demo"]);
  assert.match(ws.store.listActivity()[0].detail.en, /Allowed the agent to read the dataset demo/);
  assert.deepEqual(policyFor(ws.config, ws.warehouse).allowed.sort(), ["daily_channel_device", "order_items", "orders", "products", "returns"]);
  const one = await act("set_explore_tables", { allow: [{ project: null, dataset: "demo", table: "orders" }] });
  assert.deepEqual(one.data_source.explore.allow.map((e) => e.table), ["orders"]);
  assert.match(ws.store.listActivity()[0].detail.en, /Removed the dataset demo|Allowed the agent to read the table orders/);
  await assert.rejects(act("set_explore_tables", { allow: [{ project: null, dataset: "demo", table: "secret_table" }] }), (e) => e.code === "invalid_input");
  for (const [name, input] of [["list_tables", {}], ["set_explore_tables", { allow: [] }], ["set_protected_columns", { table: "orders", columns: [] }], ["set_table_description", { table: "orders", description: "x" }], ["describe_tables", {}]]) {
    await assert.rejects(act(name, input, { loopback: false }), (e) => e.code === "loopback_only", name);
  }
  await assert.rejects(callAction("set_explore_tables", { allow: [] }, ctxFor(ws, "agent")), (e) => e.code === "forbidden");
  const cap = await act("set_explore_tables", { max_bytes_per_question: 1024 ** 3 });
  assert.equal(cap.data_source.explore.max_bytes_per_question, 1024 ** 3);
  await act("set_explore_tables", { allow: DEMO_ALL });
});

test("describe_tables: columns, types, row counts, descriptions (built in and the person's), protected columns proposed; cached for 10 minutes", async () => {
  let calls = 0;
  const real = ws.warehouse.describe;
  ws.warehouse.describe = async (e) => (calls++, real(e));
  ws.warehouse.describeCache?.clear();
  const d = await act("describe_tables");
  assert.deepEqual(d.tables.map((t) => t.table).sort(), ["daily_channel_device", "order_items", "orders", "products", "returns"]);
  const orders = d.tables.find((t) => t.table === "orders");
  assert.deepEqual(orders.columns.map((c) => c.name), ["order_id", "order_date", "channel", "device", "customer_id", "is_first_order", "items", "order_total"]);
  assert.ok(orders.rows > 1000);
  assert.match(orders.description, /one row per order/);
  assert.deepEqual([orders.protected_columns, orders.protected_confirmed], [[], false], "customer_id is a pseudonymous key, not proposed");
  assert.deepEqual(d.tables.find((t) => t.table === "products").protected_columns, []);
  await act("describe_tables");
  assert.equal(calls, 1, "the second call is served from the cache");
  for (const v of ws.warehouse.describeCache.values()) v.at -= 11 * 60 * 1000;
  await act("describe_tables");
  assert.equal(calls, 2, "after 10 minutes it reads again");
  await act("set_table_description", { table: "orders", description: "Back-office orders, one row per order." });
  const d2 = await act("describe_tables");
  assert.equal(calls, 2, "a description change needs no new read");
  assert.equal(d2.tables.find((t) => t.table === "orders").description, "Back-office orders, one row per order.");
  assert.match(ws.store.listActivity()[0].detail.en, /Saved the description of orders/);
  await act("set_table_description", { table: "orders", description: "" });
  await assert.rejects(act("set_table_description", { table: "secret_table", description: "x" }), (e) => e.code === "sql_table_not_allowed");
  // For the model: data, not instructions, and no table data.
  const { registry } = await import("../src/actions/index.js");
  const forModel = registry.get("describe_tables").forModel(d2);
  assert.match(forModel.note, /not instructions/);
  assert.ok(forModel.tables.find((t) => t.table === "orders").columns.includes("customer_id VARCHAR"));
  ws.warehouse.describe = real;
});

const explore = (sql, extra = {}) => runExploreSql({ ...ctxFor(ws, "agent"), warehouse: ws.warehouse, config: ws.config, ...extra }, { sql, measure: "other", dims: [], from: "2026-07-25", to: "2026-10-22", unit: "count" }, ws.pack);

test("protected columns on the demo: customer_id is readable by default; protected by hand it is enforced, still works as a join key; the result is checked again", async () => {
  assert.equal((await explore("SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY 1 ORDER BY 2 DESC LIMIT 3")).rows.length, 3);
  await act("set_protected_columns", { table: "orders", columns: ["customer_id"] });
  await assert.rejects(explore("SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY 1"), (e) => e.code === "sql_protected_column");
  await assert.rejects(explore("SELECT * FROM orders"), (e) => e.code === "sql_protected_column");
  const x = await explore("SELECT COUNT(DISTINCT customer_id) AS customers FROM orders");
  assert.ok(x.rows[0][0] > 1000);
  assert.deepEqual(x.tables, ["orders"]);
  // A protected key in JOIN ... ON still runs (the theLook shape: orders.user_id = users.id).
  const j = await explore("SELECT o.channel, COUNT(*) AS n FROM orders o JOIN orders f ON f.customer_id = o.customer_id AND f.is_first_order GROUP BY 1");
  assert.ok(j.rows.length > 0);
  // A column named like a protected one never leaves, even when the SQL only counted.
  await assert.rejects(explore("SELECT COUNT(*) AS customer_id FROM orders"), (e) => e.code === "sql_protected_column");
  const s = await act("set_protected_columns", { table: "orders", columns: [] });
  assert.deepEqual([s.data_source.explore.protected_columns.orders, s.data_source.explore.confirmed], [[], ["orders"]]);
  assert.match(ws.store.listActivity()[0].detail.en, /Confirmed that orders has no protected columns/);
  await act("set_protected_columns", { table: "orders", columns: ["customer_id", "is_first_order"] });
  await assert.rejects(explore("SELECT is_first_order, COUNT(*) AS n FROM orders GROUP BY 1"), (e) => e.code === "sql_protected_column");
  await act("set_protected_columns", { table: "orders", columns: ["customer_id"] });
});

test("a cross-table question on the demo: describe_tables, one joined query, an exploratory card that lists the tables it read", async () => {
  const sql = "SELECT p.category, COUNT(r.return_id) * 1.0 / COUNT(*) AS return_rate FROM order_items i JOIN products p ON p.product_id = i.product_id LEFT JOIN returns r ON r.order_id = i.order_id AND r.line_no = i.line_no GROUP BY p.category ORDER BY return_rate DESC";
  const requests = [];
  const steps = [
    () => ({ content: [{ type: "tool_use", id: "d1", name: "describe_tables", input: {} }], stop_reason: "tool_use" }),
    (p) => {
      const r = JSON.parse(p.messages.at(-1).content[0].content);
      assert.ok(r.tables.some((t) => t.table === "returns"));
      return { content: [{ type: "tool_use", id: "x1", name: "run_sql", input: { sql, measure: "other", dims: ["other"], dim_labels: [{ en: "Category", tr: "Kategori" }], from: "2026-07-25", to: "2026-10-22", unit: "ratio", label: { en: "Return rate", tr: "İade oranı" } } }], stop_reason: "tool_use" };
    },
    (p) => {
      const r = JSON.parse(p.messages.at(-1).content[0].content);
      assert.deepEqual(r.tables.sort(), ["order_items", "products", "returns"]);
      assert.equal(r.rows[0][0], "shoes");
      return { content: [{ type: "tool_use", id: "x2", name: "publish_answer", input: { explore_id: r.explore_id, sentence: { en: "Shoes come back most often.", tr: "En sık ayakkabılar iade ediliyor." }, title: { en: "Return rate by category", tr: "Kategoriye göre iade oranı" } } }], stop_reason: "tool_use" };
    },
  ];
  const client = { beta: { messages: { stream(params) { requests.push(structuredClone(params)); const s = steps[requests.length - 1]; return { finalMessage: async () => (s ? s(params) : { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" }) }; } } } };
  const turn = await runTurn({ question: "Which product categories are returned most often?", lang: "en", conversationId: "new", app: { ...ws, modelClient: client } });
  assert.equal(turn.error, null);
  const [a] = turn.answers;
  assert.equal(a.kind, "explore");
  assert.deepEqual(a.explore.tables.sort(), ["order_items", "products", "returns"]);
  assert.deepEqual(a.explore.columns[0], { en: "Category", tr: "Kategori" });
  assert.match(requests[0].system[0].text, /call describe_tables/);
  assert.match(requests[0].system[0].text, /order_items/);
  assert.ok(requests[0].tools.some((t) => t.name === "describe_tables"));
  assert.match(turn.steps.find((s) => s.tool === "run_sql").summary.en, /on order_items, products, returns/);
  // The suggestion chip for it is on the demo when a model answers.
  const chips = await callAction("list_suggestions", {}, ctxFor({ ...ws, modelClient: client }));
  assert.ok(chips.some((c) => c.text.en === "Which product categories are returned most often?"));
});

test("AI_ANALYST_EXPLORE_ALLOW sets the list and locks it; protected columns stay editable; bad values stop the server", async () => {
  const locked = await demoWorkspace({ seed: false, env: { AI_ANALYST_EXPLORE_ALLOW: "demo.orders, demo.products" } });
  try {
    const s = await callAction("get_settings", {}, ctxFor(locked));
    assert.deepEqual(s.data_source.explore.allow_setting, { source: "env", locked: true, env: "AI_ANALYST_EXPLORE_ALLOW" });
    assert.deepEqual(s.data_source.explore.allow.map((e) => e.table), ["orders", "products"]);
    assert.deepEqual(policyFor(locked.config, locked.warehouse).allowed.sort(), ["daily_channel_device", "orders", "products"]);
    await assert.rejects(callAction("set_explore_tables", { allow: [] }, ctxFor(locked)), (e) => e.code === "locked" && e.params.env === "AI_ANALYST_EXPLORE_ALLOW");
    const p = await callAction("set_protected_columns", { table: "orders", columns: ["customer_id"] }, ctxFor(locked));
    assert.deepEqual(p.data_source.explore.confirmed, ["orders"]);
  } finally {
    locked.close();
  }
  assert.deepEqual(parseAllowEnv("example.com:shop-data.marts, ornek-data.shop.orders,demo"), [
    { project: "example.com:shop-data", dataset: "marts", table: null },
    { project: "ornek-data", dataset: "shop", table: "orders" },
    { project: null, dataset: "demo", table: null },
  ]);
  for (const bad of ["hr", "ornek-data", "ornek-data.shop.*", "demo.secret_table", "Ornek-Data.shop"]) assert.throws(() => loadConfig({ env: { AI_ANALYST_EXPLORE_ALLOW: bad }, cwd: "/nonexistent" }), /AI_ANALYST_EXPLORE_ALLOW/, bad);
});

test("BigQuery settings: a dataset in the mart's location is added with its size; another location is refused; describe reads INFORMATION_SCHEMA server-side, cached", async () => {
  const queries = [];
  const datasets = { ai_analyst: "EU", shop: "EU", us_shop: "US", hr: "EU" };
  const client = {
    async createQueryJob() {
      return [{ metadata: { statistics: { totalBytesProcessed: "10" } } }];
    },
    async query(o) {
      queries.push(o.query);
      if (/__TABLES__/.test(o.query)) return [[{ table_id: "orders", row_count: "1200", size_bytes: "52000", last_modified_time: "1793000000000" }, { table_id: "customers", row_count: "300", size_bytes: "9000", last_modified_time: "1793100000000" }]];
      if (/INFORMATION_SCHEMA\.COLUMNS/.test(o.query)) return [[{ table_name: "orders", column_name: "order_date", data_type: "DATE", is_partitioning_column: "YES" }, { table_name: "orders", column_name: "customer_id", data_type: "STRING", is_partitioning_column: "NO" }, { table_name: "customers", column_name: "email", data_type: "STRING", is_partitioning_column: "NO", description: "Contact email" }]];
      if (/INFORMATION_SCHEMA\.TABLES/.test(o.query)) return [[{ table_name: "orders", table_type: "BASE TABLE" }, { table_name: "customers", table_type: "BASE TABLE" }]];
      return [[{ data_from: "2026-01-01", data_to: "2026-10-22", n: 10 }]];
    },
    async getDatasets() {
      return [Object.keys(datasets).map((id) => ({ id, getMetadata: async () => [{ location: datasets[id] }] }))];
    },
  };
  const bq = await demoWorkspace({ seed: false, env: { AI_ANALYST_WAREHOUSE: "bigquery", BIGQUERY_PROJECT: "ornek-data", BIGQUERY_DATASET: "ai_analyst", BIGQUERY_LOCATION: "EU" }, bigQueryClient: client });
  try {
    const listing = await callAction("list_tables", {}, ctxFor(bq));
    assert.deepEqual(listing.datasets.map((d) => [d.dataset, d.same_location]), [["ai_analyst", true], ["shop", true], ["us_shop", false], ["hr", true]]);
    await assert.rejects(callAction("set_explore_tables", { allow: [{ project: "ornek-data", dataset: "us_shop", table: null }] }, ctxFor(bq)), (e) => e.code === "sql_location_mismatch" && e.params.location === "US");
    await assert.rejects(callAction("set_explore_tables", { allow: [{ project: "ornek-data", dataset: "nowhere", table: null }] }, ctxFor(bq)), (e) => e.code === "invalid_input");
    const s = await callAction("set_explore_tables", { allow: [{ project: "ornek-data", dataset: "shop", table: null }] }, ctxFor(bq));
    assert.deepEqual(s.data_source.explore.allow[0].meta, { tables: 2, rows: 1500, bytes: 61000, modified: new Date(1793100000000).toISOString(), location: "EU" });
    assert.equal(s.data_source.explore.mart, "ornek-data.ai_analyst.daily_channel_device");
    queries.length = 0;
    const d = await callAction("describe_tables", {}, ctxFor(bq, "agent"));
    assert.ok(queries.every((q) => /INFORMATION_SCHEMA|__TABLES__/.test(q)), "only the catalogue is read");
    assert.ok(queries.some((q) => q.includes("`ornek-data.shop`.INFORMATION_SCHEMA.COLUMNS")));
    const orders = d.tables.find((t) => t.table === "ornek-data.shop.orders");
    assert.deepEqual([orders.partitioned_by, orders.rows, orders.protected_columns], ["order_date", 1200, []]);
    assert.deepEqual(d.tables.find((t) => t.table === "ornek-data.shop.customers").protected_columns, ["email"]);
    const n = queries.length;
    await callAction("describe_tables", {}, ctxFor(bq, "agent"));
    assert.equal(queries.length, n, "cached");
    // The model's own INFORMATION_SCHEMA query is refused by the guard.
    await assert.rejects(runExploreSql({ ...ctxFor(bq, "agent"), warehouse: bq.warehouse, config: bq.config }, { sql: "SELECT * FROM `ornek-data.shop`.INFORMATION_SCHEMA.COLUMNS", measure: "other", dims: [], from: "2026-01-01", to: "2026-01-02", unit: "count" }), (e) => e.code === "sql_forbidden_keyword");
  } finally {
    bq.close();
  }
});

test("test_bigquery: the step 'can read the allowed tables', and a warning when the credential sees more datasets than the list", async () => {
  const bq = await demoWorkspace({ seed: false, env: { AI_ANALYST_EXPLORE_ALLOW: "ornek-data.shop" } });
  try {
    const { writeFileSync } = await import("node:fs");
    const key = path.join(bq.dir, "sa.json");
    writeFileSync(key, JSON.stringify({ type: "service_account", client_email: "reader@ornek-data.iam.gserviceaccount.com" }));
    const values = { data_project: "ornek-data", job_project: null, dataset: "ai_analyst", location: null, auth: { kind: "key_file", path: key }, max_bytes: 512 * 1024 ** 2 };
    const base = { identity: async () => "reader@ornek-data.iam.gserviceaccount.com", canRunJobs: async () => {}, dataset: async () => ({ location: "EU" }), table: async () => ({ columns: ["date", "channel", "device", "sessions", "orders", "revenue", "ga4_purchases", "ga4_revenue", "platform_conversions", "ad_spend"], modified: null }), read: async () => ({ from: "2026-01-01", to: "2026-10-22", rows: 3 }), cost: async () => 1024 };
    let seen = null;
    bq.bigQueryTester = async () => ({ ...base, allowed: async (entries, loc) => (seen = [entries.map((e) => e.dataset), loc]), visibleDatasets: async () => ["ornek-data.ai_analyst", "ornek-data.shop", "ornek-data.hr", "ornek-data.finance"] });
    const t = await callAction("test_bigquery", values, ctxFor(bq));
    assert.deepEqual(t.steps.map((s) => [s.id, s.status]), [["credentials", "ok"], ["jobs", "ok"], ["dataset", "ok"], ["table", "ok"], ["read", "ok"], ["allowed", "ok"], ["cost", "ok"]]);
    assert.deepEqual(seen, [["shop"], "EU"]);
    assert.deepEqual(t.warnings, [{ code: "credential_broader", params: { n: 2, datasets: "ornek-data.hr, ornek-data.finance" } }]);
    bq.bigQueryTester = async () => ({ ...base, allowed: async () => { throw Object.assign(new Error("Access Denied: Dataset ornek-data:shop"), { code: 403 }); } });
    const t2 = await callAction("test_bigquery", values, ctxFor(bq));
    assert.deepEqual([t2.ok, t2.steps[5].status, t2.steps[5].error.code, t2.steps[5].error.params.table, t2.steps[6].status], [false, "failed", "allowed_denied", "ornek-data.shop", "skipped"]);
    bq.bigQueryTester = async () => ({ ...base, allowed: async () => { throw Object.assign(new Error("location"), { location_mismatch: true, location: "US", entry: { project: "ornek-data", dataset: "shop", table: null } }); } });
    const t3 = await callAction("test_bigquery", values, ctxFor(bq));
    assert.deepEqual([t3.steps[5].error.code, t3.steps[5].error.params.loc], ["allowed_location", "US"]);
  } finally {
    bq.close();
  }
});

test("DuckDB errors on exploratory queries never pass their text on: a fixed sentence per kind (security review 2, M1)", async () => {
  const { duckExploreError } = await import("../src/warehouse/duckdb.js");
  const logs = [];
  const errLog = console.error;
  console.error = (...a) => logs.push(a.join(" "));
  try {
    const e = duckExploreError(new Error('Conversion Error: Could not convert string "jane@shop.example" to INT32\nLINE 1: …'));
    assert.deepEqual([e.code, e.params.kind], ["explore_sql_error", "values"]);
    assert.doesNotMatch(e.message, /jane/);
    assert.equal(duckExploreError(new Error("Binder Error: Referenced column \"emial\" not found")).params.kind, "names");
    assert.equal(duckExploreError(new Error("Parser Error: syntax error at or near \"FORM\"")).params.kind, "syntax");
    assert.equal(duckExploreError(new Error("Something else entirely: secret 42")).params.kind, "other");
    // Through the real explore path on the demo.
    await assert.rejects(explore("SELECT CAST(channel AS INTEGER) AS n FROM orders"), (x) => x.code === "explore_sql_error" && !/organic|email|direct/.test(x.message));
  } finally {
    console.error = errLog;
  }
  assert.ok(!logs.join("\n").match(/jane|secret 42|organic/), "nor in the log");
});

test("the per-question bytes cap counts the dry run before the run, a failed run included, and has a ceiling (security review 2, M4)", async () => {
  const seen = [];
  const client = { ...bqClient({ refs: [ref("orders")] }), async query() { throw new Error("job failed after billing"); } };
  const wh = await openBigQuery(bqCfg, { client });
  const errLog = console.error;
  console.error = () => {};
  try {
    await assert.rejects(wh.explore("SELECT 1", { policy: bqTwo, onBytes: (b) => seen.push(b) }), (e) => e.code === "explore_sql_error");
  } finally {
    console.error = errLog;
  }
  assert.deepEqual(seen, [100], "counted although the run failed");
  await assert.rejects(act("set_explore_tables", { max_bytes_per_question: 10 * ws.config.bigquery.ceiling + 1 }), (e) => e.code === "over_ceiling");
});

test("exploratory results are kept for 30 days in app.db (security review 2, L2)", () => {
  ws.store.put("queries", { id: "x_old", created_at: "2020-01-01T00:00:00.000Z", explore: { rows: [] } }, { kind: "explore" });
  ws.store.put("queries", { id: "x_new", created_at: new Date().toISOString(), explore: { rows: [] } }, { kind: "explore" });
  assert.equal(ws.store.pruneExplore(30), 1);
  assert.equal(ws.store.get("queries", "x_old"), null);
  assert.ok(ws.store.get("queries", "x_new"));
});

test("protected columns inside a parenthesised join are checked like any other (security review 2, V1), on both dialects", () => {
  const duckPolicy = { allowed: ["daily_channel_device", "orders", "customers"], entries: [], match: (p) => (p.length === 1 && ["orders", "customers", "daily_channel_device"].includes(p[0].toLowerCase()) ? p[0].toLowerCase() : null) };
  const duckProt = (k) => (k === "customers" ? new Set(["email", "customer_id"]) : k === "orders" ? new Set(["customer_id"]) : new Set());
  const duck = { table: "daily_channel_device", dialect: "duckdb" };
  const forms = (c, o) => [
    `SELECT COUNT(*) AS n FROM (${o} o JOIN ${c} c ON c.customer_id = o.customer_id AND c.email LIKE 'a%')`,
    `SELECT COUNT(*) AS n FROM (${o} o JOIN ${c} c ON LOWER(c.email) = o.channel)`,
    `SELECT COUNT(*) AS n FROM (${o} o JOIN ${c} c ON c.email = 'a@b.example')`,
    `SELECT COUNT(*) AS n FROM ((${o} o JOIN ${c} c ON c.customer_id = o.customer_id) JOIN ${c} d ON d.email LIKE '%x')`,
  ];
  for (const sql of forms(C, O)) assert.equal(refusal(sql, shopWh, { policy: shopPolicy, protectedCols }), "sql_protected_column", sql);
  for (const sql of forms("customers", "orders")) assert.equal(refusal(sql, duck, { policy: duckPolicy, protectedCols: duckProt }), "sql_protected_column", sql);
  // The plain key in a parenthesised join still works.
  assert.equal(refusal(`SELECT COUNT(*) AS n FROM (${O} o JOIN ${C} c ON c.customer_id = o.customer_id)`, shopWh, { policy: shopPolicy, protectedCols }), null);
  assert.equal(refusal("SELECT COUNT(*) AS n FROM (orders o JOIN customers c ON c.customer_id = o.customer_id)", duck, { policy: duckPolicy, protectedCols: duckProt }), null);
});

test("a protected join key may only meet a column of an allowed base table, never a CTE's or a derived table's (security review 2, V2)", () => {
  for (const sql of [
    `WITH guess AS (SELECT 'a@b.example' AS e) SELECT COUNT(*) AS n FROM ${C} c JOIN guess g ON c.email = g.e`,
    `WITH guess AS (SELECT 'a@b.example' AS e) SELECT COUNT(*) AS n FROM ${C} c JOIN guess ON c.email = guess.e`,
    `SELECT COUNT(*) AS n FROM ${C} c JOIN (SELECT 'a@b.example' AS e) g ON g.e = c.email`,
    `SELECT COUNT(*) AS n FROM ${C} c JOIN (SELECT 'a@b.example' AS email) g USING (email)`,
    `SELECT COUNT(*) AS n FROM ${C} c JOIN ${O} o ON c.customer_id = customer_id`, // the other side unqualified
  ]) assert.equal(refusal(sql, shopWh, { policy: shopPolicy, protectedCols }), "sql_protected_column", sql);
  assert.equal(refusal(`SELECT COUNT(*) AS n FROM ${C} c JOIN ${O} o ON o.customer_id = c.customer_id`, shopWh, { policy: shopPolicy, protectedCols }), null);
  assert.equal(refusal(`SELECT COUNT(*) AS n FROM ${C} c JOIN ${O} o USING (customer_id)`, shopWh, { policy: shopPolicy, protectedCols }), null);
});

test("a query that uses a protected column cannot contain a CTE or a subquery, on both dialects (security review 2, V2-a, V2-b)", () => {
  const duckPolicy = { allowed: ["daily_channel_device", "orders", "customers"], entries: [], match: (p) => (p.length === 1 && ["orders", "customers", "daily_channel_device"].includes(p[0].toLowerCase()) ? p[0].toLowerCase() : null) };
  const duckProt = (k) => (k === "customers" ? new Set(["email", "customer_id"]) : k === "orders" ? new Set(["customer_id"]) : new Set());
  const duck = { table: "daily_channel_device", dialect: "duckdb" };
  const forms = (c, o) => [
    `SELECT COUNT(*) AS n FROM ${c} JOIN (SELECT 'a@b.example' AS email) USING (email)`, // V2-a: an unaliased subquery
    `SELECT COUNT(*) AS n FROM ${o} o CROSS JOIN ((SELECT 'a@b.example' AS email)) o JOIN ${c} c ON c.email = o.email`, // V2-b: a double-parenthesised subquery reusing a base table's alias
    `WITH k AS (SELECT 1 AS one) SELECT COUNT(DISTINCT c.email) AS n FROM ${c} c`, // a CTE beside COUNT(DISTINCT)
    `SELECT COUNT(*) AS n FROM ${o} o JOIN ${c} c ON c.customer_id = o.customer_id WHERE o.channel IN (SELECT channel FROM ${o})`, // a subquery elsewhere
  ];
  for (const sql of forms(C, O)) assert.equal(refusal(sql, shopWh, { policy: shopPolicy, protectedCols }), "sql_protected_column", sql);
  for (const sql of forms("customers", "orders")) assert.equal(refusal(sql, duck, { policy: duckPolicy, protectedCols: duckProt }), "sql_protected_column", sql);
  // Without a protected column, CTEs and subqueries are fine; with one, the flat forms still pass.
  assert.equal(refusal(`WITH k AS (SELECT channel FROM ${O}) SELECT COUNT(*) AS n FROM k`, shopWh, { policy: shopPolicy, protectedCols }), null);
  assert.equal(refusal("SELECT COUNT(DISTINCT c.email) AS n FROM customers c JOIN orders o ON o.customer_id = c.customer_id", duck, { policy: duckPolicy, protectedCols: duckProt }), null);
});
