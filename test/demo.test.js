// The demo must show the prototype's numbers: same generator, same seed, same order of rnd() calls.
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DEMO, generateFacts } from "../src/demo/seed.js";
import { callAction } from "../src/actions/index.js";
import { ctxFor, demoWorkspace } from "./helpers.js";

let ws;
before(async () => (ws = await demoWorkspace({ seed: false })));
after(() => ws.close());

const round1 = (r) => Math.round(r * 1000) / 10;

test("the generator makes one row per date, channel and device", () => {
  const rows = generateFacts();
  assert.equal(rows.length, 90 * 6 * 2);
  assert.equal(rows[0].date, DEMO.first);
  assert.equal(rows.at(-1).date, DEMO.last);
  assert.deepEqual(Object.keys(rows[0]), ["date", "channel", "device", "sessions", "orders", "revenue", "ga4_purchases", "ga4_revenue", "platform_conversions", "ad_spend"]);
  // Spend and platform conversions exist only for ad channels.
  assert.ok(rows.filter((r) => ["organic", "direct", "email"].includes(r.channel)).every((r) => r.ad_spend === 0 && r.platform_conversions === 0));
  // Deterministic.
  assert.deepEqual(generateFacts().slice(0, 5), rows.slice(0, 5));
});

test("GA4 check, 9–22 Oct 2026: 2,753 orders against 2,474 GA4 purchases, Δ −10.1%, mobile −15.6%", async () => {
  const r = await callAction("reconcile", { check: "ga4_vs_orders", from: "2026-10-09", to: "2026-10-22" }, ctxFor(ws));
  assert.equal(r.expected.value, 2753);
  assert.equal(r.measured.value, 2474);
  assert.equal(r.delta, -279);
  assert.equal(round1(r.delta_pct), -10.1);
  assert.equal(r.verdict, "does_not_add_up");
  const mobile = r.breakdown.find((b) => b.key === "mobile");
  assert.equal(round1(mobile.delta_pct), -15.6);
  assert.equal(mobile.verdict, "does_not_add_up");
  assert.equal(r.breakdown.find((b) => b.key === "desktop").verdict, "adds_up");
  assert.equal(r.out_of_tolerance_since, "2026-10-09", "the gap starts with release v4.12");
});

test("Meta check, 1–22 Oct 2026: 483 orders against 658 Meta conversions, Δ +36.2%", async () => {
  const r = await callAction("reconcile", { check: "meta_vs_orders", from: "2026-10-01", to: "2026-10-22" }, ctxFor(ws));
  assert.equal(r.expected.value, 483);
  assert.equal(r.measured.value, 658);
  assert.equal(round1(r.delta_pct), 36.2);
  assert.equal(r.verdict, "does_not_add_up");
  assert.match(r.sql.expected, /channel = 'meta_ads'/);
});

test("the GA4 check adds up before the release", async () => {
  const r = await callAction("reconcile", { check: "ga4_vs_orders", from: "2026-09-01", to: "2026-09-30" }, ctxFor(ws));
  assert.equal(r.verdict, "adds_up");
  assert.equal(r.out_of_tolerance_since, null);
  assert.deepEqual(r.findings, []);
});

test("the warehouse reports its data range", async () => {
  assert.deepEqual(await ws.warehouse.range(), { from: "2026-07-25", to: "2026-10-22", rows: 1080 });
});
