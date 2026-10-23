// Number grounding: every number in a sentence must be one the query or the check returned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractNumbers, groundTruth, validateSentence } from "../src/agent/validate.js";

const query = { unit: "count", total: 2753, rows: [{ key: "2026-10-09", value: 180 }, { key: "2026-10-10", value: 241 }] };
const check = {
  expected: { value: 2753 },
  measured: { value: 2474 },
  delta: -279,
  delta_pct: -0.10134398837631675,
  tolerance: 0.05,
  breakdown: [
    { key: "mobile", expected: 1681, measured: 1419, delta_pct: -0.15585960737656157 },
    { key: "desktop", expected: 1072, measured: 1055, delta_pct: -0.01585820895522388 },
  ],
};
const ok = (sentence, refs = { query, check }) => assert.deepEqual(validateSentence(sentence, refs), { ok: true, unmatched: [] }, sentence);
const bad = (sentence, unmatched, refs = { query, check }) => assert.deepEqual(validateSentence(sentence, refs), { ok: false, unmatched }, sentence);

test("the planner's English sentence is grounded", () => {
  ok("Orders for 9–22 Oct 2026: 2,753. GA4 purchases: −10.1% against the source, so the check does not add up. The gap is on mobile (−15.6%) and starts on 9 Oct.");
});

test("the planner's Turkish sentence is grounded", () => {
  ok("9–22 Eki 2026 döneminde Sipariş: 2.753. GA4 satın alma kaynaktan −%10,1 farklı; kontrol tutmuyor. Fark mobil tarafında (−%15,6) ve 9 Eki tarihinden beri var.");
});

test("an invented number is caught, in either language", () => {
  bad("Orders for the period: 2,800.", ["2,800"]);
  bad("Dönemde 2.800 sipariş var.", ["2.800"]);
  bad("GA4 is 12.4% short.", ["12.4%"]);
  bad("GA4 %12,4 eksik.", ["%12,4"]);
  bad("GA4 −%12,4 eksik.", ["−%12,4"]);
});

test("rounding follows the precision written", () => {
  ok("GA4 is 10% short."); // 10.13 rounds to 10
  ok("GA4 is 10.13% short.");
  bad("GA4 is 10.2% short.", ["10.2%"]);
  ok("Roughly 2.75k orders."); // 2,753 / 1,000 = 2.753
  bad("Roughly 2.8k orders and 2.76k purchases.", ["2.76k"]); // 2.753k rounds to 2.8k, not to 2.76k
});

test("signs do not matter, magnitudes do: a gap may be written as a shortfall", () => {
  ok("GA4 counts 279 fewer purchases, a 10.1% shortfall.");
  ok("Δ −279 (−10.1%).");
  ok("Δ -279");
});

test("percentages compare against ratios × 100; plain numbers do not match ratios", () => {
  bad("GA4 is 0.1 short.", ["0.1"]); // the ratio −0.101 is not a figure to cite as a plain number
  ok("Tolerance is 5%.");
  ok("Desktop is within tolerance (−1.6%).");
});

test("dates, years, day ordinals and durations are not figures", () => {
  ok("Since 9 Oct 2026, in the last 14 days, orders are 2,753.");
  ok("From 2026-10-09 to 2026-10-22 orders are 2,753.");
  ok("Between Oct 9 and October 22nd orders are 2,753.");
  ok("Son 14 günde, 9 Ekim'den bu yana 2.753 sipariş.");
  ok("In 2026 the 28-day view shows 2,753.");
  ok("9 Eki – 22 Eki arasında 2.753 sipariş, son 2 haftada.");
  ok("Over 3 months and 2 weeks: 2,753.");
});

test("version numbers and ids are not figures", () => {
  ok("Since release v4.12, GA4 is −10.1% against orders.");
  ok("Query q_3f9a1c2b shows 2,753.");
  ok("GA4 purchases: 2,474.");
});

test("TRY amounts in millions, both languages", () => {
  const q = { unit: "try", total: 22068123.4, rows: [] };
  ok("Revenue is 22.07M TL.", { query: q });
  ok("Ciro 22,07 mn TL.", { query: q });
  ok("Revenue is 22.1 million TL.", { query: q });
  bad("Revenue is 22.17M TL.", ["22.17M"], { query: q });
  ok("Revenue is 22,068,123 TL.", { query: q });
  ok("Ciro 22.068.123 TL.", { query: q });
});

test("ratios written with ×", () => {
  const q = { unit: "ratio", total: 2.0917, rows: [{ key: "google_ads", value: 2.6612 }, { key: "meta_ads", value: 1.71 }] };
  ok("ROAS is 2.09×; Google Ads is highest at 2.66×.", { query: q });
  ok("ROAS 2,09×. En yüksek kanal Google Ads: 2,66×.", { query: q });
  ok("Meta Ads: 1.71x.", { query: q });
  bad("TikTok Ads: 0.94×.", ["0.94×"], { query: q });
});

test("a percentage-unit metric is cited as a percentage", () => {
  const q = { unit: "pct", total: 0.019812, rows: [{ key: "desktop", value: 0.02631 }, { key: "mobile", value: 0.01735 }] };
  ok("Conversion rate is 1.98%: desktop 2.63%, mobile 1.74%.", { query: q });
  ok("Dönüşüm oranı %1,98; masaüstü %2,63.", { query: q });
  bad("Conversion rate is 2.1%.", ["2.1%"], { query: q });
});

test("ambiguous separators: 1.240 is 1,240 in Turkish and 1.24 in English; either reading may match", () => {
  const q = { unit: "count", total: 1240, rows: [] };
  ok("Toplam 1.240 sipariş.", { query: q });
  ok("Total 1,240 orders.", { query: q });
  const r = { unit: "ratio", total: 1.24, rows: [] };
  ok("ROAS is 1.240×.", { query: r });
  assert.deepEqual(extractNumbers("1.240")[0].readings, [{ value: 1.24, decimals: 3 }, { value: 1240, decimals: 0 }]);
  assert.deepEqual(extractNumbers("22,07")[0].readings, [{ value: 22.07, decimals: 2 }]);
  assert.deepEqual(extractNumbers("1,240.5")[0].readings, [{ value: 1240.5, decimals: 1 }]);
  assert.deepEqual(extractNumbers("1.240,5")[0].readings, [{ value: 1240.5, decimals: 1 }]);
});

test("extractNumbers reads percent signs on either side and scale words", () => {
  const n = extractNumbers("Δ −%10,1 and +36.2% on 22,07 mn TL, 4k sessions");
  assert.deepEqual(
    n.map((x) => [x.raw, x.percent, x.scale]),
    [
      ["−%10,1", true, 1],
      ["+36.2%", true, 1],
      ["22,07 mn", false, 1e6],
      ["4k", false, 1e3],
    ],
  );
  // A sentence-ending full stop is not a decimal separator.
  assert.deepEqual(extractNumbers("Orders: 2,753.")[0].readings, [{ value: 2753, decimals: 0 }, { value: 2.753, decimals: 3 }]);
});

test("a sentence without numbers is grounded; no refs means nothing to match", () => {
  ok("The check does not add up on mobile.");
  bad("Orders are 2,753.", ["2,753"], {});
  assert.deepEqual(groundTruth({}), { plain: [], percent: [] });
});
