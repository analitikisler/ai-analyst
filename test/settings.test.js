// Settings and secrets: keys go to <data_dir>/secrets.json with mode 0600 and never come back; env vars win and
// lock the field; the data source, the bytes cap and the provider are written to ai-analyst.config.json.
// Every outside system is stubbed: the Anthropic client, fetch, and the BigQuery checks.
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { callAction } from "../src/actions/index.js";
import { buildState } from "../src/state.js";
import { ctxFor, demoWorkspace } from "./helpers.js";

const KEY = "sk-ant-test-0000000000000000wxyz";
let ws;
const created = [];
const anthropicCalls = [];
function anthropicFactory({ apiKey }) {
  return {
    messages: {
      async create(params) {
        anthropicCalls.push({ apiKey, params });
        if (apiKey !== KEY) throw new Anthropic.AuthenticationError(401, { type: "error" }, "invalid x-api-key", new Headers());
        if (params.model === "claude-nope") throw new Anthropic.NotFoundError(404, { type: "error" }, "model", new Headers());
        return { content: [{ type: "text", text: "OK" }] };
      },
    },
  };
}
const fakeBigQuery = () => ({ async createQueryJob() { return [{ metadata: { statistics: { totalBytesProcessed: "0" } } }]; }, async query() { return [[]]; } });

before(async () => {
  ws = await demoWorkspace({ seed: true, anthropicFactory, bigQueryClient: fakeBigQuery() });
  created.push(ws);
});
after(() => created.forEach((w) => w.close()));

const act = (name, input = {}, app = ws) => callAction(name, input, ctxFor(app));

test("save_model_key: tested first, the key in secrets.json with mode 0600, only a hint comes back", async () => {
  const s = await act("save_model_key", { provider: "anthropic", key: KEY, model: "claude-opus-5-5" });
  const file = path.join(ws.config.dataDir, "secrets.json");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).providers.anthropic.key, KEY);
  assert.ok(!JSON.stringify(s).includes(KEY), "the key is never returned");
  assert.ok(!readFileSync(ws.config.configFile, "utf8").includes(KEY), "nor written to the config file");
  const p = s.model.providers.find((x) => x.id === "anthropic");
  assert.deepEqual([p.set, p.source, p.locked, p.hint, p.model, p.last_test.ok], [true, "saved", false, "…wxyz", "claude-opus-5-5", true]);
  assert.equal(s.model.provider.value, "anthropic");
  assert.equal(anthropicCalls.at(-1).params.max_tokens, 64, "one small call");
  const state = await buildState(ws);
  assert.deepEqual([state.agent.mode, state.agent.provider, state.agent.model_label], ["model", "anthropic", "Claude Opus 5.5"]);
  assert.ok(!JSON.stringify(await act("get_settings")).includes(KEY));
});

test("test_model_key maps a refused key and an unknown model; a failed test saves nothing", async () => {
  assert.deepEqual(await act("test_model_key", { provider: "anthropic", key: "sk-ant-wrong-000000000000", model: "claude-opus-5-5" }), { ok: false, provider: "anthropic", model: "claude-opus-5-5", error: { code: "key_rejected", status: 401 } });
  assert.equal((await act("test_model_key", { provider: "anthropic", model: "claude-nope" })).error.code, "model_not_found", "without a key the saved one is tested");
  await assert.rejects(act("save_model_key", { provider: "anthropic", key: "sk-ant-wrong-000000000000", model: "claude-opus-5-5" }), (e) => e.code === "key_rejected");
  assert.equal(JSON.parse(readFileSync(path.join(ws.config.dataDir, "secrets.json"), "utf8")).providers.anthropic.key, KEY);
});

test("OpenAI-compatible keys are tested with one chat completion against the base URL", async () => {
  const seen = [];
  const app = { ...ws, fetch: async (url, init) => (seen.push([url, init.headers.Authorization]), { ok: url.startsWith("http://127.0.0.1"), status: url.startsWith("http://127.0.0.1") ? 200 : 404 }) };
  assert.equal((await act("test_model_key", { provider: "openai_compatible", key: "k-000000000000", model: "llama3", base_url: "http://127.0.0.1:11434/v1" }, app)).ok, true);
  assert.deepEqual(seen[0], ["http://127.0.0.1:11434/v1/chat/completions", "Bearer k-000000000000"]);
  await assert.rejects(act("test_model_key", { provider: "openai_compatible", model: "llama3", base_url: "not a url" }, app), (e) => e.code === "invalid_base_url");
  assert.equal((await act("test_model_key", { provider: "openai", key: "sk-000000000000", model: "gpt-5.5" }, app)).error.code, "model_not_found");
  assert.equal(seen.at(-1)[0], "https://api.openai.com/v1/chat/completions");
});

test("a saved or env key only goes to its own base URL; http only to this machine; never to metadata addresses", async () => {
  const seen = [];
  const fetchStub = async (url, init) => (seen.push([url, init.headers.Authorization]), { ok: true, status: 200 });
  const app = await demoWorkspace({ seed: false, fetch: fetchStub });
  created.push(app);
  await act("save_model_key", { provider: "openai_compatible", key: "saved-key-0000000000", model: "llama3", base_url: "http://127.0.0.1:11434/v1" }, app);
  seen.length = 0;
  // The saved key may be tested against the saved URL…
  assert.equal((await act("test_model_key", { provider: "openai_compatible", model: "llama3" }, app)).ok, true);
  assert.deepEqual(seen.at(-1), ["http://127.0.0.1:11434/v1/chat/completions", "Bearer saved-key-0000000000"]);
  // …but never sent to a URL given in the request.
  await assert.rejects(act("test_model_key", { provider: "openai_compatible", model: "llama3", base_url: "https://evil.example/v1" }, app), (e) => e.code === "key_required");
  assert.equal(seen.length, 1, "nothing was sent");
  // A new URL with its own key is fine over https; plain http only to loopback; metadata never.
  assert.equal((await act("test_model_key", { provider: "openai_compatible", key: "other-key-000000", model: "m", base_url: "https://openrouter.ai/api/v1" }, app)).ok, true);
  for (const base_url of ["http://192.168.1.20:11434/v1", "http://evil.example/v1", "https://169.254.169.254/latest", "http://169.254.169.254/latest", "https://metadata.google.internal/v1", "ftp://x/v1", "https://user:pw@x.example/v1"]) {
    await assert.rejects(act("test_model_key", { provider: "openai_compatible", key: "k-000000000000", model: "m", base_url }, app), (e) => e.code === "invalid_base_url", base_url);
  }
  // A base URL locked by the environment cannot be changed here, even with a key.
  const locked = await demoWorkspace({ seed: false, fetch: fetchStub, env: { AI_ANALYST_OPENAI_COMPATIBLE_URL: "http://127.0.0.1:11434/v1", AI_ANALYST_OPENAI_COMPATIBLE_KEY: "env-key-00000000000" } });
  created.push(locked);
  await assert.rejects(act("test_model_key", { provider: "openai_compatible", key: "k-000000000000", model: "m", base_url: "https://evil.example/v1" }, locked), (e) => e.code === "locked");
  seen.length = 0;
  assert.equal((await act("test_model_key", { provider: "openai_compatible", model: "m" }, locked)).ok, true);
  assert.deepEqual(seen[0], ["http://127.0.0.1:11434/v1/chat/completions", "Bearer env-key-00000000000"]);
});

test("set_model_provider and remove_model_key: back to the planner, the key deleted from the file", async () => {
  await assert.rejects(act("set_model_provider", { provider: "openai" }), (e) => e.code === "invalid_input");
  assert.equal((await act("set_model_provider", { provider: "planner" })).model.provider.value, "planner");
  assert.equal((await buildState(ws)).agent.mode, "planner");
  await act("set_model_provider", { provider: "anthropic" });
  const s = await act("remove_model_key", { provider: "anthropic" });
  assert.equal(s.model.provider.value, "planner");
  assert.equal(JSON.parse(readFileSync(path.join(ws.config.dataDir, "secrets.json"), "utf8")).providers.anthropic, undefined);
});

test("an env var wins and locks: a key in ANTHROPIC_API_KEY cannot be replaced or removed here", async () => {
  const envKey = "sk-ant-from-env-0000000000abcd";
  const app = await demoWorkspace({ seed: false, env: { ANTHROPIC_API_KEY: envKey, BIGQUERY_MAX_BYTES: String(1024 ** 3) }, anthropicFactory });
  created.push(app);
  const s = await act("get_settings", {}, app);
  const p = s.model.providers.find((x) => x.id === "anthropic");
  assert.deepEqual([p.source, p.locked, p.env, p.hint], ["env", true, "ANTHROPIC_API_KEY", "…abcd"]);
  assert.equal(s.model.provider.source, "detected");
  await assert.rejects(act("save_model_key", { provider: "anthropic", key: KEY, model: "claude-opus-5-5" }, app), (e) => e.code === "locked");
  await assert.rejects(act("remove_model_key", { provider: "anthropic" }, app), (e) => e.code === "locked");
  await assert.rejects(act("set_bytes_cap", { max_bytes: 1000 }, app), (e) => e.code === "locked");
  assert.deepEqual([s.data_source.max_bytes.value, s.data_source.max_bytes.locked], [1024 ** 3, true]);
  assert.ok(!JSON.stringify(s).includes(envKey));
});

test("set_bytes_cap lowers the cap in the config file and never raises it past the ceiling", async () => {
  await assert.rejects(act("set_bytes_cap", { max_bytes: 3 * 1024 ** 3 }), (e) => e.code === "over_ceiling");
  await assert.rejects(act("set_bytes_cap", { max_bytes: 0 }), (e) => e.code === "invalid_input");
  const s = await act("set_bytes_cap", { max_bytes: 512 * 1024 ** 2 });
  assert.deepEqual([s.data_source.max_bytes.value, s.data_source.max_bytes.source], [512 * 1024 ** 2, "file"]);
  assert.equal(JSON.parse(readFileSync(ws.config.configFile, "utf8")).bigquery.maxBytes, 512 * 1024 ** 2);
  assert.deepEqual(ws.store.listActivity(1)[0].detail, { en: "Lowered the bytes cap to 512 MB", tr: "Bayt sınırı 512 MB olarak düşürüldü" });
});

const keyFile = (dir) => {
  const f = path.join(dir, "sa.json");
  writeFileSync(f, JSON.stringify({ type: "service_account", client_email: "reader@p.iam.gserviceaccount.com" }));
  return f;
};
const testerOk = { identity: async () => "reader@ornek-data.iam.gserviceaccount.com", canRunJobs: async () => {}, dataset: async () => ({ location: "EU" }), table: async () => ({ columns: ["date", "channel", "device", "sessions", "orders", "revenue", "ga4_purchases", "ga4_revenue", "platform_conversions", "ad_spend"], modified: "2026-10-23T03:00:00.000Z" }), read: async () => ({ from: "2026-01-01", to: "2026-10-22", rows: 3540 }), cost: async () => 4.1 * 1024 ** 2 };

test("test_bigquery: six steps against stubbed BigQuery; a failing step skips the rest; then the source switches", async () => {
  const values = { data_project: "ornek-data", job_project: "ornek-jobs", dataset: "ai_analyst", location: null, auth: { kind: "key_file", path: keyFile(ws.dir) }, max_bytes: 512 * 1024 ** 2 };
  const notKey = path.join(ws.dir, "x.json");
  writeFileSync(notKey, "{}");
  const t0 = await act("test_bigquery", { ...values, auth: { kind: "key_file", path: notKey } });
  assert.deepEqual(t0.steps.map((s) => [s.id, s.status]), [["credentials", "failed"], ["jobs", "skipped"], ["dataset", "skipped"], ["table", "skipped"], ["read", "skipped"], ["cost", "skipped"]]);
  assert.equal(t0.steps[0].error.code, "keyfile_type");
  ws.bigQueryTester = async () => ({ ...testerOk, canRunJobs: async () => { throw new Error("403 Access Denied"); } });
  const t1 = await act("test_bigquery", values);
  assert.deepEqual([t1.steps[1].status, t1.steps[1].error.code, t1.steps[1].error.params.p], ["failed", "no_jobs", "ornek-jobs"]);
  await assert.rejects(act("save_data_source", { kind: "bigquery", test_id: t1.test_id }), (e) => e.code === "test_required");
  ws.bigQueryTester = async () => testerOk;
  const t2 = await act("test_bigquery", values);
  assert.equal(t2.ok, true);
  assert.deepEqual(t2.detected, { location: "EU" });
  assert.deepEqual(t2.steps.map((s) => s.status), ["ok", "ok", "ok", "ok", "ok", "ok"]);
  const s = await act("save_data_source", { kind: "bigquery", test_id: t2.test_id });
  assert.deepEqual([s.data_source.kind.value, s.data_source.bigquery.data_project, s.data_source.bigquery.location], ["bigquery", "ornek-data", "EU"]);
  const file = JSON.parse(readFileSync(ws.config.configFile, "utf8"));
  assert.deepEqual([file.warehouse, file.bigquery.project, file.bigquery.jobProject, file.bigquery.auth.kind], ["bigquery", "ornek-data", "ornek-jobs", "key_file"]);
  assert.equal(ws.warehouse.demo, false);
  assert.equal(ws.warehouse.table, "`ornek-data.ai_analyst.daily_channel_device`");
  const back = await act("save_data_source", { kind: "demo" });
  assert.equal(back.data_source.kind.value, "demo");
  assert.equal(ws.warehouse.demo, true);
  assert.equal((await buildState(ws)).checks.length, 4);
});

test("settings changes are refused unless the request comes from this machine", async () => {
  for (const [name, input] of [["save_model_key", { provider: "anthropic", key: KEY, model: "m" }], ["set_bytes_cap", { max_bytes: 1 }], ["save_data_source", { kind: "demo" }], ["rebuild_demo", {}], ["test_bigquery", { data_project: "a", job_project: null, dataset: "d", location: null, auth: { kind: "adc" }, max_bytes: 1 }], ["test_model_key", { provider: "openai", model: "x" }]]) {
    await assert.rejects(callAction(name, input, ctxFor(ws, "person", { loopback: false })), (e) => e.code === "loopback_only", name);
  }
});

test("rebuild_demo rebuilds the mart and the workspace, keeping preferences", async () => {
  await act("set_preference", { key: "make_it_yours", value: "hidden" });
  await act("create_dashboard", { name: "Temporary" });
  await act("rebuild_demo");
  assert.deepEqual((await act("list_dashboards")).map((d) => d.id), ["db_example"]);
  assert.equal((await buildState(ws)).preferences.make_it_yours, "hidden");
  assert.ok(existsSync(path.join(ws.config.dataDir, "demo.duckdb")));
  assert.equal((await act("run_query", { metric: "orders", from: "2026-10-09", to: "2026-10-22" })).total, 2753);
});
