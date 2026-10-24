// The MCP server through an in-memory client: the chat-app tools, results with their SQL, and the call log.
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { callAction } from "../src/actions/index.js";
import { buildMcpServer } from "../src/mcp.js";
import { ctxFor, demoWorkspace } from "./helpers.js";

let ws, client;
before(async () => {
  ws = await demoWorkspace({ seed: true });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildMcpServer(ws).connect(a);
  client = new Client({ name: "claude-ai", version: "1" });
  await client.connect(b);
});
after(() => ws.close());

test("the MCP tools: the reads, the check run, and the audit round trip", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["attach_audit_finding", "explain_metric", "get_audit", "get_workspace", "list_checks", "list_events", "list_metrics", "list_sources", "reconcile", "run_all_checks", "run_query"]);
  assert.ok(tools.find((t) => t.name === "run_query").inputSchema.properties.metric.enum.includes("roas"));
});

test("a chat app runs a query and a check, sees the SQL, and the call is logged for Settings", async () => {
  const q = await client.callTool({ name: "run_query", arguments: { metric: "orders", from: "2026-10-09", to: "2026-10-22" } });
  const qr = JSON.parse(q.content[0].text);
  assert.equal(qr.total, 2753);
  assert.match(qr.sql, /SUM\(orders\)/);
  const c = await client.callTool({ name: "reconcile", arguments: { check: "meta_vs_orders", from: "2026-10-01", to: "2026-10-22" } });
  const r = JSON.parse(c.content[0].text);
  assert.deepEqual([r.expected.value, r.measured.value, r.verdict, r.series], [483, 658, "does_not_add_up", undefined]);
  const calls = await callAction("list_chat_app_calls", {}, ctxFor(ws));
  assert.deepEqual(calls.slice(0, 2).map((x) => [x.client, x.tool, x.check]), [["Claude Desktop", "reconcile", "meta_vs_orders"], ["Claude Desktop", "run_query", undefined]]);
});

test("a check run from a chat app is logged as the chat app", async () => {
  await client.callTool({ name: "run_all_checks", arguments: { days: 14 } });
  const a = ws.store.listActivity(1)[0];
  assert.deepEqual([a.actor, a.client, a.action], ["chat_app", "Claude Desktop", "run_all_checks"]);
});

test("errors come back as tool errors with what to fix; person-only writes are not tools", async () => {
  const res = await client.callTool({ name: "run_query", arguments: { metric: "orders", from: "2026-13-01" } });
  assert.equal(res.isError, true);
  const pin = await client.callTool({ name: "pin_answer", arguments: { answer_id: "x" } });
  assert.equal(pin.isError, true);
});

test("a chat app's name is stored as plain text", async () => {
  const { clientLabel } = await import("../src/mcp.js");
  assert.equal(clientLabel({ name: "<img src=x onerror=alert(1)>" }), "img srcx onerroralert1");
  assert.equal(clientLabel({ name: "<>" }), "Chat app");
});
