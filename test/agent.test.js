// The model path, with a stubbed Anthropic client: no network, no key.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { agentMode, historyMessages, runTurn, systemPrompt } from "../src/agent/agent.js";
import { demoWorkspace } from "./helpers.js";

let ws;
before(async () => (ws = await demoWorkspace({ seed: false })));
after(() => ws.close());

/** A client whose responses are scripted: each step gets the request and returns { content, stop_reason }. */
function stubClient(steps) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        stream(params, opts) {
          // The loop appends to messages after the call; keep what was actually sent.
          requests.push({ ...structuredClone(params), signal: opts?.signal });
          const step = steps[requests.length - 1];
          return { finalMessage: async () => (step ? step(params, opts) : { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" }) };
        },
      },
    },
  };
}

const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const lastResults = (params) => params.messages.at(-1).content;
const resultOf = (params, id) => {
  const r = lastResults(params).find((b) => b.tool_use_id === id);
  return { ...r, json: r.is_error ? null : JSON.parse(r.content) };
};

const ask = (o) => {
  const events = [];
  const done = runTurn({ lang: "en", store: ws.store, warehouse: ws.warehouse, pack: ws.pack, config: { ...ws.config, model: "claude-opus-5-5" }, emit: (t, d) => events.push([t, d]), ...o });
  return done.then((turn) => ({ turn, events }));
};

test("a stub client puts the agent in model mode; no client and no key is the planner", () => {
  assert.deepEqual(agentMode({ model: "claude-opus-5-5" }, {}), { mode: "model", model: "claude-opus-5-5" });
  assert.deepEqual(agentMode({ anthropicApiKey: null }), { mode: "planner", model: null });
});

test("the model runs tools, fixes an ungrounded number after the validator's error, and publishes", async () => {
  const client = stubClient([
    () => ({
      content: [
        toolUse("tu_1", "run_query", { metric: "orders", group_by: "day", from: "2026-10-09", to: "2026-10-22" }),
        toolUse("tu_2", "reconcile", { check: "ga4_vs_orders", from: "2026-10-09", to: "2026-10-22" }),
      ],
      stop_reason: "tool_use",
    }),
    (p) => {
      const q = resultOf(p, "tu_1").json;
      const c = resultOf(p, "tu_2").json;
      assert.equal(q.total, 2753);
      assert.equal(q.total_formatted, "2,753");
      assert.equal(c.delta_pct_formatted, "−10.1%");
      assert.equal(c.sql, undefined, "the model gets the figures, not the SQL");
      return { content: [toolUse("tu_3", "publish_answer", { sentence: "GA4 shows 2,800 purchases.", query_id: q.query_id, check_id: c.check_id })], stop_reason: "tool_use" };
    },
    (p) => {
      const r = resultOf(p, "tu_3");
      assert.equal(r.is_error, true);
      assert.match(r.content, /2,800/);
      const q = p.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.tool_use_id === "tu_1");
      const c = p.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.tool_use_id === "tu_2");
      return {
        content: [toolUse("tu_4", "publish_answer", { sentence: "GA4 purchases are 2,474 against 2,753 orders (−10.1%).", query_id: JSON.parse(q.content).query_id, check_id: JSON.parse(c.content).check_id })],
        stop_reason: "tool_use",
      };
    },
    () => ({ content: [{ type: "text", text: "The check does not add up on mobile." }], stop_reason: "end_turn" }),
  ]);
  const { turn, events } = await ask({ question: "Do GA4 purchases match our orders in the last 14 days?", client });

  assert.deepEqual(events.map(([t]) => t), ["turn", "step", "step", "step", "step", "answer", "text", "done"]);
  assert.deepEqual(turn.steps.map((s) => [s.tool, s.ok]), [["run_query", true], ["reconcile", true], ["publish_answer", false], ["publish_answer", true]]);
  assert.equal(turn.answers.length, 1);
  assert.equal(turn.answers[0].created_by, "agent");
  assert.deepEqual(turn.answers[0].validation, { ok: true, unmatched: [] });
  assert.equal(turn.text, "The check does not add up on mobile.");
  assert.equal(turn.created_by, "agent");
  assert.equal(turn.error, null);

  const [first] = client.requests;
  assert.equal(first.model, "claude-opus-5-5");
  assert.deepEqual(first.thinking, { type: "adaptive" });
  assert.equal(first.fallbacks, "default");
  assert.ok(first.tools.every((t) => t.eager_input_streaming === true));
  assert.ok(!first.tools.some((t) => t.name === "undo" || t.name === "decide_alert"));
  assert.match(first.system, /Data covers 2026-07-25 to 2026-10-22 \(today is 2026-10-23/);
  assert.ok(first.signal === undefined || first.signal instanceof AbortSignal);
  // Parallel tool results go back in one user message.
  assert.equal(client.requests[1].messages.at(-1).content.length, 2);
});

test("history: the last 4 turns of the conversation, with the ids the model may refer to", async () => {
  const conv = ws.store.createConversation();
  for (let i = 1; i <= 5; i++) await ask({ question: `Question ${i}`, conversationId: conv.id, client: stubClient([]) });
  const client = stubClient([]);
  const { turn } = await ask({ question: "Question 6", conversationId: conv.id, client, context: { view: "dashboard" } });
  const msgs = client.requests[0].messages;
  assert.deepEqual(msgs.filter((m) => m.role === "user").map((m) => m.content.split("\n")[0]), ["Question 2", "Question 3", "Question 4", "Question 5", "Question 6"]);
  assert.match(msgs.at(-1).content, /<app_context>The person is looking at view: dashboard\.<\/app_context>/);
  assert.equal(turn.conversation_id, conv.id);

  // A published answer appears in history with its answer_id.
  const pub = stubClient([
    () => ({ content: [toolUse("a", "run_query", { metric: "orders", from: "2026-10-09", to: "2026-10-22" })], stop_reason: "tool_use" }),
    (p) => ({ content: [toolUse("b", "publish_answer", { sentence: "Orders: 2,753.", query_id: resultOf(p, "a").json.query_id })], stop_reason: "tool_use" }),
  ]);
  const { turn: t2 } = await ask({ question: "Orders?", conversationId: conv.id, client: pub });
  const h = historyMessages(ws.store, conv.id, "none");
  assert.match(h.at(-1).content, new RegExp(`Orders: 2,753\\. \\[answer_id ${t2.answers[0].id}, query_id q_`));
});

test("person-only tools and unknown tools come back to the model as errors", async () => {
  const client = stubClient([
    () => ({ content: [toolUse("x", "undo", { activity_id: "act_1" }), toolUse("y", "drop_table", {})], stop_reason: "tool_use" }),
    (p) => {
      assert.match(resultOf(p, "x").content, /for people only/);
      assert.match(resultOf(p, "y").content, /Unknown action/);
      return { content: [{ type: "text", text: "I cannot undo that; a person can." }], stop_reason: "end_turn" };
    },
  ]);
  const { turn } = await ask({ question: "Undo the last pin", client });
  assert.deepEqual(turn.steps.map((s) => s.ok), [false, false]);
  assert.equal(turn.error, null);
});

test("an alert the model creates waits for approval and is announced", async () => {
  const client = stubClient([() => ({ content: [toolUse("al", "create_alert", { check: "ga4_vs_orders", title: "GA4 check" })], stop_reason: "tool_use" })]);
  const { turn, events } = await ask({ question: "Tell me when the GA4 check fails", client });
  assert.equal(turn.approvals[0].status, "pending");
  assert.equal(turn.approvals[0].created_by, "agent");
  assert.ok(events.some(([t, d]) => t === "approval" && d.alert.id === turn.approvals[0].id));
});

test("stop: aborting the signal ends the turn as stopped", async () => {
  const controller = new AbortController();
  const client = {
    beta: {
      messages: {
        stream: (_p, opts) => ({
          finalMessage: () =>
            new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
        }),
      },
    },
  };
  const pending = ask({ question: "Revenue?", client, signal: controller.signal, onTurn: () => setTimeout(() => controller.abort(), 10) });
  const { turn, events } = await pending;
  assert.equal(turn.status, "stopped");
  assert.deepEqual(turn.error, { code: "stopped", message: "Stopped." });
  assert.deepEqual(events.slice(-2).map(([t]) => t), ["error", "done"]);
});

test("a refusal ends the turn with an error the person can act on", async () => {
  const client = stubClient([() => ({ content: [], stop_reason: "refusal" })]);
  const { turn } = await ask({ question: "Something", client, lang: "tr" });
  assert.equal(turn.error.code, "refusal");
  assert.match(turn.error.message, /Model bu soruyu yanıtlamadı/);
});

test("the system prompt carries the pack, the data range and the brand rules", () => {
  const s = systemPrompt({ pack: ws.pack, range: { from: "2026-07-25", to: "2026-10-22" }, workspace: "Örnek Moda", demo: true, lang: "tr", today: "2026-10-23" });
  assert.match(s, /- orders \(count, v3\)/);
  assert.match(s, /- meta_vs_orders: .*tolerance 20%/);
  assert.match(s, /reply in Turkish/);
  assert.match(s, /never "siz"/);
  assert.match(s, /No superlatives, no exclamation marks, no emoji, no em dashes/);
});
