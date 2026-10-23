// The built-in planner: fixed plans, the same tools, grounded sentences.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../src/agent/agent.js";
import { periodFrom, plan, plannerSentence, SUGGEST } from "../src/agent/planner.js";
import { seedFindings } from "../src/demo/seed.js";
import { demoWorkspace } from "./helpers.js";

let ws;
before(async () => {
  ws = await demoWorkspace({ seed: false });
  seedFindings(ws.store);
});
after(() => ws.close());

const LAST = "2026-10-22";
const ask = (question, lang = "en", events = []) =>
  runTurn({ question, lang, store: ws.store, warehouse: ws.warehouse, pack: ws.pack, config: ws.config, emit: (type, data) => events.push([type, data]) });

test("periods: N days, this month, last month, week, quarter, default 14 days", () => {
  assert.deepEqual(periodFrom("last 14 days", LAST), { from: "2026-10-09", to: LAST });
  assert.deepEqual(periodFrom("son 28 günde", LAST), { from: "2026-09-25", to: LAST });
  assert.deepEqual(periodFrom("this month", LAST), { from: "2026-10-01", to: LAST });
  assert.deepEqual(periodFrom("geçen ay", LAST), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(periodFrom("this week", LAST), { from: "2026-10-16", to: LAST });
  assert.deepEqual(periodFrom("the quarter", LAST), { from: "2026-07-25", to: LAST });
  assert.deepEqual(periodFrom("anything", LAST), { from: "2026-10-09", to: LAST });
});

test("plans for the suggested questions, in both languages", () => {
  assert.deepEqual(plan(SUGGEST.en[0], LAST), { metric: "orders", group_by: "day", check: "ga4_vs_orders", from: "2026-10-09", to: LAST, alert: false, pin: false });
  assert.deepEqual(plan(SUGGEST.tr[1], LAST), { metric: "roas", group_by: "channel", from: "2026-09-25", to: LAST, alert: false, pin: false });
  assert.equal(plan(SUGGEST.en[2], LAST).check, "meta_vs_orders");
  assert.equal(plan(SUGGEST.tr[2], LAST).channel, "meta_ads");
  assert.deepEqual(plan(SUGGEST.en[3], LAST), { metric: "revenue", group_by: "week", check: "ga4_rev_vs_revenue", from: "2026-07-25", to: LAST, alert: false, pin: false });
  assert.equal(plan("Orders by day for the last 90 days", LAST).group_by, "week", "long daily series become weekly");
  assert.equal(plan("What is the weather?", LAST), null);
  assert.equal(plan("Make an alert for the GA4 check and pin it", LAST).alert, true);
});

test("the seeded question: same tools, the prototype's numbers, a grounded sentence", async () => {
  const events = [];
  const turn = await ask(SUGGEST.en[0], "en", events);
  assert.deepEqual(events.map(([t]) => t), ["turn", "step", "step", "step", "answer", "text", "done"]);
  assert.deepEqual(turn.steps.map((s) => [s.tool, s.ok]), [["run_query", true], ["reconcile", true], ["publish_answer", true]]);
  const [a] = turn.answers;
  assert.equal(a.created_by, "planner");
  assert.equal(a.sentence, "Orders for 9–22 Oct 2026: 2,753. GA4 purchases: −10.1% against the source, so the check does not add up. The gap is on mobile (−15.6%) and starts on 9 Oct.");
  assert.deepEqual(a.validation, { ok: true, unmatched: [] });
  assert.deepEqual(a.check.findings.map((f) => [f.id, f.source, f.since]), [["f_ga4_mobile_safari", "AI Tag Debugger", "2026-10-09"]]);
  assert.deepEqual(a.followups, ["Is the gap only on mobile?", "Which channel has the highest ROAS in the last 28 days?", "Do Meta conversions match our orders?"]);
  assert.equal(turn.created_by, "planner");
  assert.match(turn.text, /built-in planner/);
});

test("Turkish: numbers and dates in Turkish formats, still grounded", async () => {
  const turn = await ask(SUGGEST.tr[0], "tr");
  const [a] = turn.answers;
  assert.equal(a.sentence, "9–22 Eki 2026 döneminde Sipariş: 2.753. GA4 satın alma kaynaktan −%10,1 farklı; kontrol tutmuyor. Fark mobil tarafında (−%15,6) ve 9 Eki tarihinden beri var.");
  assert.equal(a.validation.ok, true);
  assert.equal(a.title, "Sipariş · 9–22 Eki 2026");
});

test("every suggested question gets a grounded answer", async () => {
  for (const lang of ["en", "tr"]) {
    for (const q of SUGGEST[lang]) {
      const turn = await ask(q, lang);
      assert.equal(turn.error, null, q);
      assert.equal(turn.answers.length, 1, q);
      assert.deepEqual(turn.answers[0].validation, { ok: true, unmatched: [] }, `${q}: ${turn.answers[0].sentence}`);
    }
  }
});

test("asking to be told proposes a pending alert; asking to pin pins it", async () => {
  const events = [];
  const turn = await ask("Pin the GA4 check and make an alert for it", "en", events);
  assert.equal(turn.approvals.length, 1);
  assert.equal(turn.approvals[0].status, "pending");
  assert.ok(events.some(([t, d]) => t === "approval" && d.alert.id === turn.approvals[0].id));
  assert.ok(ws.store.pinForAnswer(turn.answers[0].id));
});

test("a question the planner does not know gets a plain note, no answer", async () => {
  const turn = await ask("What will the weather be tomorrow?");
  assert.equal(turn.answers.length, 0);
  assert.match(turn.text, /built-in planner knows orders/);
  assert.equal(turn.error, null);
});

test("plannerSentence names the top channel for a channel query", async () => {
  const q = { metric: "roas", group_by: "channel", from: "2026-09-25", to: LAST, filters: {}, unit: "ratio", total: 2.0912, rows: [{ key: "google_ads", value: 2.6634 }] };
  assert.equal(plannerSentence(ws.pack, q, null, "en"), "ROAS for 25 Sep–22 Oct 2026 is 2.09×. The highest channel is Google Ads at 2.66×.");
  assert.equal(plannerSentence(ws.pack, q, null, "tr"), "25 Eyl–22 Eki 2026 döneminde ROAS 2,09×. En yüksek kanal Google Ads: 2,66×.");
});
