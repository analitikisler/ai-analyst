// The built-in planner as the prototype shows it: the target behaviour of B05 (09-ux.md §2 F1 to F3, §4.2),
// not today's bugs. Every figure comes from the demo mart through engine.ts; every sentence is a §4.2 template in
// both languages. Routes that today's planner gets wrong (the device follow-up, "why", "yesterday", "last week",
// revenue without an unasked check, colloquial phrasings, watch and pin proposals, refusals) are marked
// `handmade: true` on the answer, so a reviewer can tell them from captured behaviour.
import { addDays } from "@/lib/dates";
import type { Answer, AnswerKind, AskContext, CheckId, CheckResult, GroupBy, Lang, MetricId, MetricRef, PeriodKey, QueryResult, Refusal, Step, Text } from "../types";
import { newId, RANGE, RELEASE, reconcile, resolvePeriod, runQuery } from "./engine";
import { CHECKS, METRICS } from "./pack";
import { trLong } from "./text";
import { both, enShort, EXPLORE_Q, f, FOLLOW, GROUPING, NEAR, READ_AS, REFUSAL, STEP, T, trFrom, WHY_NEXT } from "./text";
import { exploreQuery, MART_COLUMNS, runExplore } from "./explore";
import type { ChartEvent, ExploreResult, ExploreSpec } from "../types";

export interface PlanContext {
  /** The last check answered in this conversation, for "Is the gap only on mobile?". */
  lastCheck: CheckResult | null;
  lastAnswer: Answer | null;
  context: AskContext | null;
  model: { label: Text } | null;
  /** A model is set and exploratory answers are on: questions outside the metric set get one read-only query. */
  explore?: boolean;
  /** The data source, for the "turn this into a metric" note. */
  demo?: boolean;
  /** Events (Settings › Events): an answer names one that falls in its spike or gap. */
  events?: ChartEvent[];
}

export type Plan =
  | { kind: "answer"; answer: Omit<Answer, "id" | "turn_id" | "question" | "created_at">; steps: Step[] }
  | { kind: "propose_watch"; check: CheckId; steps: Step[] }
  | { kind: "propose_pin"; steps: Step[] }
  | { kind: "propose_event"; event: Omit<ChartEvent, "id">; steps: Step[] }
  | { kind: "propose_metric"; from: Answer; steps: Step[] }
  | { kind: "refusal"; refusal: Refusal };

// ---------------------------------------------------------------- reading the question

const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/[’'`]/g, "'");
const has = (s: string, ...res: RegExp[]) => res.some((r) => r.test(s));

interface Period {
  from: string;
  to: string;
  label: Text;
  key?: PeriodKey;
  monthToDate?: boolean;
}

function periodOf(s: string, fallbackDays: number): Period {
  const days = /(?:last|past|son)\s+(\d{1,3})\s*(?:days?|gün)/.exec(s);
  if (days) {
    const n = Math.min(Number(days[1]), 90);
    return { from: addDays(RANGE.to, -(n - 1)), to: RANGE.to, label: both((l) => (l === "en" ? `last ${n} days` : `son ${n} gün`)) };
  }
  if (has(s, /yesterday/, /\bdün\b/)) return { from: RANGE.to, to: RANGE.to, label: T("the last full day", "son tam gün") };
  if (has(s, /last week/, /geçen hafta/)) {
    const p = resolvePeriod("last_week");
    return { ...p, key: "last_week", label: T("last complete week", "geçen tam hafta") };
  }
  if (has(s, /this month/, /\bbu ay/)) {
    const p = resolvePeriod("this_month");
    return { ...p, key: "this_month", label: T("this month", "bu ay") };
  }
  if (has(s, /last month/, /geçen ay/)) {
    const p = resolvePeriod("last_month");
    return { ...p, key: "last_month", label: T("last month", "geçen ay") };
  }
  if (has(s, /9.22 (oct|eki)/)) return { from: "2026-10-09", to: "2026-10-22", label: T("9–22 Oct", "9–22 Eki") };
  return { from: addDays(RANGE.to, -(fallbackDays - 1)), to: RANGE.to, label: both((l) => (l === "en" ? `last ${fallbackDays} days` : `son ${fallbackDays} gün`)) };
}

function metricOf(s: string): MetricId | null {
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

function groupOf(s: string): GroupBy | null {
  if (has(s, /by channel/, /which channel/, /channels/, /kanal/)) return "channel";
  if (has(s, /by device/, /mobile .*desktop/, /desktop .*mobile/, /cihaz/, /mobil.*masaüstü/, /masaüstü/)) return "device";
  if (has(s, /by week/, /weekly/, /haftalık/)) return "week";
  if (has(s, /by month/, /monthly/, /aylık/)) return "month";
  if (has(s, /by day/, /daily/, /günlük/)) return "day";
  return null;
}

function checkOf(s: string): CheckId | null {
  const ga4 = /\bga4\b/.test(s);
  if (ga4 && has(s, /revenue/, /ciro/, /gelir/)) return "ga4_rev_vs_revenue";
  if (ga4) return "ga4_vs_orders";
  if (/\bmeta\b/.test(s) && has(s, /conversion/, /dönüşüm/, /match/, /tut/, /satış/, /sales/, /more/, /fazla/, /check/, /kontrol/)) return "meta_vs_orders";
  if (/google ads/.test(s) && has(s, /conversion/, /dönüşüm/, /match/, /tut/, /check/, /kontrol/)) return "gads_vs_orders";
  return null;
}

const NOT_IN_DATA: [RegExp, Refusal["missing"]][] = [
  [/product|ürün|categor|kategori/, "product"],
  [/return|iade|refund/, "return"],
  [/customer|müşteri|returning|tekrar gelen/, "customer"],
  [/weekday|day of the week|hangi günü|haftanın hangi|hafta gün/, "weekday"],
];

// ---------------------------------------------------------------- building answers

const metricRef = (id: MetricId): MetricRef => {
  const m = METRICS[id];
  return { id, label: m.label, version: m.version, description: m.description, source: m.source };
};

/** Lower-cases a label for use mid-sentence, but keeps acronyms (ROAS, GA4). */
const mid = (label: string, lang: Lang) => (/^[A-ZÇĞİÖŞÜ0-9]{2}/.test(label) ? label : lang === "tr" ? label.toLocaleLowerCase("tr") : label.charAt(0).toLowerCase() + label.slice(1));

const range = (from: string, to: string): Text => ({ en: f.en.range(from, to), tr: f.tr.range(from, to) });

function steps(query: QueryResult, check?: CheckResult): Step[] {
  const out: Step[] = [{ tool: "run_query", summary: STEP.run_query(METRICS[query.metric].label, GROUPING[query.group_by]!, range(query.from, query.to)), ok: true }];
  if (check) out.push({ tool: "reconcile", summary: STEP.reconcile(CHECKS[check.check].label), ok: true });
  out.push({ tool: "publish_answer", summary: STEP.publish, ok: true });
  return out;
}

/** Events are global (Settings › Events) and every chart draws the ones in its range, so answers carry none. */
const events = (_c: CheckResult): Answer["events"] => [];

const pct = (lang: Lang, r: number | null, signed = false) => f[lang].pct(r, 1, signed);
const abs = (r: number | null) => (r == null ? null : Math.abs(r));

/** "The gap is on mobile (−15.6%) from 9 Oct." only when one segment carries it and another adds up. */
function gapClause(c: CheckResult, lang: Lang): string {
  const bad = c.breakdown.filter((b) => b.verdict === "does_not_add_up");
  const ok = c.breakdown.filter((b) => b.verdict === "adds_up");
  if (bad.length !== 1 || !ok.length) return "";
  const seg = bad[0]!;
  const since = c.out_of_tolerance_since;
  if (lang === "en") return ` The gap is on ${seg.key} (${pct("en", seg.delta_pct)})${since ? ` from ${enShort(since)}` : ""}.`;
  const name = seg.key === "mobile" ? "mobilde" : "masaüstünde";
  return ` Fark ${name} (${pct("tr", seg.delta_pct)})${since ? ` ve ${trFrom(since)} beri sürüyor` : ""}.`;
}

function checkSentence(c: CheckResult): Text {
  const ok = c.verdict === "adds_up";
  const fewer = (c.delta_pct ?? 0) < 0;
  const t = { en: f.en.pct(c.tolerance, 0), tr: f.tr.pct(c.tolerance, 0) };
  const e = { en: f.en.value(c.expected.value, c.unit), tr: f.tr.value(c.expected.value, c.unit) };
  const m = { en: f.en.value(c.measured.value, c.unit), tr: f.tr.value(c.measured.value, c.unit) };
  const r = range(c.from, c.to);
  const p = { en: pct("en", abs(c.delta_pct)), tr: pct("tr", abs(c.delta_pct)) };
  const inside = { en: ok ? `inside the ±${t.en} tolerance` : `outside the ±${t.en} tolerance`, tr: ok ? `kabul edilen ±\u2060${t.tr} sapma içinde` : `kabul edilen ±\u2060${t.tr} sapmanın dışında` };
  const head = { en: ok ? "Adds up." : "Does not add up.", tr: ok ? "Tutuyor." : "Tutmuyor." };
  if (c.verdict === "insufficient_data") {
    return T("There are no back-office orders in this period to compare with.", "Bu dönemde sipariş panelinde karşılaştırılacak sipariş yok.");
  }
  const sinceStart = c.out_of_tolerance_since === RANGE.from && !ok;
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
    case "meta_vs_orders":
    case "gads_vs_orders": {
      const platform = c.check === "meta_vs_orders" ? "Meta" : "Google Ads";
      const channel = c.check === "meta_vs_orders" ? "Meta Ads" : "Google Ads";
      const tail = sinceStart
        ? {
            en: ` The difference has been outside the tolerance on every day since data starts (${enShort(RANGE.from)}).`,
            tr: ` Fark, verinin başladığı ${trFrom(RANGE.from)} beri her gün kabul edilen sapmanın dışında.`,
          }
        : { en: "", tr: "" };
      return {
        en: `${head.en} ${platform} reports ${m.en} conversions against ${e.en} back-office orders from ${channel} for ${r.en}: ${p.en} ${fewer ? "fewer" : "more"}, ${inside.en}.${tail.en}`,
        tr: `${head.tr} ${r.tr} döneminde ${platform} ${m.tr} dönüşüm bildiriyor, sipariş panelinde ${channel} kaynaklı ${e.tr} sipariş var: ${p.tr} ${fewer ? "eksik" : "fazla"}, ${inside.tr}.${tail.tr}`,
      };
    }
  }
}

const READINGS: Record<CheckId, Text> = {
  ga4_vs_orders: T("orders and GA4 purchases", "siparişler ve GA4 satın almaları"),
  ga4_rev_vs_revenue: T("revenue and GA4 revenue", "ciro ve GA4 geliri"),
  meta_vs_orders: T("orders from Meta Ads and Meta conversions", "Meta Ads kaynaklı siparişler ve Meta dönüşümleri"),
  gads_vs_orders: T("orders from Google Ads and Google Ads conversions", "Google Ads kaynaklı siparişler ve Google Ads dönüşümleri"),
};

const CHECK_FOLLOWUPS: Record<CheckId, Text[]> = {
  ga4_vs_orders: [FOLLOW.mobile, FOLLOW.why, FOLLOW.meta],
  ga4_rev_vs_revenue: [FOLLOW.ga4, FOLLOW.revenue_week],
  meta_vs_orders: [FOLLOW.why_meta, FOLLOW.watch_meta, FOLLOW.gads],
  gads_vs_orders: [FOLLOW.watch_gads, FOLLOW.meta],
};

function checkAnswer(check: CheckId, p: Period, ctx: PlanContext, opts: { kind?: AnswerKind; sentence?: Text; followups?: Text[]; handmade?: boolean; check?: CheckResult; overall?: CheckResult; why?: Answer["why"] } = {}): Plan {
  const c = opts.check ?? reconcile(check, p.from, p.to);
  const ck = CHECKS[check];
  const query = runQuery({ metric: ck.expected.metric, group_by: opts.kind === "check_split" || opts.kind === "why" ? "device" : "day", from: c.from, to: c.to, filters: ck.where ?? undefined });
  const reading = both((l) => `${READINGS[check][l]}, ${GROUPING[opts.kind === "check_split" || opts.kind === "why" ? "device" : "day"]![l]}, ${range(c.from, c.to)[l]}`);
  return {
    kind: "answer",
    steps: steps(query, c),
    answer: {
      kind: opts.kind ?? "check",
      sentence: opts.sentence ?? checkSentence(c),
      title: both((l) => `${ck.label[l]} · ${range(c.from, c.to)[l]}`),
      followups: opts.followups ?? CHECK_FOLLOWUPS[check],
      interpretation: ctx.model ? null : READ_AS(reading),
      query,
      check: c,
      metrics: [metricRef(ck.expected.metric), metricRef(ck.measured.metric)],
      events: events(c),
      validation: { ok: true, unmatched: [] },
      created_by: ctx.model ? "agent" : "planner",
      model_label: ctx.model?.label ?? T("Built-in planner", "Yerleşik planlayıcı"),
      seconds: ctx.model ? 3.2 : 0.4,
      handmade: opts.handmade,
      overall: opts.overall ? { delta_pct: opts.overall.delta_pct, verdict: opts.overall.verdict } : null,
      why: opts.why ?? null,
    },
  };
}

function deviceSentence(c: CheckResult): Text {
  const [mob, desk] = [c.breakdown.find((b) => b.key === "mobile")!, c.breakdown.find((b) => b.key === "desktop")!];
  const t = { en: f.en.pct(c.tolerance, 0), tr: f.tr.pct(c.tolerance, 0) };
  const onlyMobile = mob.verdict === "does_not_add_up" && desk.verdict === "adds_up";
  return {
    en: `${onlyMobile ? "Yes. " : ""}On mobile GA4 recorded ${f.en.int(mob.measured)} purchases against ${f.en.int(mob.expected)} orders, ${pct("en", mob.delta_pct)}. On desktop ${f.en.int(desk.measured)} against ${f.en.int(desk.expected)}, ${pct("en", desk.delta_pct)}, ${desk.verdict === "adds_up" ? "inside" : "outside"} the ±${t.en} tolerance.`,
    tr: `${onlyMobile ? "Evet. " : ""}Mobilde sipariş panelinde ${f.tr.int(mob.expected)} sipariş, GA4’te ${f.tr.int(mob.measured)} satın alma var: ${pct("tr", mob.delta_pct)}. Masaüstünde ${f.tr.int(desk.expected)} siparişe karşı ${f.tr.int(desk.measured)} satın alma var: ${pct("tr", desk.delta_pct)}, kabul edilen ±\u2060${t.tr} ${desk.verdict === "adds_up" ? "sapma içinde" : "sapmanın dışında"}.`,
  };
}

function whySentence(c: CheckResult): Text {
  const mob = c.breakdown.find((b) => b.key === "mobile")!;
  const desk = c.breakdown.find((b) => b.key === "desktop")!;
  const r = range(c.from, c.to);
  return {
    en: `GA4 recorded ${pct("en", abs(c.delta_pct))} fewer purchases than the back office for ${r.en}. The gap is on mobile (${pct("en", mob.delta_pct)}); desktop is inside the tolerance (${pct("en", desk.delta_pct)}). It starts on ${enShort(RELEASE.date)}, the day of release v4.12. AI Tag Debugger found that purchase is not sent on mobile Safari since v4.12.`,
    tr: `${r.tr} döneminde GA4 sipariş paneline göre ${pct("tr", abs(c.delta_pct))} daha az satın alma kaydetti. Fark mobilde (${pct("tr", mob.delta_pct)}); masaüstü kabul edilen sapma içinde (${pct("tr", desk.delta_pct)}). Fark, v4.12 sürümünün yayımlandığı 9 Ekim’de başlıyor. AI Tag Debugger, v4.12’den beri mobil Safari’de purchase gönderilmediğini buldu.`,
  };
}

/** The "why" sentence: what is wrong and since when, then what the tag audit found. */
function whyText(c: CheckResult): Text {
  if (c.check === "ga4_vs_orders") return whySentence(c);
  const fd = c.findings[0];
  const base = checkSentence(c);
  const strip = (x: string) => x.replace(/^(Does not add up|Tutmuyor)\. /, "");
  return {
    en: `${strip(base.en)}${fd ? ` AI Tag Debugger found that ${fd.text.en.charAt(0).toLowerCase()}${fd.text.en.slice(1)}` : ""}`,
    tr: `${strip(base.tr)}${fd ? ` AI Tag Debugger şunu buldu: ${fd.text.tr}` : ""}`,
  };
}

function whyDetail(c: CheckResult): Answer["why"] {
  const bad = c.breakdown.filter((b) => b.verdict === "does_not_add_up");
  const ok = c.breakdown.filter((b) => b.verdict === "adds_up");
  const seg = bad.length === 1 && ok.length ? bad[0]! : null;
  const fd = c.findings.find((x) => x.since) ?? c.findings[0];
  const release = fd?.since && c.out_of_tolerance_since === fd.since ? RELEASE.label.en.split(" ")[0]! : null;
  const ga4 = c.check === "ga4_vs_orders" || c.check === "ga4_rev_vs_revenue";
  return {
    started: c.out_of_tolerance_since,
    release,
    segment: seg ? { key: seg.key, delta_pct: seg.delta_pct, verdict: seg.verdict } : null,
    narrower: ga4 && fd ? T("mobile Safari", "mobil Safari") : null,
    next: ga4 ? WHY_NEXT.ga4! : c.check === "meta_vs_orders" ? WHY_NEXT.meta! : WHY_NEXT.other!,
  };
}

const WHY_FOLLOWUPS: Record<CheckId, Text[]> = {
  ga4_vs_orders: [FOLLOW.watch_ga4, FOLLOW.meta, FOLLOW.revenue_week],
  ga4_rev_vs_revenue: [FOLLOW.watch_ga4, FOLLOW.ga4, FOLLOW.meta],
  meta_vs_orders: [FOLLOW.watch_meta, FOLLOW.ga4, FOLLOW.roas],
  gads_vs_orders: [FOLLOW.watch_gads, FOLLOW.ga4, FOLLOW.meta],
};

const dimName = (key: string, lang: Lang): string => {
  const names: Record<string, Text> = {
    organic: T("Organic search", "Organik arama"),
    direct: T("Direct", "Doğrudan"),
    google_ads: T("Google Ads", "Google Ads"),
    meta_ads: T("Meta Ads", "Meta Ads"),
    tiktok_ads: T("TikTok Ads", "TikTok Ads"),
    email: T("Email", "E-posta"),
    mobile: T("Mobile", "Mobil"),
    desktop: T("Desktop", "Masaüstü"),
  };
  return names[key]?.[lang] ?? key;
};

function splitSentence(q: QueryResult): Text {
  const m = METRICS[q.metric];
  const r = range(q.from, q.to);
  const v = (l: Lang, x: number | null) => f[l].value(x, q.unit);
  const rows = q.rows;
  const top = rows[0];
  if (q.metric === "roas") {
    return {
      en: `ROAS for ${r.en} is ${v("en", q.total)} overall. ${dimName(rows[0]!.key, "en")} leads at ${v("en", rows[0]!.value)}${rows.length > 1 ? `, then ${rows.slice(1).map((x, i) => `${i === rows.length - 2 && rows.length > 2 ? "" : ""}${dimName(x.key, "en")} at ${v("en", x.value)}`).join(" and ")}` : ""}.`,
      tr: `${r.tr} döneminde genel ROAS ${v("tr", q.total)}. ${dimName(rows[0]!.key, "tr")} ${v("tr", rows[0]!.value)} ile önde${rows.length > 1 ? `; ardından ${rows.slice(1).map((x) => `${dimName(x.key, "tr")} ${v("tr", x.value)}`).join(" ve ")}` : ""}.`,
    };
  }
  if (!top) return both((l) => `${m.label[l]} · ${r[l]}`);
  const next = rows.slice(1, 3);
  const last = null as { key: string; value: number | null } | null;
  return {
    en: `${m.label.en} for ${r.en}: ${v("en", q.total)}${m.unit === "pct" || m.unit === "ratio" || q.metric === "aov" ? " overall" : ""}. ${dimName(top.key, "en")} leads at ${v("en", top.value)}${next.length ? `, then ${next.map((x) => `${dimName(x.key, "en")} ${v("en", x.value)}`).join(" and ")}` : ""}${last ? `; ${dimName(last.key, "en")} ${v("en", last.value)}` : ""}.`,
    tr: `${r.tr} döneminde ${mid(m.label.tr, "tr")} ${v("tr", q.total)}. ${dimName(top.key, "tr")} ${v("tr", top.value)} ile önde${next.length ? `; ardından ${next.map((x) => `${dimName(x.key, "tr")} ${v("tr", x.value)}`).join(" ve ")}` : ""}${last ? `; ${dimName(last.key, "tr")} ${v("tr", last.value)}` : ""}.`,
  };
}

function numberSentence(q: QueryResult, singleDay: boolean): Text {
  const m = METRICS[q.metric];
  const v = (l: Lang, x: number | null | undefined) => f[l].value(x ?? null, q.unit);
  const c = q.comparison;
  if (singleDay) {
    return {
      en: `${m.label.en} on ${f.en.date(q.from, true)}, the last full day with data: ${v("en", q.total)}.${c ? ` ${c.delta != null && c.delta >= 0 ? "Up" : "Down"} ${pct("en", abs(c.delta_pct))} against ${v("en", c.total)} on ${f.en.date(c.from)}.` : ""}`,
      tr: `Verinin olduğu son tam gün olan ${f.tr.date(q.from, true)} tarihinde ${mid(m.label.tr, "tr")}: ${v("tr", q.total)}.${c ? ` ${f.tr.date(c.from)} tarihindeki ${v("tr", c.total)} değerine göre ${pct("tr", abs(c.delta_pct))} ${c.delta != null && c.delta >= 0 ? "arttı" : "azaldı"}.` : ""}`,
    };
  }
  if (!c) return both((l) => `${m.label[l]} · ${range(q.from, q.to)[l]}: ${v(l, q.total)}.`);
  const up = (c.delta ?? 0) >= 0;
  return {
    en: `${m.label.en} for ${range(q.from, q.to).en} was ${v("en", q.total)}, ${up ? "up" : "down"} ${pct("en", abs(c.delta_pct))} against ${v("en", c.total)} for ${range(c.from, c.to).en}.`,
    tr: `${range(q.from, q.to).tr} döneminde ${mid(m.label.tr, "tr")} ${v("tr", q.total)}; ${range(c.from, c.to).tr} dönemindeki ${v("tr", c.total)} değerine göre ${pct("tr", abs(c.delta_pct))} ${up ? "arttı" : "azaldı"}.`,
  };
}

/** An answer names a campaign or price change that falls in its period, so a spike reads with its cause beside it. */
function withEvent(t: Text, q: QueryResult, events: ChartEvent[]): Text {
  if (!(["revenue", "orders", "aov", "sessions"] as MetricId[]).includes(q.metric) || q.from === q.to) return t;
  const ev = events.filter((e) => (e.type === "campaign" || e.type === "price_change") && e.date >= q.from && e.date <= q.to).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!ev) return t;
  const kind = { en: ev.type === "campaign" ? "a campaign" : "a price change", tr: ev.type === "campaign" ? "kampanya" : "fiyat değişikliği" };
  return {
    en: `${t.en} ${ev.title.en} (${enShort(ev.date)}, ${kind.en}) falls in this period and lines up with the higher days after it.`,
    tr: `${t.tr} ${ev.title.tr} (${trLong(ev.date)}, ${kind.tr}) bu döneme düşüyor ve sonrasındaki yüksek günlerle örtüşüyor.`,
  };
}

function seriesSentence(q: QueryResult): Text {
  const m = METRICS[q.metric];
  const v = (l: Lang, x: number | null) => f[l].value(x, q.unit);
  const vals = q.rows.filter((r) => r.value != null) as { key: string; value: number }[];
  const min = vals.reduce((a, b) => (b.value < a.value ? b : a), vals[0]!);
  const max = vals.reduce((a, b) => (b.value > a.value ? b : a), vals[0]!);
  const weeks = q.group_by === "week";
  const totalWord = m.unit === "count" || m.unit === "try";
  return {
    en: `${m.label.en} for ${range(q.from, q.to).en}${weeks ? `, ${vals.length} complete weeks` : ""}: ${v("en", q.total)}${totalWord ? " in total" : " overall"}. ${weeks ? "Weekly" : "Daily"} figures ran from ${v("en", min.value)} (${f.en.date(min.key)}) to ${v("en", max.value)} (${f.en.date(max.key)}).`,
    tr: `${range(q.from, q.to).tr} döneminde${weeks ? `, ${vals.length} tam haftada` : ""} ${mid(m.label.tr, "tr")} ${totalWord ? "toplam " : ""}${v("tr", q.total)}. ${weeks ? "Haftalık" : "Günlük"} değerler ${v("tr", min.value)} (${f.tr.date(min.key)}) ile ${v("tr", max.value)} (${f.tr.date(max.key)}) arasında.`,
  };
}

function metricAnswer(metric: MetricId, group: GroupBy | null, p: Period, ctx: PlanContext, s: string, handmade: boolean): Plan {
  const g = group ?? "none";
  const singleDay = p.from === p.to;
  const compare = g === "none" || g === "channel" || g === "device" || g === "day" ? ("previous_period" as const) : undefined;
  const q = runQuery({ metric, group_by: g, from: p.from, to: p.to, compare: g === "none" || g === "day" ? compare : g === "channel" || g === "device" ? "previous_period" : undefined, month_to_date: p.monthToDate });
  const kind: AnswerKind = g === "none" ? "number" : g === "channel" || g === "device" ? "split" : "series";
  const base = kind === "number" ? numberSentence(q, singleDay) : kind === "split" ? splitSentence(q) : seriesSentence(q);
  const sentence = withEvent(base, q, ctx.events ?? []);
  const reading = both((l) => `${mid(METRICS[metric].label[l], l)}, ${GROUPING[g]![l]}, ${range(q.from, q.to)[l]}`);
  const followups: Text[] =
    metric === "roas" ? [FOLLOW.spend, FOLLOW.revenue_channel] : metric === "revenue" ? [FOLLOW.revenue_channel, FOLLOW.ga4] : metric === "orders" ? [FOLLOW.orders_device, FOLLOW.ga4] : [FOLLOW.roas, FOLLOW.ga4];
  void s;
  return {
    kind: "answer",
    steps: steps(q),
    answer: {
      kind,
      sentence,
      title: both((l) => `${METRICS[metric].label[l]} · ${range(q.from, q.to)[l]}`),
      followups,
      interpretation: ctx.model ? null : READ_AS(reading),
      query: q,
      check: null,
      metrics: [metricRef(metric)],
      events: [],
      validation: { ok: true, unmatched: [] },
      created_by: ctx.model ? "agent" : "planner",
      model_label: ctx.model?.label ?? T("Built-in planner", "Yerleşik planlayıcı"),
      seconds: ctx.model ? 2.8 : 0.3,
      handmade,
    },
  };
}

// ---------------------------------------------------------------- the router

export function plan(question: string, ctx: PlanContext): Plan {
  const s = norm(question);

  if (has(s, /as an event/, /olay olarak/)) {
    const ev = (ctx.events ?? []).find((e) => e.type === "release" && e.date === RELEASE.date);
    if (!ev) {
      return { kind: "propose_event", event: { date: RELEASE.date, title: RELEASE.label, type: "release", note: T("New checkout and thank-you page.", "Yeni ödeme ve teşekkür sayfası."), source: "agent" }, steps: [{ tool: "propose_event", summary: T("Proposed an event: v4.12 release, 9 Oct", "Olay önerildi: v4.12 sürümü, 9 Ekim"), ok: true }] };
    }
  }
  if (has(s, /turn this into a metric/, /metriğe dönüştür/) && ctx.lastAnswer?.explore) {
    return { kind: "propose_metric", from: ctx.lastAnswer, steps: [{ tool: "propose_metric", summary: T("Proposed a metric from the exploratory answer", "Keşif cevabından metrik önerildi"), ok: true }] };
  }
  if (has(s, /turn this into a metric/, /metriğe dönüştür/)) {
    const m = REFUSAL.metric_howto;
    return { kind: "refusal", refusal: { code: "metric_howto", heading: m.heading, body: ctx.demo === false ? m.own : m.demo, nearest: [] } };
  }

  // Exploratory: a weekday, a growth, or two dimensions at once are outside the metric set.
  if (ctx.explore && ctx.model && needsExplore(s)) {
    const spec = exploreFor(s);
    if (spec) return explorePlan(spec, ctx);
  }

  for (const [re, missing] of NOT_IN_DATA) {
    if (missing === "weekday" && re.test(s)) {
      if (ctx.explore && ctx.model) break;
      return { kind: "refusal", refusal: { code: "planner_unknown", heading: REFUSAL.heading, body: outsideBody(), nearest: [NEAR.revenue_channel_28, NEAR.aov_device_28, NEAR.gads_14] } };
    }
    if (re.test(s)) {
      if (ctx.explore && ctx.model) return exploreFailed();
      const r = missing === "weekday" ? REFUSAL.no_weekday : REFUSAL.no_product;
      return { kind: "refusal", refusal: { code: "not_in_data", missing, heading: r.heading, body: r.body, nearest: [NEAR.revenue_channel_28, NEAR.aov_device_28] } };
    }
  }

  const contextCheck = ctx.context?.kind === "check" ? (ctx.context.id as CheckId) : null;
  const named = checkOf(s);

  // Watch and pin proposals: the agent proposes, the person decides (B13).
  if (has(s, /\bwatch\b/, /izle/)) {
    const check = named ?? contextCheck ?? ctx.lastCheck?.check ?? "ga4_vs_orders";
    return { kind: "propose_watch", check, steps: [{ tool: "watch_check", summary: STEP.propose_watch(CHECKS[check].label), ok: true }] };
  }
  if (has(s, /\bpin\b/, /dashboard.a ekle/, /panoya ekle/) && ctx.lastAnswer) {
    return { kind: "propose_pin", steps: [] };
  }

  // Follow-up: is the gap only on one device.
  if (has(s, /only on mobile/, /yalnızca mobil/, /sadece mobil/, /gap .*mobile/, /fark .*mobil/)) {
    const prev = ctx.lastCheck;
    const check = prev?.check ?? contextCheck ?? "ga4_vs_orders";
    const p = prev ? { from: prev.from, to: prev.to, label: T("", "") } : periodOf(s, 14);
    const c = reconcile(check, p.from, p.to);
    // The answer is about the segment: its headline, Δ and tally are mobile's; the whole check moves to one line.
    const mobile = reconcile(check, p.from, p.to, { device: ["mobile"] });
    const segment: CheckResult = { ...mobile, label: both((l) => `${CHECKS[check].label[l]} · ${l === "en" ? "mobile" : "mobil"}`), breakdown: c.breakdown, breakdown_by: c.breakdown_by };
    return checkAnswer(check, p, ctx, { kind: "check_split", sentence: check === "ga4_vs_orders" ? deviceSentence(c) : checkSentence(c), followups: [FOLLOW.why, FOLLOW.watch_ga4, FOLLOW.meta], handmade: true, check: segment, overall: c });
  }

  // Why a check does not add up: its own answer kind, which explains instead of repeating the tally.
  if (has(s, /\bwhy\b/, /neden/) && (named || contextCheck || ctx.lastCheck || has(s, /match|tut|gap|fark/))) {
    const check = named ?? contextCheck ?? ctx.lastCheck?.check ?? "ga4_vs_orders";
    const p = ctx.lastCheck && ctx.lastCheck.check === check ? { from: ctx.lastCheck.from, to: ctx.lastCheck.to, label: T("", "") } : periodOf(s, 14);
    const c = reconcile(check, p.from, p.to);
    if (c.verdict !== "does_not_add_up") return checkAnswer(check, p, ctx, { handmade: true });
    // With no event on the day it started, the agent offers to add the release as one.
    const noEvent = !(ctx.events ?? []).some((e) => e.date === c.out_of_tolerance_since);
    return checkAnswer(check, p, ctx, { kind: "why", check: c, sentence: whyText(c), why: whyDetail(c), followups: noEvent && check.startsWith("ga4") ? [FOLLOW.add_event, ...WHY_FOLLOWUPS[check]] : WHY_FOLLOWUPS[check], handmade: true });
  }

  // On a metric page the question is about that metric unless it names another.
  const metric = metricOf(s) ?? (ctx.context?.kind === "metric" && ctx.context.id && ctx.context.id in METRICS ? (ctx.context.id as MetricId) : null);
  const group = groupOf(s);

  if (named && !(metric === "roas")) {
    const p = periodOf(s, 14);
    return checkAnswer(named, p, ctx, { handmade: false });
  }

  if (metric) {
    const fallback = metric === "roas" || group === "channel" || group === "device" ? 28 : group === "week" ? 90 : 7;
    const p = periodOf(s, fallback);
    const handmade = has(s, /last week|geçen hafta|yesterday|\bdün\b|harcandı|satış|converting|this month|bu ay|last month|geçen ay/) || (metric === "revenue" && !group);
    // "Revenue by week for the last 90 days" (complete weeks) and "X last week against the week before" (a number).
    return metricAnswer(metric, group, p, ctx, s, handmade);
  }

  if (contextCheck) return checkAnswer(contextCheck, periodOf(s, 14), ctx, { handmade: true });

  if (ctx.explore && ctx.model) {
    const spec = exploreFor(s);
    return spec ? explorePlan(spec, ctx) : exploreFailed();
  }

  return {
    kind: "refusal",
    refusal: { code: "planner_unknown", heading: REFUSAL.heading, body: outsideBody(), nearest: [NEAR.revenue_channel_last_month, NEAR.orders_channel_last_month, NEAR.gads_14] },
  };
}

const outsideBody = (): Text => ({ en: `${REFUSAL.outside.en} ${REFUSAL.coverage.en}`, tr: `${REFUSAL.outside.tr} ${REFUSAL.coverage.tr}` });

function exploreFailed(): Plan {
  return { kind: "refusal", refusal: { code: "explore_failed", heading: REFUSAL.explore_failed.heading, body: REFUSAL.explore_failed.body(MART_COLUMNS.join(", ")), nearest: [EXPLORE_Q.weekday, EXPLORE_Q.channel_device, EXPLORE_Q.spend_growth] } };
}

// ---------------------------------------------------------------- exploratory (owner round 4)

const WEEKDAY_RE = [/weekday/, /day of the week/, /hafta gün/, /hangi gün/];
const GROWTH_RE = [/grew/, /growth/, /grow/, /arttı/, /artış/, /büyü/];
const dimsOf = (s: string): ExploreSpec["dims"] => {
  const d: ExploreSpec["dims"] = [];
  if (has(s, /channel/, /kanal/)) d.push("channel");
  if (has(s, /device/, /mobile/, /desktop/, /cihaz/, /mobil/, /masaüstü/)) d.push("device");
  if (has(s, ...WEEKDAY_RE)) d.push("weekday");
  if (has(s, /by week\b/, /weekly/, /each week\b/, /haftalık/, /haftaya göre/)) d.push("week");
  return d.slice(0, 2);
};
function needsExplore(s: string): boolean {
  return has(s, ...WEEKDAY_RE) || (has(s, ...GROWTH_RE) && has(s, /spend/, /harcama/)) || dimsOf(s).length >= 2;
}
function exploreFor(s: string): ExploreSpec | null {
  const dims = dimsOf(s);
  if (has(s, ...GROWTH_RE) && has(s, /spend/, /harcama/)) {
    const p = periodOf(s.includes("month") || s.includes(" ay") ? s : `${s} this month`, 28);
    return { measure: "spend_growth", dims: ["channel"], from: p.from, to: p.to };
  }
  const metric = metricOf(s);
  const measure: ExploreSpec["measure"] | null = metric === "aov" ? "aov" : metric === "ad_spend" ? "ad_spend" : metric === "sessions" ? "sessions" : metric === "orders" ? "orders" : metric === "revenue" ? "revenue" : dims.length ? "revenue" : null;
  if (!measure || !dims.length) return null;
  const p = periodOf(s, dims.includes("weekday") || dims.includes("week") ? 90 : 28);
  return { measure, dims, from: p.from, to: p.to };
}

const WEEKDAY_NAME: Record<string, Text> = {
  mon: T("Monday", "Pazartesi"), tue: T("Tuesday", "Salı"), wed: T("Wednesday", "Çarşamba"), thu: T("Thursday", "Perşembe"), fri: T("Friday", "Cuma"), sat: T("Saturday", "Cumartesi"), sun: T("Sunday", "Pazar"),
};
const GROUP_WORD: Record<string, Text> = { channel: T("by channel", "kanala göre"), device: T("by device", "cihaza göre"), weekday: T("by weekday", "hafta gününe göre"), week: T("by week", "haftalık") };
const keyName = (dim: string, key: string, lang: Lang) => (dim === "weekday" ? WEEKDAY_NAME[key]?.[lang] ?? key : dim === "week" ? f[lang].date(key) : dimName(key, lang));

function exploreSentence(x: ExploreResult): Text {
  const r = range(x.spec.from, x.spec.to);
  const v = (l: Lang, n: unknown) => f[l].value(n as number | null, x.unit);
  const last = (row: (string | number | null)[]) => row[row.length - 1];
  const lab = (l: Lang) => mid(x.label[l], l);
  const [a, b] = x.rows;
  if (x.shape === "number") return both((l) => (l === "en" ? `${x.label.en} for ${r.en}: ${v(l, last(a!))}.` : `${r.tr} döneminde ${lab(l)}: ${v(l, last(a!))}.`));
  if (x.spec.measure === "spend_growth") {
    return {
      en: `Ad spend grew most on ${keyName("channel", String(a![0]), "en")}: ${f.en.pct(a![1] as number, 1, true)} for ${r.en} against the same days a month earlier${b ? `, then ${keyName("channel", String(b[0]), "en")} at ${f.en.pct(b[1] as number, 1, true)}` : ""}.`,
      tr: `${r.tr} döneminde reklam harcaması önceki ayın aynı günlerine göre en çok ${keyName("channel", String(a![0]), "tr")} kanalında arttı: ${f.tr.pct(a![1] as number, 1, true)}${b ? `; ardından ${keyName("channel", String(b[0]), "tr")}, ${f.tr.pct(b[1] as number, 1, true)}` : ""}.`,
    };
  }
  const d = x.spec.dims;
  if (x.shape === "category") {
    return {
      en: `${x.label.en} ${GROUP_WORD[d[0]!]!.en} for ${r.en}: ${keyName(d[0]!, String(a![0]), "en")} is highest at ${v("en", a![1])}${b ? `, then ${keyName(d[0]!, String(b[0]), "en")} at ${v("en", b[1])}` : ""}.`,
      tr: `${r.tr} döneminde ${GROUP_WORD[d[0]!]!.tr} ${lab("tr")}: en yüksek ${keyName(d[0]!, String(a![0]), "tr")}, ${v("tr", a![1])}${b ? `; ardından ${keyName(d[0]!, String(b[0]), "tr")}, ${v("tr", b[1])}` : ""}.`,
    };
  }
  if (x.shape === "series") {
    const vals = x.rows.filter((row) => row[1] != null);
    const min = vals.reduce((p, c) => (Number(c[1]) < Number(p[1]) ? c : p), vals[0]!);
    const max = vals.reduce((p, c) => (Number(c[1]) > Number(p[1]) ? c : p), vals[0]!);
    return {
      en: `${x.label.en} by week for ${r.en}: from ${v("en", min[1])} (week of ${f.en.date(String(min[0]))}) to ${v("en", max[1])} (week of ${f.en.date(String(max[0]))}).`,
      tr: `${r.tr} döneminde haftalık ${lab("tr")}: ${f.tr.date(String(min[0]))} haftasında ${v("tr", min[1])} ile ${f.tr.date(String(max[0]))} haftasında ${v("tr", max[1])} arasında.`,
    };
  }
  const name = (l: Lang, row: (string | number | null)[]) => d.map((dim, i) => keyName(dim, String(row[i]), l)).join(" · ");
  return {
    en: `${x.label.en} ${GROUP_WORD[d[0]!]!.en} and ${GROUP_WORD[d[1]!]!.en.replace("by ", "")} for ${r.en}: ${x.rows.length} rows. The highest is ${name("en", a!)} at ${v("en", last(a!))}.`,
    tr: `${r.tr} döneminde ${GROUP_WORD[d[0]!]!.tr} ve ${GROUP_WORD[d[1]!]!.tr} ${lab("tr")}: ${x.rows.length} satır. En yüksek: ${name("tr", a!)}, ${v("tr", last(a!))}.`,
  };
}

function exploreTitle(x: ExploreResult): Text {
  const d = x.spec.dims;
  if (x.spec.measure === "spend_growth") return T("Ad spend growth by channel", "Kanala göre reklam harcaması artışı");
  if (!d.length) return x.label;
  return {
    en: `${x.label.en} ${d.map((k) => GROUP_WORD[k]!.en).join(" and ")}`.replace(" and by ", " and "),
    tr: ((s) => s.charAt(0).toLocaleUpperCase("tr") + s.slice(1))(`${d.map((k) => GROUP_WORD[k]!.tr).join(" ve ")} ${mid(x.label.tr, "tr")}`),
  };
}

function explorePlan(spec: ExploreSpec, ctx: PlanContext): Plan {
  const x = runExplore(spec);
  const others = Object.values(EXPLORE_Q).filter((q) => exploreFor(norm(q.en))?.measure !== spec.measure || JSON.stringify(exploreFor(norm(q.en))?.dims) !== JSON.stringify(spec.dims));
  const steps: Step[] = [
    { tool: "dry_run", summary: both((l) => (l === "en" ? `Dry run on daily_channel_device: ${f.en.bytes(x.bytes)}, under the bytes cap` : `daily_channel_device üzerinde deneme çalıştırması: ${f.tr.bytes(x.bytes)}, bayt sınırının altında`)), ok: true },
    { tool: "run_sql", summary: both((l) => (l === "en" ? `Ran one read-only query: ${x.rows.length} ${x.rows.length === 1 ? "row" : "rows"}` : `Salt okunur tek bir sorgu çalıştırıldı: ${x.rows.length} satır`)), ok: true },
    { tool: "publish_answer", summary: STEP.publish, ok: true },
  ];
  return {
    kind: "answer",
    steps,
    answer: {
      kind: "explore",
      sentence: exploreSentence(x),
      title: exploreTitle(x),
      followups: [FOLLOW.to_metric, ...others],
      interpretation: null,
      query: exploreQuery(x),
      check: null,
      metrics: [],
      events: [],
      validation: { ok: true, unmatched: [] },
      created_by: "agent",
      model_label: ctx.model?.label ?? T("Built-in planner", "Yerleşik planlayıcı"),
      seconds: 3.4,
      handmade: true,
      explore: x,
    },
  };
}

export { newId };
