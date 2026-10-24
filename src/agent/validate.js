// Number grounding: every number in an answer's sentence must be a number the referenced
// query or check returned, rounded to the precision it is written with. The model writes
// the sentence; this makes sure it cannot write a figure the warehouse did not produce.
//
// Reads English (1,240 · 4.2% · −10.1% · 2.66× · 22.07M TL) and Turkish (1.240 · %4,2 ·
// −%10,1 · 2,66× · 22,07 mn TL). A token like "1.240" is ambiguous, so both readings are tried.
// Ignored: dates (2026-10-09, 9 Oct, 9–22 Eki, Oct 9), years 2000–2100, and durations
// ("14 days", "son 28 gün"), which describe the period rather than a result.

const MONTHS_LONG = [
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
  "ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık",
];
const MONTHS_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "oca", "şub", "nis", "haz", "tem", "ağu", "eyl", "eki", "kas", "ara"];
// Long names may carry a Turkish suffix (Ekim'den, Ekimde); short ones must stand alone.
const MONTH = `(?:(?:${MONTHS_LONG.join("|")})\\p{L}*|(?:${MONTHS_SHORT.join("|")})(?!\\p{L}))\\.?`;
const DAY = "\\d{1,2}(?:st|nd|rd|th|\\.)?";
const DASH = "\\s*[–—-]\\s*";

const IGNORE = [
  /\b\d{4}-\d{2}-\d{2}\b/gu, // ISO dates
  new RegExp(`(?<![\\p{L}\\p{N}])${DAY}(?:${DASH}${DAY})?\\s+(?:of\\s+)?${MONTH}`, "giu"), // 9 Oct, 9–22 Eki
  new RegExp(`${MONTH}\\s+${DAY}(?:${DASH}${DAY})?(?![\\p{N}])`, "giu"), // Oct 9, October 9–22
  /(?<![\p{L}\p{N}.,])\d+(?:-|\s)*(?:days?|weeks?|months?|gün\p{L}*|hafta\p{L}*|ay(?:da|dan|dır|lık|ın|ı)?)(?![\p{L}])/giu, // durations
];

const SCALES = { m: 1e6, mn: 1e6, milyon: 1e6, million: 1e6, bn: 1e9, milyar: 1e9, billion: 1e9, k: 1e3, bin: 1e3 };
const TOKEN =
  /(?<![\p{L}\p{N}_.,])([+\-−]\s?)?(%\s?)?(\d+(?:[.,]\d+)*)(\s?%)?(\s?[×x](?![\p{L}\p{N}]))?(\s?(?:M|mn|milyon|million|bn|milyar|billion|k|K|bin)(?![\p{L}\p{N}]))?/gu;

/** "1,240" -> [{ value: 1240, decimals: 0 }]; "1.240" -> 1.24 (en) and 1240 (tr). */
function readings(body) {
  const read = (thousands, decimal) => {
    const parts = body.split(decimal);
    if (parts.length > 2) return null;
    const [whole, frac] = parts;
    const groups = whole.split(thousands);
    if (groups.length > 1 && (!groups[0].length || groups[0].length > 3 || groups.slice(1).some((g) => g.length !== 3))) return null;
    if (frac !== undefined && !/^\d+$/.test(frac)) return null;
    return { value: Number(groups.join("") + (frac !== undefined ? `.${frac}` : "")), decimals: frac?.length ?? 0 };
  };
  const out = [read(",", "."), read(".", ",")].filter(Boolean);
  return out.filter((r, i) => out.findIndex((o) => o.value === r.value && o.decimals === r.decimals) === i);
}

/**
 * Every number written in the text, with its possible readings.
 * @returns {Array<{ raw: string, percent: boolean, scale: number, readings: Array<{ value: number, decimals: number }> }>}
 */
export function extractNumbers(text) {
  let s = String(text ?? "");
  for (const re of IGNORE) s = s.replace(re, (m) => " ".repeat(m.length));
  const out = [];
  for (const m of s.matchAll(TOKEN)) {
    const [raw, , pctBefore, body, pctAfter, , scaleWord] = m;
    const next = s[m.index + raw.length] ?? "";
    // A digit run that runs into letters is part of a word or an id (q_3f9a, 4g), not a figure.
    if (!scaleWord && /[\p{L}_]/u.test(next)) continue;
    const percent = Boolean(pctBefore || pctAfter);
    const scale = scaleWord ? SCALES[scaleWord.trim().toLowerCase()] : 1;
    if (!percent && scale === 1 && /^\d{4}$/.test(body) && +body >= 2000 && +body <= 2100) continue; // a year
    const r = readings(body);
    if (r.length) out.push({ raw: raw.trim(), percent, scale, readings: r });
  }
  return out;
}

/** The values a sentence may cite: plain figures and ratios (cited as percentages). */
export function groundTruth({ query, check, explore } = {}) {
  const plain = [];
  const ratios = [];
  if (query) {
    const values = [query.total, ...(query.rows ?? []).map((r) => r.value)].filter((v) => typeof v === "number");
    (query.unit === "pct" ? ratios : plain).push(...values);
    // A percentage-unit metric is also often cited as a plain ratio, e.g. "a rate of 0.0198"; keep that too.
    if (query.unit === "pct") plain.push(...values);
    // The comparison window's figures, and how many rows the result has ("12 complete weeks").
    const c = query.comparison;
    if (c) {
      const cv = [c.total, ...(c.rows ?? []).map((r) => r.value)].filter((v) => typeof v === "number");
      (query.unit === "pct" ? ratios : plain).push(...cv);
      plain.push(c.delta);
      ratios.push(c.delta_pct);
      if (c.delta_points != null) plain.push(c.delta_points);
    }
    plain.push((query.rows ?? []).length);
  }
  if (explore) {
    for (const row of explore.rows ?? []) {
      const v = row[row.length - 1];
      if (typeof v === "number") (explore.unit === "pct" ? ratios : plain).push(v);
    }
    plain.push((explore.rows ?? []).length);
  }
  if (check) {
    plain.push(check.expected?.value, check.measured?.value, check.delta);
    ratios.push(check.delta_pct, check.tolerance);
    for (const b of check.breakdown ?? []) {
      plain.push(b.expected, b.measured);
      ratios.push(b.delta_pct);
    }
  }
  const clean = (xs) => xs.filter((v) => typeof v === "number" && Number.isFinite(v)).map(Math.abs);
  return { plain: clean(plain), percent: clean(ratios).map((r) => r * 100) };
}

const matches = (n, decimals, scale, values) => values.some((v) => Math.abs(v / scale - n) <= 0.5 * 10 ** -decimals + 1e-9);

/**
 * @param {string | { en: string, tr: string }} sentence one language, or both (every language is checked)
 * @param {{ query?: object, check?: object|null, explore?: object|null }} refs
 * @returns {{ ok: boolean, unmatched: string[] }}
 */
export function validateSentence(sentence, refs) {
  if (sentence && typeof sentence === "object") {
    const all = Object.values(sentence).flatMap((s) => validateSentence(s, refs).unmatched);
    const unmatched = [...new Set(all)];
    return { ok: unmatched.length === 0, unmatched };
  }
  const truth = groundTruth(refs);
  const unmatched = [];
  for (const num of extractNumbers(sentence)) {
    const pool = num.percent ? truth.percent : truth.plain;
    if (!num.readings.some((r) => matches(r.value, r.decimals, num.scale, pool))) unmatched.push(num.raw);
  }
  return { ok: unmatched.length === 0, unmatched };
}
