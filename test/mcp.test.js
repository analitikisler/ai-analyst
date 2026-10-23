// The MCP server through an in-memory client.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../src/mcp.js";
import { demoWorkspace } from "./helpers.js";

let ws, client;
before(async () => {
  ws = await demoWorkspace({ seed: false });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildMcpServer(ws).connect(a);
  client = new Client({ name: "test", version: "1" });
  await client.connect(b);
});
after(() => ws.close());

test("the MCP tools are the read actions plus run_all_checks", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["explain_metric", "get_workspace", "list_checks", "list_metrics", "list_sources", "reconcile", "run_all_checks", "run_query"]);
  const rq = tools.find((t) => t.name === "run_query");
  assert.ok(rq.inputSchema.properties.metric.enum.includes("roas"));
});

test("a chat app can run a query and a check", async () => {
  const q = await client.callTool({ name: "run_query", arguments: { metric: "orders", from: "2026-10-09", to: "2026-10-22" } });
  assert.equal(JSON.parse(q.content[0].text).total, 2753);
  const c = await client.callTool({ name: "reconcile", arguments: { check: "meta_vs_orders", from: "2026-10-01", to: "2026-10-22" } });
  const r = JSON.parse(c.content[0].text);
  assert.deepEqual([r.expected.value, r.measured.value, r.verdict], [483, 658, "does_not_add_up"]);
});

test("errors come back as tool errors with what to fix", async () => {
  const res = await client.callTool({ name: "run_query", arguments: { metric: "orders", from: "2026-13-01" } });
  assert.equal(res.isError, true);
});
