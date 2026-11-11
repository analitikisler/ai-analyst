// The built-in planner: how it reads questions, the periods it picks, refusals, follow-ups that never repeat a
// question, and grounded sentences in both languages. Full sentence parity with the prototype is in parity.test.js.
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../src/agent/agent.js";
import { namedRange, periodOf, route, whyDetail, whyText } from "../src/agent/planner.js";
import { validateSentence } from "../src/agent/validate.js";
import { demoWorkspace } from "./helpers.js";

let ws;
before(async () => (ws = await demoWorkspace({ seed: true })));
after(() => ws.close());

const DATA = { from: "2026-07-25", to: "2026-10-22" };
const pc = (extra = {}) => ({ pack: ws.pack, data: DATA, demo: true, events: [], context: null, lastAnswer: null, lastCheck: null, ...extra });
const ask = async (question, lang = "en", conversationId = "new") => {
  const events = [];
  const turn = await runTurn({ question, lang, conversationId, app: ws, emit: (type, data) => events.push([type, data]) });
  return { turn, events };
};

test("periods: last N days, yesterday, last week as the last complete Monday to Sunday week, this and last month", () => {
  const p = (s, d = 14) => {
    const { from, to } = periodOf(s, d, DATA);
    return [from, to];
  };
  assert.deepEqual(p("in the last 14 days"), ["2026-10-09", "2026-10-22"]);
  assert.deepEqual(p("son 28 günde"), ["2026-09-25", "2026-10-22"]);
  assert.deepEqual(p("how many orders yesterday"), ["2026-10-22", "2026-10-22"]);
  assert.deepEqual(p("dün kaç sipariş"), ["2026-10-22", "2026-10-22"]);
  assert.deepEqual(p("revenue last week"), ["2026-10-12", "2026-10-18"], "22 Oct is a Thursday, so the last complete week is 12–18 Oct");
  assert.deepEqual(p("geçen hafta ciro"), ["2026-10-12", "2026-10-18"]);
  assert.deepEqual(p("this month"), ["2026-10-01", "2026-10-22"]);
  assert.deepEqual(p("geçen ay"), ["2026-09-01", "2026-09-30"]);
  assert.deepEqual(p("for 9–22 oct"), ["2026-10-09", "2026-10-22"]);
  assert.deepEqual(p("anything", 7), ["2026-10-16", "2026-10-22"]);
  assert.deepEqual(p("in the last 400 days"), ["2026-07-25", "2026-10-22"], "clamped to the data");
});

test("a range of days in any month, in English or Turkish; days with no data are refused, never answered with the nearest days", () => {
  const p = (q) => {
    const r = periodOf(q.toLocaleLowerCase("tr"), 14, DATA);
    return [r.from, r.to, r.label.en, r.label.tr];
  };
  assert.deepEqual(p("Revenue for 3–9 Sep"), ["2026-09-03", "2026-09-09", "3–9 Sep", "3–9 Eyl"]);
  assert.deepEqual(p("3-9 eylül arasında ciro"), ["2026-09-03", "2026-09-09", "3–9 Sep", "3–9 Eyl"]);
  assert.deepEqual(p("1–15 Ağustos'ta sipariş"), ["2026-08-01", "2026-08-15", "1–15 Aug", "1–15 Ağu"]);
  assert.deepEqual(p("orders for 28 Sep – 4 Oct"), ["2026-09-28", "2026-10-04", "28 Sep – 4 Oct", "28 Eyl – 4 Eki"]);
  assert.deepEqual(p("orders for 20–31 July"), ["2026-07-25", "2026-07-31", "20–31 Jul", "20–31 Tem"], "clamped to where the data starts");
  assert.deepEqual(p("orders for 15–30 October"), ["2026-10-15", "2026-10-22", "15–30 Oct", "15–30 Eki"], "and to where it ends");
  // A month word must stand whole, and the days must be dates.
  assert.equal(namedRange("the top 3-5 marketing channels", DATA), null);
  assert.equal(namedRange("orders for 30–31 feb", DATA), null);
  // A month after the data ends is read as last year's, like any date that has not come yet.
  assert.deepEqual([namedRange("3–9 nov", DATA).from, namedRange("3–9 nov", DATA).outside], ["2025-11-03", true]);
  assert.deepEqual([namedRange("28 dec – 3 jan", DATA).from, namedRange("28 dec – 3 jan", DATA).to], ["2025-12-28", "2026-01-03"]);
  for (const q of ["Revenue for 3–9 Nov", "3–9 Haziran'da kaç sipariş geldi?", "Do GA4 purchases match orders for 1–7 May?"]) {
    const r = route(q, pc());
    assert.deepEqual([r.kind, r.refusal.code, r.refusal.missing], ["refusal", "not_in_data", "period"], q);
    assert.match(r.refusal.body.en, /is outside the data, which covers 25 Jul–22 Oct 2026/);
    assert.match(r.refusal.body.tr, /verinin dışında/);
  }
  assert.equal(route("Revenue for 3–9 Sep", pc()).kind, "metric");
});

test("why, on data that is not the demo's: only what the figures and the audits say", () => {
  const side = (key, expected, measured, verdict) => ({ key, expected, measured, delta_pct: (measured - expected) / expected, verdict });
  const base = { check: "ga4_vs_orders", unit: "count", from: "2026-10-09", to: "2026-10-22", tolerance: 0.05, verdict: "does_not_add_up", expected: { value: 1000 }, measured: { value: 1200 }, delta: 200, delta_pct: 0.2, out_of_tolerance_since: "2026-10-12", findings: [], breakdown: [side("mobile", 600, 610, "adds_up"), side("desktop", 400, 590, "does_not_add_up")] };
  // GA4 counts more, on desktop: the demo's sentence ("fewer", "the gap is on mobile", a release, Safari) would be false.
  const more = whyText(base, DATA);
  assert.match(more.en, /^GA4 recorded 1,200 purchases against 1,000 back-office orders for 9–22 Oct 2026: 20\.0% more, outside the ±5% tolerance\. The gap is on desktop \(\+?47\.5%\) from 12 Oct\. No audit finding explains it yet\.$/);
  assert.match(more.tr, /GA4 %20,0 daha fazla.*Fark masaüstünde.*Bunu açıklayan bir denetim bulgusu şimdilik yok\.$/);
  assert.doesNotMatch(`${more.en} ${more.tr}`, /mobile \(|mobilde|Safari|v4\.12|release|sürüm/);
  assert.deepEqual(validateSentence(more, { check: base }), { ok: true, unmatched: [] });
  const detail = whyDetail(base);
  assert.deepEqual([detail.started, detail.release, detail.segment.key, detail.narrower], ["2026-10-12", null, "desktop", null]);
  assert.doesNotMatch(JSON.stringify(detail.next), /v4\.12|Safari|thank-you/, "the demo's fix is not advised for another gap");
  // Both devices out: no segment is named, the day it started is.
  const both = whyText({ ...base, breakdown: [side("mobile", 600, 720, "does_not_add_up"), side("desktop", 400, 480, "does_not_add_up")] }, DATA);
  assert.match(both.en, /20\.0% more, outside the ±5% tolerance\. The difference has been outside the tolerance since 12 Oct\. No audit finding/);
  assert.doesNotMatch(both.en, /The gap is on/);
  // An audit's own finding is quoted as it was written, with no release it does not carry.
  const found = { id: "f_1", source: "ai tag debugger", since: "2026-10-12", release: null, checks: ["ga4_vs_orders"], text: { en: "Purchase fires twice on the desktop thank-you page", tr: "Masaüstü teşekkür sayfasında purchase iki kez gönderiliyor" } };
  const quoted = whyText({ ...base, findings: [found] }, DATA);
  assert.match(quoted.en, /from 12 Oct\. ai tag debugger found that purchase fires twice on the desktop thank-you page\.$/);
  assert.match(quoted.tr, /ai tag debugger şunu buldu: Masaüstü teşekkür sayfasında purchase iki kez gönderiliyor\.$/);
  assert.equal(whyDetail({ ...base, findings: [found] }).narrower, null);
  // GA4 short on mobile alone, on someone's own data: told by device, with their finding, not the demo's.
  const mobile = { ...base, measured: { value: 850 }, delta: -150, delta_pct: -0.15, breakdown: [side("mobile", 600, 455, "does_not_add_up"), side("desktop", 400, 395, "adds_up")], findings: [{ ...found, text: { en: "The consent banner blocks the purchase tag on iOS.", tr: "Çerez bandı iOS’ta purchase tag’ini engelliyor." } }] };
  const own = whyText(mobile, DATA);
  assert.match(own.en, /^GA4 recorded 15\.0% fewer purchases than the back office for 9–22 Oct 2026\. The gap is on mobile \(−24\.2%\); desktop is inside the tolerance \(−1\.3%\)\. It starts on 12 Oct\. ai tag debugger found that the consent banner blocks the purchase tag on iOS\.$/);
  assert.doesNotMatch(`${own.en} ${own.tr}`, /Safari|v4\.12|release|sürümünün/);
});

test("routes: checks, the device follow-up, why, metrics, proposals and refusals", () => {
  assert.deepEqual(route("Do GA4 purchases match orders in the last 14 days?", pc()).check, "ga4_vs_orders");
  assert.equal(route("Does GA4 revenue match?", pc()).check, "ga4_rev_vs_revenue");
  assert.equal(route("Bu ay Meta dönüşümleri siparişlerle tutuyor mu?", pc()).check, "meta_vs_orders");
  const last = { check: "meta_vs_orders", from: "2026-10-01", to: "2026-10-22" };
  assert.deepEqual(route("Is the gap only on mobile?", pc({ lastCheck: last })), { kind: "check_split", check: "meta_vs_orders", period: { from: "2026-10-01", to: "2026-10-22" } });
  assert.equal(route("Why does it not match?", pc({ lastCheck: last })).kind, "why");
  assert.deepEqual(route("ROAS by channel in the last 28 days", pc()).group, "channel");
  assert.equal(route("Son 90 günün haftalık cirosu", pc()).group, "week");
  assert.equal(route("Watch the Meta tracking check", pc()).kind, "propose_watch");
  assert.equal(route("Pin this to the dashboard", pc()).kind, "refusal", "nothing to pin yet");
  assert.equal(route("Pin this to the dashboard", pc({ lastAnswer: { id: "a" } })).kind, "propose_pin");
  assert.equal(route("Add the v4.12 release as an event", pc()).kind, "propose_event");
  assert.equal(route("Add the v4.12 release as an event", pc({ events: [{ type: "release", date: "2026-10-09" }] })).kind, "refusal", "it is there already");
  assert.equal(route("Add the v4.12 release as an event", pc({ demo: false })).kind, "refusal", "the demo's release is not proposed on own data");
  assert.equal(route("Which products sell most?", pc()).refusal.code, "not_in_data");
  assert.equal(route("İade oranı ne?", pc()).refusal.missing, "return");
  const weekday = route("Which weekday brings the most revenue?", pc()).refusal;
  assert.equal(weekday.code, "planner_unknown");
  assert.match(weekday.body.en, /With a model added, an exploratory answer is possible/);
  assert.equal(route("Turn this into a metric", pc({ demo: false })).refusal.body.en.startsWith("Metrics live in metrics/*.yaml next to the BigQuery connection"), true);
  // On a metric page the question is about that metric unless it names another.
  assert.equal(route("What about last week?", pc({ context: { view: "metric", kind: "metric", id: "aov" } })).metric, "aov");
});

test("the seeded question: steps, an answer with a check, the planner's note, a grounded sentence in both languages", async () => {
  const { turn, events } = await ask("Do GA4 purchases match orders in the last 14 days?");
  assert.deepEqual(events.map(([t]) => t), ["turn", "step", "step", "step", "answer", "text", "done"]);
  assert.deepEqual(events[0][1].question_text, { en: "Do GA4 purchases match orders in the last 14 days?", tr: "Son 14 günde GA4 satın almaları siparişlerle tutuyor mu?" });
  const [a] = turn.answers;
  assert.deepEqual([a.kind, a.created_by, a.model_label.en, a.check.verdict], ["check", "planner", "Built-in planner", "does_not_add_up"]);
  assert.match(a.sentence.tr, /^Tutmuyor\. 9–22 Eki 2026 döneminde sipariş panelinde 2\.753 sipariş, GA4’te 2\.474 satın alma var/);
  assert.deepEqual(a.validation, { ok: true, unmatched: [] });
  assert.deepEqual(turn.text, { en: "Answered by the built-in planner, without a model.", tr: "Cevabı yerleşik planlayıcı verdi; model kullanılmadı." });
  assert.equal(turn.status, "done");
  assert.equal(turn.created_by, "person");
});

test("follow-ups never repeat a question already asked in the conversation", async () => {
  const first = await ask("Do GA4 purchases match orders in the last 14 days?");
  const conv = first.turn.conversation_id;
  const asked = ["Do GA4 purchases match orders in the last 14 days?"];
  for (const q of ["Is the gap only on mobile?", "Do Meta conversions match orders this month?", "ROAS by channel in the last 28 days"]) {
    asked.push(q);
    const { turn } = await ask(q, "en", conv);
    for (const f of turn.answers[0].followups) assert.ok(!asked.includes(f.en), `${q} → ${f.en}`);
    assert.ok(turn.answers[0].followups.length <= 3);
  }
});

test("yesterday compares with the same weekday a week before; last week with the week before", async () => {
  const y = (await ask("How many orders did we get yesterday?")).turn.answers[0];
  assert.deepEqual([y.query.from, y.query.to, y.query.comparison.from], ["2026-10-22", "2026-10-22", "2026-10-15"]);
  const w = (await ask("Geçen hafta ciro, bir önceki haftaya göre", "tr")).turn.answers[0];
  assert.deepEqual([w.kind, w.query.from, w.query.to, w.query.comparison.from, w.query.comparison.to], ["number", "2026-10-12", "2026-10-18", "2026-10-05", "2026-10-11"]);
  assert.equal(w.validation.ok, true);
});

test("a refusal says a model could answer and offers nearby questions; a watch is proposed, not made", async () => {
  const { turn, events } = await ask("Which channel's revenue grew on weekdays?");
  assert.deepEqual(events.map(([t]) => t), ["turn", "refusal", "done"]);
  assert.equal(turn.refusal.nearest.length, 3);
  const watch = await ask("Watch the Google Ads tracking check");
  assert.deepEqual(watch.events.map(([t]) => t), ["turn", "step", "approval", "text", "done"]);
  assert.equal(ws.store.list("watches").some((w) => w.check === "gads_vs_orders"), false);
  assert.equal(watch.turn.approvals.length, 1);
});
