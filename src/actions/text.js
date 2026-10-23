// The few words actions write into stored records (titles, activity details, alert defaults).
// The UI translates its own chrome; these are kept in the language the action ran in.
import { fmtPct, fmtRange, fmtVal } from "../format.js";
import { NAMES } from "../metrics/load.js";

export const T = {
  en: {
    rule_check: "when the check does not add up",
    rule_metric: "when it changes by more than 20% week on week",
    schedule: "every morning at 08:00",
    checks_run: (n, bad) => `${n} checks · ${bad} do not add up`,
    approved: (t) => `Approved: ${t}`,
    declined: (t) => `Declined: ${t}`,
  },
  tr: {
    rule_check: "kontrol tutmadığında",
    rule_metric: "haftalık %20’den fazla değiştiğinde",
    schedule: "her sabah 08:00’de",
    checks_run: (n, bad) => `${n} kontrol · ${bad} tutmuyor`,
    approved: (t) => `Onaylandı: ${t}`,
    declined: (t) => `Reddedildi: ${t}`,
  },
};

export const nameOf = (dim, id, lang) => NAMES[dim]?.[id]?.[lang] ?? id;
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** "Orders · Meta Ads · 9–22 Oct 2026" */
export function defaultTitle(metric, query, lang) {
  const parts = [metric.label[lang]];
  for (const dim of ["channel", "device"]) {
    const values = list(query.filters?.[dim]);
    if (values.length) parts.push(values.map((v) => nameOf(dim, v, lang)).join(", "));
  }
  parts.push(fmtRange(query.from, query.to, lang));
  return parts.join(" · ");
}

/** The one-line step a turn shows for a query. */
export function querySummary(q, lang) {
  const f = Object.entries(q.filters ?? {}).map(([k, v]) => `${k}=${list(v).join(",")}`);
  return [q.metric, q.group_by, `${q.from}..${q.to}`, ...f].join(" · ") + ` → ${fmtVal(q.total, q.unit, lang)}`;
}

export function checkSummary(c, lang) {
  const words = { adds_up: { en: "adds up", tr: "tutuyor" }, does_not_add_up: { en: "does not add up", tr: "tutmuyor" }, insufficient_data: { en: "not enough data", tr: "veri yetersiz" } };
  const delta = c.delta_pct == null ? "–" : fmtPct(c.delta_pct, 1, true, lang);
  return `${c.check} · ${c.from}..${c.to} → Δ ${delta} ${words[c.verdict][lang]}`;
}
