// Number and date formatting per language, ported from the prototype. The planner's sentences and
// default titles use it, and the validator reads back exactly these formats.
export const MINUS = "−";

const group = (digits, sep) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);

export function fmtInt(n, lang = "en") {
  const s = group(Math.round(Math.abs(n)).toString(), lang === "tr" ? "." : ",");
  return (n < 0 && Math.round(Math.abs(n)) !== 0 ? MINUS : "") + s;
}

export function fmtDec(n, d, lang = "en") {
  const parts = Math.abs(n).toFixed(d).split(".");
  parts[0] = group(parts[0], lang === "tr" ? "." : ",");
  return (n < 0 && Number(Math.abs(n).toFixed(d)) !== 0 ? MINUS : "") + parts.join(lang === "tr" ? "," : ".");
}

/** A ratio as a percentage: 0.042 -> "4.2%" (en) or "%4,2" (tr). signed adds "+" to positive values. */
export function fmtPct(r, d = 1, signed = false, lang = "en") {
  const v = fmtDec(Math.abs(r * 100), d, lang);
  const zero = Number(Math.abs(r * 100).toFixed(d)) === 0;
  const sign = zero ? "" : r < 0 ? MINUS : signed && r > 0 ? "+" : "";
  return lang === "tr" ? `${sign}%${v}` : `${sign}${v}%`;
}

export function fmtTRY(n, lang = "en") {
  if (Math.abs(n) >= 1e6) return lang === "tr" ? `${fmtDec(n / 1e6, 2, lang)} mn TL` : `${fmtDec(n / 1e6, 2, lang)}M TL`;
  return `${fmtInt(n, lang)} TL`;
}

/** unit: count | try | pct | ratio */
export function fmtVal(v, unit, lang = "en") {
  if (v == null || Number.isNaN(v)) return "–";
  if (unit === "try") return fmtTRY(v, lang);
  if (unit === "pct") return fmtPct(v, 2, false, lang);
  if (unit === "ratio") return `${fmtDec(v, 2, lang)}×`;
  return fmtInt(v, lang);
}

export const MONTHS = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  tr: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"],
};

export const parseISO = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const iso = (d) => d.toISOString().slice(0, 10);
export function addDays(s, n) {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
export const isISODate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parseISO(s)) === s;

/** Monday of the ISO week that contains the date. */
export function weekStart(s) {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return iso(d);
}

export function fmtDate(s, withYear = false, lang = "en") {
  const d = parseISO(s);
  return `${d.getUTCDate()} ${MONTHS[lang === "tr" ? "tr" : "en"][d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ""}`;
}

export function fmtRange(a, b, lang = "en") {
  if (a === b) return fmtDate(a, true, lang);
  if (a.slice(0, 7) === b.slice(0, 7)) return `${parseISO(a).getUTCDate()}–${fmtDate(b, true, lang)}`;
  return `${fmtDate(a, false, lang)}–${fmtDate(b, true, lang)}`;
}
