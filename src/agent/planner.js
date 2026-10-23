// The built-in planner: answers common questions without a model, with the same tools the
// model uses. Ported from the prototype's plan(), periodFrom() and plannerSentence().
import { addDays, fmtDate, fmtPct, fmtRange, fmtVal, parseISO, iso } from "../format.js";
import { nameOf } from "../actions/text.js";

export const SUGGEST = {
  en: ["Do GA4 purchases match our orders in the last 14 days?", "Which channel has the highest ROAS in the last 28 days?", "Do Meta conversions match our orders this month?", "Revenue by week for the last 90 days"],
  tr: ["Son 14 günde GA4 satın almaları siparişlerle tutuyor mu?", "Son 28 günde en yüksek ROAS hangi kanalda?", "Bu ay Meta dönüşümleri siparişlerle tutuyor mu?", "Son 90 günün haftalık cirosu"],
};

const FOLLOW = {
  en: ["Is the gap only on mobile?", "Which channel has the highest ROAS in the last 28 days?", "Do Meta conversions match our orders?", "Make an alert for the GA4 check"],
  tr: ["Fark yalnızca mobilde mi?", "Son 28 günde en yüksek ROAS hangi kanalda?", "Meta dönüşümleri siparişlerle tutuyor mu?", "GA4 kontrolü için alarm kur"],
};

export const PLANNER_TEXT = {
  en: {
    unknown:
      "The built-in planner knows orders, revenue, sessions, conversion rate, order value, ad spend, ROAS and the four checks. Try one of the suggested questions.",
    note: "Answered by the built-in planner, without a model. Set ANTHROPIC_API_KEY to ask anything.",
  },
  tr: {
    unknown:
      "Yerleşik planlayıcı sipariş, ciro, oturum, dönüşüm oranı, sepet ortalaması, reklam harcaması, ROAS ve dört kontrolü bilir. Örnek sorulardan biri denenebilir.",
    note: "Yanıtı yerleşik planlayıcı verdi; model kullanılmadı. Her soruyu sorabilmek için ANTHROPIC_API_KEY tanımlanmalı.",
  },
};

/** The period a question names, ending on the last day with data. */
export function periodFrom(q, last) {
  const lastN = (n) => ({ from: addDays(last, -(n - 1)), to: last });
  const m = q.match(/(\d+)\s*(day|days|gün)/i);
  if (m) return lastN(Math.min(90, Math.max(1, +m[1])));
  if (/this month|bu ay/i.test(q)) return { from: `${last.slice(0, 7)}-01`, to: last };
  if (/last month|geçen ay/i.test(q)) {
    const first = parseISO(`${last.slice(0, 7)}-01`);
    const prevEnd = addDays(iso(first), -1);
    return { from: `${prevEnd.slice(0, 7)}-01`, to: prevEnd };
  }
  if (/week|hafta/i.test(q)) return lastN(7);
  if (/90|quarter|çeyrek|3 ay/i.test(q)) return lastN(90);
  return lastN(14);
}

/** A fixed plan for the question, or null when the planner does not know it. */
export function plan(question, last) {
  const s = question.toLowerCase();
  const per = periodFrom(s, last);
  const g = /channel|kanal/.test(s) ? "channel" : /device|mobil|mobile|cihaz/.test(s) ? "device" : /week|hafta/.test(s) ? "week" : "day";
  let p = null;
  if (/meta/.test(s) && /conver|dönüşüm|match|tut/.test(s)) p = { metric: "orders", group_by: "day", channel: "meta_ads", check: "meta_vs_orders" };
  else if (/google ads/.test(s) && /conver|dönüşüm|match|tut/.test(s)) p = { metric: "orders", group_by: "day", channel: "google_ads", check: "gads_vs_orders" };
  else if (/roas/.test(s)) p = { metric: "roas", group_by: "channel" };
  else if (/cost per|sipariş başı|cpa/.test(s)) p = { metric: "cpa", group_by: "channel" };
  else if (/spend|harcama/.test(s)) p = { metric: "ad_spend", group_by: g === "day" ? "channel" : g };
  else if (/revenue|ciro|gelir/.test(s)) p = { metric: "revenue", group_by: g, check: "ga4_rev_vs_revenue" };
  else if (/conversion rate|dönüşüm oranı/.test(s)) p = { metric: "conversion_rate", group_by: g === "day" ? "device" : g };
  else if (/order value|aov|sepet/.test(s)) p = { metric: "aov", group_by: g === "day" ? "device" : g };
  else if (/session|oturum|trafik|traffic/.test(s)) p = { metric: "sessions", group_by: g };
  else if (/ga4|purchase|satın alma|match|tut|order|sipariş/.test(s)) p = { metric: "orders", group_by: g, check: "ga4_vs_orders" };
  if (!p) return null;
  if (p.group_by === "day" && per.from < addDays(last, -40)) p.group_by = "week";
  p.from = per.from;
  p.to = per.to;
  p.alert = /alert|alarm|uyar|haber ver|tell me|watch|izle/.test(s);
  p.pin = /pin|sabitle|panoya/.test(s);
  return p;
}

/** The planner's sentence. Every number in it comes from the query or the check, formatted for lang. */
export function plannerSentence(pack, q, r, lang = "en") {
  const m = pack.metrics[q.metric];
  const per = fmtRange(q.from, q.to, lang);
  const tot = fmtVal(q.total, q.unit, lang);
  const ch = Array.isArray(q.filters?.channel) ? null : q.filters?.channel;
  const name = lang === "tr" ? (ch ? `${nameOf("channel", ch, "tr")} kaynaklı ${m.label.tr.toLocaleLowerCase("tr")}` : m.label.tr) : `${m.label.en}${ch ? ` from ${nameOf("channel", ch, "en")}` : ""}`;
  let s;
  if (q.group_by === "channel" && q.rows.length) {
    const top = q.rows[0];
    const topName = nameOf("channel", top.key, lang);
    s = lang === "tr" ? `${per} döneminde ${name} ${tot}. En yüksek kanal ${topName}: ${fmtVal(top.value, q.unit, lang)}.` : `${name} for ${per} is ${tot}. The highest channel is ${topName} at ${fmtVal(top.value, q.unit, lang)}.`;
  } else {
    s = lang === "tr" ? `${per} döneminde ${name}: ${tot}.` : `${name} for ${per}: ${tot}.`;
  }
  if (r && r.delta_pct != null) {
    const bad = r.verdict !== "adds_up";
    const label = r.measured.label[lang];
    const delta = fmtPct(r.delta_pct, 1, true, lang);
    s += lang === "tr" ? ` ${label} kaynaktan ${delta} farklı; kontrol ${bad ? "tutmuyor" : "tutuyor"}.` : ` ${label}: ${delta} against the source, so the check ${bad ? "does not add up" : "adds up"}.`;
    // When one segment carries the gap and another adds up, say where it is and when it started.
    const out = r.breakdown.filter((b) => b.verdict === "does_not_add_up");
    if (bad && out.length === 1 && r.breakdown.some((b) => b.verdict === "adds_up")) {
      const seg = nameOf(r.breakdown_by, out[0].key, lang);
      const segPct = fmtPct(out[0].delta_pct, 1, true, lang);
      const since = r.out_of_tolerance_since;
      if (lang === "tr") s += ` Fark ${seg.toLocaleLowerCase("tr")} tarafında (${segPct})${since ? ` ve ${fmtDate(since, false, "tr")} tarihinden beri var` : ""}.`;
      else s += ` The gap is on ${seg.toLowerCase()} (${segPct})${since ? ` and starts on ${fmtDate(since, false, "en")}` : ""}.`;
    }
  }
  return s;
}

export function followupsFor(question, lang) {
  const asked = question.trim().toLowerCase();
  return FOLLOW[lang].filter((f) => f.toLowerCase() !== asked).slice(0, 3);
}

/**
 * Runs the plan with the agent's tools.
 * @param {{ question: string, lang: "en"|"tr", pack: any, last: string, tool: (name: string, input: object) => Promise<any> }} o
 *   tool: runs one action and records the step; throws when the action fails.
 * @returns {Promise<{ answered: boolean, text: string, answer?: object }>}
 */
export async function runPlanner({ question, lang, pack, last, tool }) {
  const p = plan(question, last);
  if (!p) return { answered: false, text: PLANNER_TEXT[lang].unknown };
  const q = await tool("run_query", { metric: p.metric, group_by: p.group_by, from: p.from, to: p.to, ...(p.channel ? { filters: { channel: p.channel } } : {}) });
  // The check covers the query's own period, which complete weeks may have narrowed.
  const r = p.check ? await tool("reconcile", { check: p.check, from: q.from, to: q.to }) : null;
  const answer = await tool("publish_answer", {
    sentence: plannerSentence(pack, q, r, lang),
    query_id: q.id,
    ...(r ? { check_id: r.id } : {}),
    followups: followupsFor(question, lang),
  });
  if (p.pin) await tool("pin_answer", { answer_id: answer.id });
  if (p.alert && p.check) await tool("create_alert", { check: p.check, title: pack.checks[p.check].label[lang] });
  return { answered: true, text: PLANNER_TEXT[lang].note, answer };
}
