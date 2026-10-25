// The built-in planner: answers the common questions without a model, with the same query and check code the
// model's tools use. Ported route for route from the approved prototype (src/api/mock/planner.ts): the check
// answers, the device follow-up, "why", yesterday, last week as the last complete Monday-to-Sunday week, this
// and last month, watch, pin and event proposals, and refusals that say a model could answer. Every sentence is
// a template in both languages, filled only with figures the query or check returned.
//
// route() reads the question and returns what to do, without touching the warehouse; execute() does it.
// Follow-ups use route() too, to skip a question that would repeat an answer already given.
import { addDays, f, monthStart, trAt } from "../format.js";
import { resolveQuery } from "../metrics/compile.js";
import { lastCompleteWeek, resolvePeriod, runQuery, runReconcile } from "../engine.js";
import { MART_COLUMNS } from "../explore/run.js";
import { both, dimName, enShort, EXPLORE_Q, FOLLOW, GROUPING, NEAR, PLANNER_LABEL, READ_AS, REFUSAL, STEP, T, trFrom, trLong, WHY_NEXT } from "../text.js";

/** The demo's planted release: the day the GA4 gap starts. */
export const RELEASE = { date: "2026-10-09", label: T("v4.12 release", "v4.12 sürümü") };

const norm = (s) => s.toLocaleLowerCase("tr").replace(/[’'`]/g, "'");
const has = (s, ...res) => res.some((r) => r.test(s));
const range2 = (from, to) => ({ en: f.en.range(from, to), tr: f.tr.range(from, to) });

// ---------------------------------------------------------------- reading the question

export function periodOf(s, fallbackDays, data) {
  const last = data.to;
  const clamp = (d) => (d < data.from ? data.from : d);
  const days = /(?:last|past|son)\s+(\d{1,3})\s*(?:days?|gün)/.exec(s);
  if (days) {
    const n = Math.min(Number(days[1]), 90);
    return { from: clamp(addDays(last, -(n - 1))), to: last, label: both((l) => (l === "en" ? `last ${n} days` : `son ${n} gün`)) };
  }
  if (has(s, /yesterday/, /\bdün\b/)) return { from: last, to: last, label: T("the last full day", "son tam gün") };
  if (has(s, /last week/, /geçen hafta/)) return { ...lastCompleteWeek(last), key: "last_week", label: T("last complete week", "geçen tam hafta") };
  if (has(s, /this month/, /\bbu ay/)) return { ...resolvePeriod(data, "this_month"), key: "this_month", label: T("this month", "bu ay") };
  if (has(s, /last month/, /geçen ay/)) return { ...resolvePeriod(data, "last_month"), key: "last_month", label: T("last month", "geçen ay") };
  // "9–22 Oct", the period the follow-up names; also any "D–D Mon" range in the data's year.
  const named = /(\d{1,2})\s*[–-]\s*(\d{1,2})\s+(oct|eki)/.exec(s);
  if (named) {
    const y = last.slice(0, 4);
    const pad = (d) => String(d).padStart(2, "0");
    return { from: clamp(`${y}-10-${pad(named[1])}`), to: `${y}-10-${pad(named[2])}` > last ? last : `${y}-10-${pad(named[2])}`, label: T(`${named[1]}–${named[2]} Oct`, `${named[1]}–${named[2]} Eki`) };
  }
  return { from: clamp(addDays(last, -(fallbackDays - 1))), to: last, label: both((l) => (l === "en" ? `last ${fallbackDays} days` : `son ${fallbackDays} gün`)) };
}

export function metricOf(s) {
  if (has(s, /\broas\b/, /paying for themselves/, /kendini çıkar/)) return "roas";
  if (has(s, /cost per order/, /\bcpa\b/, /sipariş başı/)) return "cpa";
  if (has(s, /conversion rate/, /converting/, /dönüşüm oran/)) return "conversion_rate";
  if (has(s, /order value/, /basket/, /\baov\b/, /sepet/)) return "aov";
  if (has(s, /ad spend/, /spent on ads/, /\bspend\b/, /reklam harca/, /harcandı/, /harcama/)) return "ad_spend";
  if (has(s, /session/, /traffic/, /trafik/, /oturum/)) return "sessions";
  if (has(s, /revenue/, /\bciro/, /\bsales\b/, /satış/)) return "revenue";
  if (has(s, /\borders?\b/, /sipariş/)) return "orders";
  return null;
}

function groupOf(s) {
  if (has(s, /by channel/, /which channel/, /channels/, /kanal/)) return "channel";
  if (has(s, /by device/, /mobile .*desktop/, /desktop .*mobile/, /cihaz/, /mobil.*masaüstü/, /masaüstü/)) return "device";
  if (has(s, /by week/, /weekly/, /haftalık/)) return "week";
  if (has(s, /by month/, /monthly/, /aylık/)) return "month";
  if (has(s, /by day/, /daily/, /günlük/)) return "day";
  return null;
}

function checkOf(s) {
  const ga4 = /\bga4\b/.test(s);
  if (ga4 && has(s, /revenue/, /ciro/, /gelir/)) return "ga4_rev_vs_revenue";
  if (ga4) return "ga4_vs_orders";
  if (/\bmeta\b/.test(s) && has(s, /conversion/, /dönüşüm/, /match/, /tut/, /satış/, /sales/, /more/, /fazla/, /check/, /kontrol/)) return "meta_vs_orders";
  if (/google ads/.test(s) && has(s, /conversion/, /dönüşüm/, /match/, /tut/, /check/, /kontrol/)) return "gads_vs_orders";
  return null;
}

const NOT_IN_DATA = [
  [/product|ürün|categor|kategori/, "product"],
  [/return|iade|refund/, "return"],
  [/customer|müşteri|returning|tekrar gelen/, "customer"],
  [/weekday|day of the week|hangi günü|haftanın hangi|hafta gün/, "weekday"],
];

const outsideBody = () => ({ en: `${REFUSAL.outside.en} ${REFUSAL.coverage.en}`, tr: `${REFUSAL.outside.tr} ${REFUSAL.coverage.tr}` });
/** tables: the allowed tables besides the mart; with none, the body lists the mart's columns. */
export const exploreFailedRefusal = (tables = []) => ({ code: "explore_failed", heading: REFUSAL.explore_failed.heading, body: tables.length ? REFUSAL.explore_failed.body_tables(["daily_channel_device", ...tables].join(", ")) : REFUSAL.explore_failed.body(MART_COLUMNS.join(", ")), nearest: [EXPLORE_Q.weekday, EXPLORE_Q.channel_device, EXPLORE_Q.spend_growth] });

/**
 * What the question asks for.
 * @param {string} question
 * @param {{ lastCheck, lastAnswer, context, events, demo, data: { from, to }, pack }} pc
 */
export function route(question, pc) {
  const s = norm(question);
  const { pack } = pc;
  if (has(s, /as an event/, /olay olarak/)) {
    const ev = (pc.events ?? []).find((e) => e.type === "release" && e.date === RELEASE.date);
    if (!ev && pc.demo) return { kind: "propose_event", event: { date: RELEASE.date, title: RELEASE.label, type: "release", note: T("New checkout and thank-you page.", "Yeni ödeme ve teşekkür sayfası."), source: "agent" } };
  }
  if (has(s, /turn this into a metric/, /metriğe dönüştür/) && pc.lastAnswer?.explore) return { kind: "propose_metric", from: pc.lastAnswer };
  if (has(s, /turn this into a metric/, /metriğe dönüştür/)) {
    const m = REFUSAL.metric_howto;
    return { kind: "refusal", refusal: { code: "metric_howto", heading: m.heading, body: pc.demo === false ? m.own : m.demo, nearest: [] } };
  }
  for (const [re, missing] of NOT_IN_DATA) {
    if (!re.test(s)) continue;
    if (missing === "weekday") return { kind: "refusal", refusal: { code: "planner_unknown", heading: REFUSAL.heading, body: outsideBody(), nearest: [NEAR.revenue_channel_28, NEAR.aov_device_28, NEAR.gads_14] } };
    return { kind: "refusal", refusal: { code: "not_in_data", missing, heading: REFUSAL.no_product.heading, body: REFUSAL.no_product.body, nearest: [NEAR.revenue_channel_28, NEAR.aov_device_28] } };
  }

  const contextCheck = pc.context?.kind === "check" && pack.checks[pc.context.id] ? pc.context.id : null;
  const named = checkOf(s);

  if (has(s, /\bwatch\b/, /izle/)) return { kind: "propose_watch", check: named ?? contextCheck ?? pc.lastCheck?.check ?? "ga4_vs_orders" };
  if (has(s, /\bpin\b/, /dashboard.a ekle/, /panoya ekle/) && pc.lastAnswer) return { kind: "propose_pin" };

  if (has(s, /only on mobile/, /yalnızca mobil/, /sadece mobil/, /gap .*mobile/, /fark .*mobil/)) {
    const prev = pc.lastCheck;
    const check = prev?.check ?? contextCheck ?? "ga4_vs_orders";
    const p = prev ? { from: prev.from, to: prev.to } : periodOf(s, 14, pc.data);
    return { kind: "check_split", check, period: p };
  }
  if (has(s, /\bwhy\b/, /neden/) && (named || contextCheck || pc.lastCheck || has(s, /match|tut|gap|fark/))) {
    const check = named ?? contextCheck ?? pc.lastCheck?.check ?? "ga4_vs_orders";
    const p = pc.lastCheck && pc.lastCheck.check === check ? { from: pc.lastCheck.from, to: pc.lastCheck.to } : periodOf(s, 14, pc.data);
    return { kind: "why", check, period: p };
  }

  // On a metric page the question is about that metric unless it names another.
  const metric = metricOf(s) ?? (pc.context?.kind === "metric" && pack.metrics[pc.context.id] ? pc.context.id : null);
  const group = groupOf(s);
  if (named && metric !== "roas") return { kind: "check", check: named, period: periodOf(s, 14, pc.data) };
  if (metric) {
    const fallback = metric === "roas" || group === "channel" || group === "device" ? 28 : group === "week" ? 90 : 7;
    return { kind: "metric", metric, group: group ?? "none", period: periodOf(s, fallback, pc.data) };
  }
  if (contextCheck) return { kind: "check", check: contextCheck, period: periodOf(s, 14, pc.data) };
  return { kind: "refusal", refusal: { code: "planner_unknown", heading: REFUSAL.heading, body: outsideBody(), nearest: [NEAR.revenue_channel_last_month, NEAR.orders_channel_last_month, NEAR.gads_14] } };
}

// ---------------------------------------------------------------- sentences

const pct = (lang, r, signed = false) => f[lang].pct(r, 1, signed);
const abs = (r) => (r == null ? null : Math.abs(r));
/** Lower-cases a label for use mid-sentence, but keeps acronyms (ROAS, GA4). */
const mid = (label, lang) => (/^[A-ZÇĞİÖŞÜ0-9]{2}/.test(label) ? label : lang === "tr" ? label.toLocaleLowerCase("tr") : label.charAt(0).toLowerCase() + label.slice(1));
/** Lower-cases the first letter of a finding for "found that …", unless it starts a proper noun (Meta, GA4). */
const lowerFirst = (text) => (/^(Meta|GA4|Google|TikTok|AI )/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1));

/** "The gap is on mobile (−15.6%) from 9 Oct." only when one segment carries it and another adds up. */
function gapClause(c, lang) {
  const bad = c.breakdown.filter((b) => b.verdict === "does_not_add_up");
  const ok = c.breakdown.filter((b) => b.verdict === "adds_up");
  if (bad.length !== 1 || !ok.length) return "";
  const seg = bad[0];
  const since = c.out_of_tolerance_since;
  if (lang === "en") return ` The gap is on ${seg.key} (${pct("en", seg.delta_pct)})${since ? ` from ${enShort(since)}` : ""}.`;
  const name = seg.key === "mobile" ? "mobilde" : "masaüstünde";
  return ` Fark ${name} (${pct("tr", seg.delta_pct)})${since ? ` ve ${trFrom(since)} beri sürüyor` : ""}.`;
}

export function checkSentence(c, data) {
  const ok = c.verdict === "adds_up";
  const fewer = (c.delta_pct ?? 0) < 0;
  const t = { en: f.en.pct(c.tolerance, 0), tr: f.tr.pct(c.tolerance, 0) };
  const e = { en: f.en.value(c.expected.value, c.unit), tr: f.tr.value(c.expected.value, c.unit) };
  const m = { en: f.en.value(c.measured.value, c.unit), tr: f.tr.value(c.measured.value, c.unit) };
  const r = range2(c.from, c.to);
  const p = { en: pct("en", abs(c.delta_pct)), tr: pct("tr", abs(c.delta_pct)) };
  const inside = { en: ok ? `inside the ±${t.en} tolerance` : `outside the ±${t.en} tolerance`, tr: ok ? `kabul edilen ±⁠${t.tr} sapma içinde` : `kabul edilen ±⁠${t.tr} sapmanın dışında` };
  const head = { en: ok ? "Adds up." : "Does not add up.", tr: ok ? "Tutuyor." : "Tutmuyor." };
  if (c.verdict === "insufficient_data") return c.reason ?? T("There are no back-office orders in this period to compare with.", "Bu dönemde sipariş panelinde karşılaştırılacak sipariş yok.");
  const sinceStart = c.out_of_tolerance_since === data.from && !ok;
  switch (c.check) {
    case "ga4_vs_orders":
      return {
        en: `${head.en} GA4 recorded ${m.en} purchases against ${e.en} back-office orders for ${r.en}: ${p.en} ${fewer ? "fewer" : "more"}, ${inside.en}.${ok ? "" : gapClause(c, "en")}`,
        tr: `${head.tr} ${r.tr} döneminde sipariş panelinde ${e.tr} sipariş, GA4’te ${m.tr} satın alma var: GA4 ${p.tr} daha ${fewer ? "az" : "fazla"}, ${inside.tr}.${ok ? "" : gapClause(c, "tr")}`,
      };
    case "ga4_rev_vs_revenue":
      return {
        en: `${head.en} GA4 revenue is ${p.en} ${fewer ? "under" : "over"} back-office revenue for ${r.en}: ${m.en} against ${e.en}, ${inside.en}.${ok ? "" : gapClause(c, "en")}`,
        tr: `${head.tr} ${r.tr} döneminde GA4 geliri sipariş panelindeki cirodan ${p.tr} ${fewer ? "düşük" : "yüksek"}: ${e.tr} ciroya karşı ${m.tr}, ${inside.tr}.${ok ? "" : gapClause(c, "tr")}`,
      };
    default: {
      const platform = c.check === "meta_vs_orders" ? "Meta" : "Google Ads";
      const channel = c.check === "meta_vs_orders" ? "Meta Ads" : "Google Ads";
      const tail = sinceStart
        ? { en: ` The difference has been outside the tolerance on every day since data starts (${enShort(data.from)}).`, tr: ` Fark, verinin başladığı ${trFrom(data.from)} beri her gün kabul edilen sapmanın dışında.` }
        : { en: "", tr: "" };
      return {
        en: `${head.en} ${platform} reports ${m.en} conversions against ${e.en} back-office orders from ${channel} for ${r.en}: ${p.en} ${fewer ? "fewer" : "more"}, ${inside.en}.${tail.en}`,
        tr: `${head.tr} ${r.tr} döneminde ${platform} ${m.tr} dönüşüm bildiriyor, sipariş panelinde ${channel} kaynaklı ${e.tr} sipariş var: ${p.tr} ${fewer ? "eksik" : "fazla"}, ${inside.tr}.${tail.tr}`,
      };
    }
  }
}

function deviceSentence(c) {
  const mob = c.breakdown.find((b) => b.key === "mobile");
  const desk = c.breakdown.find((b) => b.key === "desktop");
  const t = { en: f.en.pct(c.tolerance, 0), tr: f.tr.pct(c.tolerance, 0) };
  const onlyMobile = mob.verdict === "does_not_add_up" && desk.verdict === "adds_up";
  return {
    en: `${onlyMobile ? "Yes. " : ""}On mobile GA4 recorded ${f.en.int(mob.measured)} purchases against ${f.en.int(mob.expected)} orders, ${pct("en", mob.delta_pct)}. On desktop ${f.en.int(desk.measured)} against ${f.en.int(desk.expected)}, ${pct("en", desk.delta_pct)}, ${desk.verdict === "adds_up" ? "inside" : "outside"} the ±${t.en} tolerance.`,
    tr: `${onlyMobile ? "Evet. " : ""}Mobilde sipariş panelinde ${f.tr.int(mob.expected)} sipariş, GA4’te ${f.tr.int(mob.measured)} satın alma var: ${pct("tr", mob.delta_pct)}. Masaüstünde ${f.tr.int(desk.expected)} siparişe karşı ${f.tr.int(desk.measured)} satın alma var: ${pct("tr", desk.delta_pct)}, kabul edilen ±⁠${t.tr} ${desk.verdict === "adds_up" ? "sapma içinde" : "sapmanın dışında"}.`,
  };
}

function whyText(c, data) {
  if (c.check === "ga4_vs_orders") {
    const mob = c.breakdown.find((b) => b.key === "mobile");
    const desk = c.breakdown.find((b) => b.key === "desktop");
    const r = range2(c.from, c.to);
    const fd = c.findings.find((x) => x.since) ?? null;
    // The release and the audit finding are named only when the data says so: the gap starts on the
    // finding's since-date and a finding is attached.
    const starts = c.out_of_tolerance_since;
    const onRelease = fd && starts === fd.since;
    return {
      en: `GA4 recorded ${pct("en", abs(c.delta_pct))} fewer purchases than the back office for ${r.en}. The gap is on mobile (${pct("en", mob.delta_pct)}); desktop is inside the tolerance (${pct("en", desk.delta_pct)}).${starts ? ` It starts on ${enShort(starts)}${onRelease ? `, the day of release ${fd.release ?? RELEASE.label.en.split(" ")[0]}` : ""}.` : ""}${onRelease ? ` AI Tag Debugger found that purchase is not sent on mobile Safari since ${fd.release ?? "v4.12"}.` : ""}`,
      tr: `${r.tr} döneminde GA4 sipariş paneline göre ${pct("tr", abs(c.delta_pct))} daha az satın alma kaydetti. Fark mobilde (${pct("tr", mob.delta_pct)}); masaüstü kabul edilen sapma içinde (${pct("tr", desk.delta_pct)}).${starts ? (onRelease ? ` Fark, ${fd.release ?? "v4.12"} sürümünün yayımlandığı ${trAt(starts)} başlıyor.` : ` Fark ${trLong(starts)} tarihinde başlıyor.`) : ""}${onRelease ? ` AI Tag Debugger, ${fd.release ?? "v4.12"}’den beri mobil Safari’de purchase gönderilmediğini buldu.` : ""}`,
    };
  }
  const fd = c.findings[0];
  const base = checkSentence(c, data);
  const strip = (x) => x.replace(/^(Does not add up|Tutmuyor)\. /, "");
  return {
    en: `${strip(base.en)}${fd ? ` AI Tag Debugger found that ${lowerFirst(fd.text.en)}` : ""}`,
    tr: `${strip(base.tr)}${fd ? ` AI Tag Debugger şunu buldu: ${fd.text.tr}` : ""}`,
  };
}

export function whyDetail(c) {
  const bad = c.breakdown.filter((b) => b.verdict === "does_not_add_up");
  const ok = c.breakdown.filter((b) => b.verdict === "adds_up");
  const seg = bad.length === 1 && ok.length ? bad[0] : null;
  const fd = c.findings.find((x) => x.since) ?? c.findings[0];
  const release = fd?.since && c.out_of_tolerance_since === fd.since ? fd.release ?? null : null;
  const ga4 = c.check === "ga4_vs_orders" || c.check === "ga4_rev_vs_revenue";
  return {
    started: c.out_of_tolerance_since,
    release,
    segment: seg ? { key: seg.key, delta_pct: seg.delta_pct, verdict: seg.verdict } : null,
    narrower: ga4 && fd ? T("mobile Safari", "mobil Safari") : null,
    next: ga4 ? WHY_NEXT.ga4 : c.check === "meta_vs_orders" ? WHY_NEXT.meta : WHY_NEXT.other,
  };
}

function splitSentence(pack, q) {
  const m = pack.metrics[q.metric];
  const r = range2(q.from, q.to);
  const v = (l, x) => f[l].value(x, q.unit);
  const rows = q.rows;
  const top = rows[0];
  if (q.total == null) return { en: `${m.label.en} · ${range2(q.from, q.to).en}: no data in this period.`, tr: `${m.label.tr} · ${range2(q.from, q.to).tr}: bu dönemde veri yok.` };
  if (q.metric === "roas" && top) {
    return {
      en: `ROAS for ${r.en} is ${v("en", q.total)} overall. ${dimName(top.key, "en")} leads at ${v("en", top.value)}${rows.length > 1 ? `, then ${rows.slice(1).map((x) => `${dimName(x.key, "en")} at ${v("en", x.value)}`).join(" and ")}` : ""}.`,
      tr: `${r.tr} döneminde genel ROAS ${v("tr", q.total)}. ${dimName(top.key, "tr")} ${v("tr", top.value)} ile önde${rows.length > 1 ? `; ardından ${rows.slice(1).map((x) => `${dimName(x.key, "tr")} ${v("tr", x.value)}`).join(" ve ")}` : ""}.`,
    };
  }
  if (!top) return both((l) => `${m.label[l]} · ${r[l]}`);
  const next = rows.slice(1, 3);
  return {
    en: `${m.label.en} for ${r.en}: ${v("en", q.total)}${m.unit === "pct" || m.unit === "ratio" || q.metric === "aov" ? " overall" : ""}. ${dimName(top.key, "en")} leads at ${v("en", top.value)}${next.length ? `, then ${next.map((x) => `${dimName(x.key, "en")} ${v("en", x.value)}`).join(" and ")}` : ""}.`,
    tr: `${r.tr} döneminde ${mid(m.label.tr, "tr")} ${v("tr", q.total)}. ${dimName(top.key, "tr")} ${v("tr", top.value)} ile önde${next.length ? `; ardından ${next.map((x) => `${dimName(x.key, "tr")} ${v("tr", x.value)}`).join(" ve ")}` : ""}.`,
  };
}

function numberSentence(pack, q, singleDay) {
  const m = pack.metrics[q.metric];
  const v = (l, x) => f[l].value(x ?? null, q.unit);
  const c = q.comparison;
  if (q.total == null) return { en: `${m.label.en} · ${range2(q.from, q.to).en}: no data in this period.`, tr: `${m.label.tr} · ${range2(q.from, q.to).tr}: bu dönemde veri yok.` };
  if (singleDay) {
    return {
      en: `${m.label.en} on ${f.en.date(q.from, true)}, the last full day with data: ${v("en", q.total)}.${c ? ` ${c.delta != null && c.delta >= 0 ? "Up" : "Down"} ${pct("en", abs(c.delta_pct))} against ${v("en", c.total)} on ${f.en.date(c.from)}.` : ""}`,
      tr: `Verinin olduğu son tam gün olan ${f.tr.date(q.from, true)} tarihinde ${mid(m.label.tr, "tr")}: ${v("tr", q.total)}.${c ? ` ${f.tr.date(c.from)} tarihindeki ${v("tr", c.total)} değerine göre ${pct("tr", abs(c.delta_pct))} ${c.delta != null && c.delta >= 0 ? "arttı" : "azaldı"}.` : ""}`,
    };
  }
  if (!c) return both((l) => `${m.label[l]} · ${range2(q.from, q.to)[l]}: ${v(l, q.total)}.`);
  const up = (c.delta ?? 0) >= 0;
  return {
    en: `${m.label.en} for ${range2(q.from, q.to).en} was ${v("en", q.total)}, ${up ? "up" : "down"} ${pct("en", abs(c.delta_pct))} against ${v("en", c.total)} for ${range2(c.from, c.to).en}.`,
    tr: `${range2(q.from, q.to).tr} döneminde ${mid(m.label.tr, "tr")} ${v("tr", q.total)}; ${range2(c.from, c.to).tr} dönemindeki ${v("tr", c.total)} değerine göre ${pct("tr", abs(c.delta_pct))} ${up ? "arttı" : "azaldı"}.`,
  };
}

/** An answer names a campaign or price change in its period, so a spike reads with its cause beside it. */
function withEvent(t, q, events) {
  if (!["revenue", "orders", "aov", "sessions"].includes(q.metric) || q.from === q.to) return t;
  const ev = events.filter((e) => (e.type === "campaign" || e.type === "price_change") && e.date >= q.from && e.date <= q.to).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!ev) return t;
  const kind = { en: ev.type === "campaign" ? "a campaign" : "a price change", tr: ev.type === "campaign" ? "kampanya" : "fiyat değişikliği" };
  return {
    en: `${t.en} ${ev.title.en} (${enShort(ev.date)}, ${kind.en}) falls in this period and lines up with the higher days after it.`,
    tr: `${t.tr} ${ev.title.tr} (${trLong(ev.date)}, ${kind.tr}) bu döneme düşüyor ve sonrasındaki yüksek günlerle örtüşüyor.`,
  };
}

function seriesSentence(pack, q) {
  const m = pack.metrics[q.metric];
  const v = (l, x) => f[l].value(x, q.unit);
  const vals = q.rows.filter((r) => r.value != null);
  if (!vals.length) return both((l) => `${m.label[l]} · ${range2(q.from, q.to)[l]}: ${v(l, q.total)}.`);
  const min = vals.reduce((a, b) => (b.value < a.value ? b : a), vals[0]);
  const max = vals.reduce((a, b) => (b.value > a.value ? b : a), vals[0]);
  const weeks = q.group_by === "week";
  const totalWord = m.unit === "count" || m.unit === "try";
  const unitWord = { en: weeks ? "Weekly" : q.group_by === "month" ? "Monthly" : "Daily", tr: weeks ? "Haftalık" : q.group_by === "month" ? "Aylık" : "Günlük" };
  return {
    en: `${m.label.en} for ${range2(q.from, q.to).en}${weeks ? `, ${vals.length} complete weeks` : ""}: ${v("en", q.total)}${totalWord ? " in total" : " overall"}. ${unitWord.en} figures ran from ${v("en", min.value)} (${f.en.date(min.key)}) to ${v("en", max.value)} (${f.en.date(max.key)}).`,
    tr: `${range2(q.from, q.to).tr} döneminde${weeks ? `, ${vals.length} tam haftada` : ""} ${mid(m.label.tr, "tr")} ${totalWord ? "toplam " : ""}${v("tr", q.total)}. ${unitWord.tr} değerler ${v("tr", min.value)} (${f.tr.date(min.key)}) ile ${v("tr", max.value)} (${f.tr.date(max.key)}) arasında.`,
  };
}

// ---------------------------------------------------------------- answers

const READINGS = {
  ga4_vs_orders: T("orders and GA4 purchases", "siparişler ve GA4 satın almaları"),
  ga4_rev_vs_revenue: T("revenue and GA4 revenue", "ciro ve GA4 geliri"),
  meta_vs_orders: T("orders from Meta Ads and Meta conversions", "Meta Ads kaynaklı siparişler ve Meta dönüşümleri"),
  gads_vs_orders: T("orders from Google Ads and Google Ads conversions", "Google Ads kaynaklı siparişler ve Google Ads dönüşümleri"),
};
const CHECK_FOLLOWUPS = {
  ga4_vs_orders: [FOLLOW.mobile, FOLLOW.why, FOLLOW.meta],
  ga4_rev_vs_revenue: [FOLLOW.ga4, FOLLOW.revenue_week],
  meta_vs_orders: [FOLLOW.why_meta, FOLLOW.watch_meta, FOLLOW.gads],
  gads_vs_orders: [FOLLOW.watch_gads, FOLLOW.meta],
};
const WHY_FOLLOWUPS = {
  ga4_vs_orders: [FOLLOW.watch_ga4, FOLLOW.meta, FOLLOW.revenue_week],
  ga4_rev_vs_revenue: [FOLLOW.watch_ga4, FOLLOW.ga4, FOLLOW.meta],
  meta_vs_orders: [FOLLOW.watch_meta, FOLLOW.ga4, FOLLOW.roas],
  gads_vs_orders: [FOLLOW.watch_gads, FOLLOW.ga4, FOLLOW.meta],
};

export const metricRef = (pack, id) => {
  const m = pack.metrics[id];
  return { id, label: m.label, version: m.version, description: m.description, source: m.source };
};

function querySteps(pack, query, check) {
  const out = [{ tool: "run_query", summary: STEP.run_query(pack.metrics[query.metric].label, GROUPING[query.group_by], range2(query.from, query.to)), ok: true }];
  if (check) out.push({ tool: "reconcile", summary: STEP.reconcile(pack.checks[check.check].label), ok: true });
  out.push({ tool: "publish_answer", summary: STEP.publish, ok: true });
  return out;
}

async function checkAnswer(ctx, pc, check, period, opts = {}) {
  const { pack } = pc;
  const c = opts.check ?? (await runReconcile(ctx, { check, from: period.from, to: period.to }));
  const ck = pack.checks[check];
  const group = opts.kind === "check_split" || opts.kind === "why" ? "device" : "day";
  const query = await runQuery(ctx, { metric: ck.expected.metric, group_by: group, from: c.from, to: c.to, filters: ck.where ?? undefined });
  const reading = both((l) => `${READINGS[check][l]}, ${GROUPING[group][l]}, ${range2(c.from, c.to)[l]}`);
  return {
    kind: "answer",
    steps: querySteps(pack, query, c),
    answer: {
      kind: opts.kind ?? "check",
      sentence: opts.sentence ?? checkSentence(c, pc.data),
      title: both((l) => `${ck.label[l]} · ${range2(c.from, c.to)[l]}`),
      followups: opts.followups ?? CHECK_FOLLOWUPS[check],
      interpretation: READ_AS(reading),
      query,
      check: c,
      metrics: [metricRef(pack, ck.expected.metric), metricRef(pack, ck.measured.metric)],
      events: [],
      overall: opts.overall ? { delta_pct: opts.overall.delta_pct, verdict: opts.overall.verdict } : null,
      why: opts.why ?? null,
    },
  };
}

async function metricAnswer(ctx, pc, metric, group, p) {
  const { pack } = pc;
  const g = group ?? "none";
  const singleDay = p.from === p.to;
  const compare = ["none", "day", "channel", "device"].includes(g) ? "previous_period" : undefined;
  const q = await runQuery(ctx, { metric, group_by: g, from: p.from, to: p.to, compare, month_to_date: p.key === "this_month" });
  const kind = g === "none" ? "number" : g === "channel" || g === "device" ? "split" : "series";
  const base = kind === "number" ? numberSentence(pack, q, singleDay) : kind === "split" ? splitSentence(pack, q) : seriesSentence(pack, q);
  const sentence = withEvent(base, q, pc.events ?? []);
  const reading = both((l) => `${mid(pack.metrics[metric].label[l], l)}, ${GROUPING[g][l]}, ${range2(q.from, q.to)[l]}`);
  const followups = metric === "roas" ? [FOLLOW.spend, FOLLOW.revenue_channel] : metric === "revenue" ? [FOLLOW.revenue_channel, FOLLOW.ga4] : metric === "orders" ? [FOLLOW.orders_device, FOLLOW.ga4] : [FOLLOW.roas, FOLLOW.ga4];
  return {
    kind: "answer",
    steps: querySteps(pack, q),
    answer: {
      kind,
      sentence,
      title: both((l) => `${pack.metrics[metric].label[l]} · ${range2(q.from, q.to)[l]}`),
      followups,
      interpretation: READ_AS(reading),
      query: q,
      check: null,
      metrics: [metricRef(pack, metric)],
      events: [],
    },
  };
}

/**
 * Runs a route.
 * @returns {Promise<{ kind: "answer", answer, steps } | { kind: "refusal", refusal } | { kind: "propose_*", … }>}
 */
export async function execute(ctx, r, pc) {
  const { pack } = pc;
  switch (r.kind) {
    case "check":
      return checkAnswer(ctx, pc, r.check, r.period);
    case "check_split": {
      const c = await runReconcile(ctx, { check: r.check, from: r.period.from, to: r.period.to });
      // The answer is about the segment: its headline, Δ and tally are mobile's; the whole check moves to one line.
      const mobile = await runReconcile(ctx, { check: r.check, from: r.period.from, to: r.period.to, filters: { device: ["mobile"] } });
      const segment = ctx.store.saveCheck({ ...mobile, label: both((l) => `${pack.checks[r.check].label[l]} · ${l === "en" ? "mobile" : "mobil"}`), breakdown: c.breakdown, breakdown_by: c.breakdown_by });
      return checkAnswer(ctx, pc, r.check, r.period, { kind: "check_split", sentence: r.check === "ga4_vs_orders" ? deviceSentence(c) : checkSentence(c, pc.data), followups: [FOLLOW.why, FOLLOW.watch_ga4, FOLLOW.meta], check: segment, overall: c });
    }
    case "why": {
      const c = await runReconcile(ctx, { check: r.check, from: r.period.from, to: r.period.to });
      if (c.verdict !== "does_not_add_up") return checkAnswer(ctx, pc, r.check, r.period, { check: c });
      // With no event on the day it started, the agent offers to add the release as one.
      const noEvent = !(pc.events ?? []).some((e) => e.date === c.out_of_tolerance_since);
      const offerEvent = noEvent && r.check.startsWith("ga4") && pc.demo;
      return checkAnswer(ctx, pc, r.check, r.period, { kind: "why", check: c, sentence: whyText(c, pc.data), why: whyDetail(c), followups: offerEvent ? [FOLLOW.add_event, ...WHY_FOLLOWUPS[r.check]] : WHY_FOLLOWUPS[r.check] });
    }
    case "metric":
      return metricAnswer(ctx, pc, r.metric, r.group, r.period);
    default:
      return r;
  }
}

/** What a question would do, so two phrasings of the same request count as one. Needs the warehouse only for "why". */
export async function signature(ctx, r, pc) {
  const pack = pc.pack;
  if (r.kind === "refusal") return r.refusal.code === "metric_howto" ? "howto" : null;
  if (r.kind === "propose_watch") return `watch|${r.check}`;
  if (r.kind === "propose_pin") return "pin";
  if (r.kind === "propose_event") return `event|${r.event.date}`;
  if (r.kind === "propose_metric") return "metric_proposal";
  const clampP = (p) => {
    let from = p.from < pc.data.from ? pc.data.from : p.from > pc.data.to ? pc.data.to : p.from;
    let to = p.to > pc.data.to ? pc.data.to : p.to < pc.data.from ? pc.data.from : p.to;
    if (from > to) [from, to] = [to, from];
    return { from, to };
  };
  if (r.kind === "check") {
    const p = clampP(r.period);
    return `check|${r.check}|${p.from}|${p.to}|null`;
  }
  if (r.kind === "check_split") {
    const p = clampP(r.period);
    return `check_split|${r.check}|${p.from}|${p.to}|"mobile"`;
  }
  if (r.kind === "why") {
    const p = clampP(r.period);
    const c = await runReconcile(ctx, { check: r.check, from: p.from, to: p.to }, { save: false });
    return `${c.verdict === "does_not_add_up" ? "why" : "check"}|${r.check}|${p.from}|${p.to}|null`;
  }
  if (r.kind === "metric") {
    const q = resolveQuery(pack, { metric: r.metric, group_by: r.group, from: r.period.from, to: r.period.to }, pc.data);
    const kind = r.group === "none" ? "number" : r.group === "channel" || r.group === "device" ? "split" : "series";
    return `${kind}|${q.metric}|${q.group_by}|${q.from}|${q.to}`;
  }
  return null;
}

/** The signature of an answer already given, in the same terms as signature(). */
export function answerSignature(a) {
  if (a.explore) return `explore|${JSON.stringify(a.explore.spec)}`;
  const c = a.check;
  if (c) return `${a.kind}|${c.check}|${c.from}|${c.to}|${JSON.stringify(c.filters?.device ?? null)}`;
  return `${a.kind}|${a.query.metric}|${a.query.group_by}|${a.query.from}|${a.query.to}`;
}

export { PLANNER_LABEL, monthStart };
