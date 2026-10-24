// AI_ANALYST_NO_CLOUD=1 (set for every test by test/setup.js): every real outbound path refuses with no_cloud
// before anything is sent: the BigQuery client and tester, the Anthropic client, the OpenAI-compatible fetch.
import "./setup.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { callAction } from "../src/actions/index.js";
import { runTurn } from "../src/agent/agent.js";
import { openAiAdapter } from "../src/agent/providers.js";
import { noCloud } from "../src/cloud.js";
import { bigQueryClient, openBigQuery } from "../src/warehouse/bigquery.js";
import { ctxFor, demoWorkspace } from "./helpers.js";

const open = [];
after(() => open.forEach((w) => w.close()));
const isNoCloud = (e) => e.code === "no_cloud" && /AI_ANALYST_NO_CLOUD/.test(e.message);
const cfg = { project: "ornek-data", jobProject: "ornek-jobs", dataset: "ai_analyst", location: "EU", maxBytes: 1024 };

test("the switch: on for tests, off only when unset or 0", () => {
  assert.equal(noCloud(), true);
  assert.equal(noCloud({ AI_ANALYST_NO_CLOUD: "0" }), false);
  assert.equal(noCloud({}), false);
});

test("BigQuery: the client factory and a warehouse without an injected client refuse", async () => {
  await assert.rejects(bigQueryClient(cfg), isNoCloud);
  await assert.rejects(openBigQuery(cfg), isNoCloud);
});

test("test_bigquery with the real tester refuses before any step reaches Google", async () => {
  const ws = await demoWorkspace({ seed: false });
  open.push(ws);
  const key = path.join(ws.dir, "sa.json");
  writeFileSync(key, JSON.stringify({ type: "service_account", client_email: "x@y.iam.gserviceaccount.com" }));
  await assert.rejects(callAction("test_bigquery", { data_project: "invented-data", job_project: "invented-jobs", dataset: "nope", location: null, auth: { kind: "key_file", path: key }, max_bytes: 1024 }, ctxFor(ws)), isNoCloud);
});

test("model key tests refuse without a stub: Anthropic and the OpenAI-compatible fetch", async () => {
  const ws = await demoWorkspace({ seed: false });
  open.push(ws);
  await assert.rejects(callAction("test_model_key", { provider: "anthropic", key: "sk-ant-real-looking-0000000000", model: "claude-opus-5-5" }, ctxFor(ws)), isNoCloud);
  await assert.rejects(callAction("test_model_key", { provider: "openai", key: "sk-000000000000", model: "gpt-5.5" }, ctxFor(ws)), isNoCloud);
  await assert.rejects(callAction("test_model_key", { provider: "openai_compatible", model: "llama3", base_url: "http://127.0.0.1:11434/v1" }, ctxFor(ws)), isNoCloud);
});

test("model turns refuse without a stub: an Anthropic key and an OpenAI key in the environment", async () => {
  for (const env of [{ ANTHROPIC_API_KEY: "sk-ant-real-looking-0000000000" }, { OPENAI_API_KEY: "sk-real-looking-000000000" }, { GEMINI_API_KEY: "AIza-real-looking-0000" }]) {
    const ws = await demoWorkspace({ seed: false, env });
    open.push(ws);
    const turn = await runTurn({ question: "Orders?", lang: "en", conversationId: "new", app: ws });
    assert.equal(turn.error.code, "no_cloud", JSON.stringify(env));
  }
  await assert.rejects(openAiAdapter({ baseUrl: "https://api.openai.com/v1", key: "k", model: "m" }).step({ messages: [], tools: [] }), isNoCloud, "the adapter's default fetch");
});
