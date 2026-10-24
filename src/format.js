// Number and date formatting per language, the same rules as the web app's lib/format.ts, so a figure
// in a sentence reads exactly like the same figure on a chart. The planner's sentences and default
// titles use it, and the validator reads back exactly these formats.
//   en 2,753 · 4.2% · −10.1% · 1.84M TL · 2.66× · 9 Oct 2026 · 9–22 Oct 2026
//   tr 2.753 · %4,2 · −%10,1 · 1,84 mn TL · 2,66× · 9 Eki 2026 · 9–22 Eki 2026
export const MINUS = "−";

const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const group = (digits, sep) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
export const DASH = "–";

export function fmtInt(n, lang = "en") {
  if (!isNum(n)) return DASH;
  const s = group(Math.round(Math.abs(n)).toString(), lang === "tr" ? "." : ",");
  return (n < 0 && Math.round(Math.abs(n)) !== 0 ? MINUS : "") + s;
}

export function fmtDec(n, d, lang = "en") {
  if (!isNum(n)) return DASH;
  const parts = Math.abs(n).toFixed(d).split(".");
  parts[0] = group(parts[0], lang === "tr" ? "." : ",");
  return (n < 0 && Number(Math.abs(n).toFixed(d)) !== 0 ? MINUS : "") + parts.join(lang === "tr" ? "," : ".");
}

/** A ratio as a percentage: 0.042 -> "4.2%" (en) or "%4,2" (tr). signed adds "+" to positive values. */
export function fmtPct(r, d = 1, signed = false, lang = "en") {
  if (!isNum(r)) return DASH;
  const v = fmtDec(Math.abs(r * 100), d, lang);
  const zero = Number(Math.abs(r * 100).toFixed(d)) === 0;
  const sign = zero ? "" : r < 0 ? MINUS : signed && r > 0 ? "+" : "";
  return lang === "tr" ? `${sign}%${v}` : `${sign}${v}%`;
}

export function fmtTRY(n, lang = "en") {
  if (!isNum(n)) return DASH;
  if (Math.abs(n) >= 1e6) return lang === "tr" ? `${fmtDec(n / 1e6, 2, lang)} mn TL` : `${fmtDec(n / 1e6, 2, lang)}M TL`;
  return `${fmtInt(n, lang)} TL`;
}

/** unit: count | try | pct | ratio */
export function fmtVal(v, unit, lang = "en") {
  if (!isNum(v)) return DASH;
  if (unit === "try") return fmtTRY(v, lang);
  if (unit === "pct") return fmtPct(v, 2, false, lang);
  if (unit === "ratio") return `${fmtDec(v, 2, lang)}×`;
  return fmtInt(v, lang);
}

/** "4.1 MB" / "4,1 MB", "2 GB". */
export function fmtBytes(n, lang = "en") {
  if (!isNum(n)) return DASH;
  const [div, k] = n >= 1024 ** 3 ? [1024 ** 3, "GB"] : n >= 1024 ** 2 ? [1024 ** 2, "MB"] : n >= 1024 ? [1024, "KB"] : [1, "B"];
  const v = n / div;
  return `${Number.isInteger(Math.round(v * 10) / 10) ? fmtInt(v, lang) : fmtDec(v, 1, lang)} ${k}`;
}

export const MONTHS = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  tr: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"],
};
const MONTHS_LONG_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
// Ablative with the apostrophe and vowel harmony: "9 Ekim’den", "25 Temmuz’dan", "1 Ağustos’tan".
const ABL_TR = ["tan", "tan", "tan", "dan", "tan", "dan", "dan", "tan", "den", "den", "dan", "tan"];

export const parseISO = (s) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
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
export const monthStart = (s) => `${s.slice(0, 7)}-01`;
export function monthEnd(s) {
  const d = parseISO(monthStart(s));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return iso(d);
}
export function addMonths(s, n) {
  const d = parseISO(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = parseISO(monthEnd(iso(d))).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
}
export function eachDay(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "9 Oct" or "9 Oct 2026" / "9 Eki 2026". */
export function fmtDate(s, withYear = false, lang = "en") {
  const d = parseISO(s);
  return `${d.getUTCDate()} ${MONTHS[lang === "tr" ? "tr" : "en"][d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ""}`;
}

/** "9–22 Oct 2026", "25 Sep–22 Oct 2026", "28 Dec 2025–3 Jan 2026", one date when both ends are equal. */
export function fmtRange(a, b, lang = "en") {
  if (a === b) return fmtDate(a, true, lang);
  if (a.slice(0, 7) === b.slice(0, 7)) return `${parseISO(a).getUTCDate()}–${fmtDate(b, true, lang)}`;
  if (a.slice(0, 4) === b.slice(0, 4)) return `${fmtDate(a, false, lang)}–${fmtDate(b, true, lang)}`;
  return `${fmtDate(a, true, lang)}–${fmtDate(b, true, lang)}`;
}

/** "9 Ekim" */
export function trLong(s) {
  const d = parseISO(s);
  return `${d.getUTCDate()} ${MONTHS_LONG_TR[d.getUTCMonth()]}`;
}
/** "9 Ekim’den" */
export function trFrom(s) {
  const d = parseISO(s);
  return `${d.getUTCDate()} ${MONTHS_LONG_TR[d.getUTCMonth()]}’${ABL_TR[d.getUTCMonth()]}`;
}
// Locative with vowel and consonant harmony: "9 Ekim’de", "25 Temmuz’da", "1 Ağustos’ta".
const LOC_TR = ["ta", "ta", "ta", "da", "ta", "da", "da", "ta", "de", "de", "da", "ta"];
/** "9 Ekim’de" */
export function trAt(s) {
  const d = parseISO(s);
  return `${d.getUTCDate()} ${MONTHS_LONG_TR[d.getUTCMonth()]}’${LOC_TR[d.getUTCMonth()]}`;
}
/** "9 Oct" */
export const enShort = (s) => fmtDate(s, false, "en");

/** The formatters bound to one language, the shape the bilingual templates use. */
export const formatFor = (lang) => ({
  int: (n) => fmtInt(n, lang),
  dec: (n, d) => fmtDec(n, d, lang),
  pct: (r, d = 1, signed = false) => fmtPct(r, d, signed, lang),
  value: (v, unit) => fmtVal(v, unit, lang),
  date: (s, withYear = false) => (s ? fmtDate(s, withYear, lang) : DASH),
  range: (a, b) => fmtRange(a, b, lang),
  bytes: (n) => fmtBytes(n, lang),
});
export const f = { en: formatFor("en"), tr: formatFor("tr") };
