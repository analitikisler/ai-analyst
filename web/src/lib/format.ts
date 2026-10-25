// Number and date formatting per language, matching what the server writes (ai-analyst src/format.js), so a
// figure in a chart reads exactly like the same figure in the answer sentence:
//   en 2,753 · 4.2% · −10.1% · 1.84M TL ($1.84M on USD) · 2.66× · 9 Oct 2026 · 9–22 Oct 2026
//   tr 2.753 · %4,2 · −%10,1 · 1,84 mn TL · 2,66× · 9 Eki 2026 · 9–22 Eki 2026
// The browser never computes a figure; these only format values the API returned. Missing values read "–".
import { useMemo, useSyncExternalStore } from "react";
import type { Lang, Unit } from "@/api/types";
import { COPY, fmt, plural, useLang } from "@/i18n";

/** True minus sign (U+2212) for negative numbers. */
export const MINUS = "−";
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const group = (digits: string, sep: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);

export const MONTHS: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  tr: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"],
};

const MONTHS_LONG_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
/** Ablative with the apostrophe and vowel harmony: "9 Ekim’den", "25 Temmuz’dan", "1 Ağustos’tan". */
const ABL_TR = ["tan", "tan", "tan", "dan", "tan", "dan", "dan", "tan", "den", "den", "dan", "tan"];
export function trFrom(isoDate: string): string {
  const d = parseISODate(isoDate);
  return `${d.getUTCDate()} ${MONTHS_LONG_TR[d.getUTCMonth()]}’${ABL_TR[d.getUTCMonth()]}`;
}
/** "9 Ekim" */
export function trLong(isoDate: string): string {
  const d = parseISODate(isoDate);
  return `${d.getUTCDate()} ${MONTHS_LONG_TR[d.getUTCMonth()]}`;
}
/** Turkish locative for a clock time, read aloud: "09:00’da", "18:40’ta", "10:15’te". */
const LOC_UNITS = ["da", "de", "de", "te", "te", "te", "da", "de", "de", "da"];
const LOC_TENS = ["da", "da", "de", "da", "ta", "de"];
export function trAtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const n = m === 0 ? h : m;
  const suffix = n === 0 ? "da" : n % 10 !== 0 ? LOC_UNITS[n % 10]! : LOC_TENS[Math.floor(n / 10) % 6]!;
  return `${hhmm}’${suffix}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

// The workspace currency (ISO 4217, AppState.currency). One per workspace; set when /api/state arrives.
export const CURRENCY_DEFAULT = "TRY";
let currentCurrency = CURRENCY_DEFAULT;
const listeners = new Set<() => void>();
export function setCurrency(code: string | null | undefined) {
  const next = typeof code === "string" && /^[A-Z]{3}$/.test(code) ? code : CURRENCY_DEFAULT;
  if (next === currentCurrency) return;
  currentCurrency = next;
  listeners.forEach((l) => l());
}
export const getCurrency = () => currentCurrency;
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
/** The short mark money carries: "TL", "$", "€", "£", else the code. */
export const currencyMark = (code: string) => SYMBOL[code] ?? (code === "TRY" ? "TL" : code);

export function createFormat(lang: Lang, currency: string = currentCurrency) {
  const t = COPY[lang].format;
  const dash = t.dash;
  const thousands = lang === "tr" ? "." : ",";
  const decimal = lang === "tr" ? "," : ".";

  const int = (n: number | null | undefined): string => {
    if (!isNum(n)) return dash;
    const r = Math.round(Math.abs(n));
    return (n < 0 && r !== 0 ? MINUS : "") + group(String(r), thousands);
  };

  const dec = (n: number | null | undefined, d: number): string => {
    if (!isNum(n)) return dash;
    const [whole, frac] = Math.abs(n).toFixed(d).split(".");
    const body = group(whole!, thousands) + (frac ? decimal + frac : "");
    return (n < 0 && Number(Math.abs(n).toFixed(d)) !== 0 ? MINUS : "") + body;
  };

  /** A ratio as a percentage: 0.042 → "4.2%" / "%4,2". `signed` adds "+" to positive values. */
  const pct = (r: number | null | undefined, d = 1, signed = false): string => {
    if (!isNum(r)) return dash;
    const v = dec(Math.abs(r * 100), d);
    const zero = Number(Math.abs(r * 100).toFixed(d)) === 0;
    const sign = zero ? "" : r < 0 ? MINUS : signed && r > 0 ? "+" : "";
    return lang === "tr" ? `${sign}%${v}` : `${sign}${v}%`;
  };

  /**
   * Money in the workspace currency, as the server writes it. TRY: "1.84M TL" / "1,84 mn TL", "48,210 TL" /
   * "48.210 TL". USD, EUR, GBP: "$48,210", "$1.84M" (en) / "48.210 $", "1,84 mn $" (tr). Other codes go after.
   */
  const mark = currencyMark(currency);
  const symbolFirst = lang !== "tr" && Boolean(SYMBOL[currency]);
  const withMark = (body: string) => (symbolFirst ? (body.startsWith(MINUS) ? `${MINUS}${mark}${body.slice(1)}` : `${mark}${body}`) : `${body} ${mark}`);
  const tryMoney = (n: number | null | undefined): string => {
    if (!isNum(n)) return dash;
    if (Math.abs(n) >= 1e6) return withMark(fmt(t.million, { value: dec(n / 1e6, 2) }));
    return withMark(int(n));
  };
  const money = tryMoney;

  const ratio = (n: number | null | undefined): string => (isNum(n) ? fmt(t.ratio, { value: dec(n, 2) }) : dash);

  /** A value in its metric's unit (count | try | pct | ratio). */
  const value = (v: number | null | undefined, unit: Unit): string => {
    if (!isNum(v)) return dash;
    if (unit === "try") return tryMoney(v);
    if (unit === "pct") return pct(v, 2);
    if (unit === "ratio") return ratio(v);
    return int(v);
  };

  /** Compact axis tick: "12.5k", "1.2M" / "12,5 bin", "1,2 mn". */
  const compact = (v: number | null | undefined, unit: Unit = "count"): string => {
    if (!isNum(v)) return dash;
    if (unit === "pct") return pct(v, 0);
    if (unit === "ratio") return ratio(v);
    const abs = Math.abs(v);
    const sign = v < 0 ? MINUS : "";
    const [div, suffix] = abs >= 1e6 ? [1e6, lang === "tr" ? " mn" : "M"] : abs >= 1e4 ? [1e3, lang === "tr" ? " bin" : "k"] : [1, ""];
    const body = div === 1 ? int(abs) : dec(abs / div, abs / div >= 100 ? 0 : 1).replace(new RegExp(`\\${decimal}0$`), "");
    if (unit === "try" && symbolFirst) return `${sign}${mark}${body}${suffix}`;
    return `${sign}${body}${suffix}`;
  };

  /** "9 Oct" or "9 Oct 2026" / "9 Eki 2026". */
  const date = (iso: string | null | undefined, withYear = false): string => {
    if (!iso) return dash;
    const d = parseISODate(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.getUTCDate()} ${MONTHS[lang][d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ""}`;
  };

  /** "9–22 Oct 2026", "25 Sep–22 Oct 2026", one date when both ends are equal. */
  const range = (from: string, to: string): string => {
    if (from === to) return date(from, true);
    if (from.slice(0, 7) === to.slice(0, 7)) return `${parseISODate(from).getUTCDate()}–${date(to, true)}`;
    if (from.slice(0, 4) === to.slice(0, 4)) return `${date(from)}–${date(to, true)}`;
    return `${date(from, true)}–${date(to, true)}`;
  };

  /** "just now", "5 minutes ago", "2 hours ago", "3 days ago", then the date. */
  const relativeTime = (iso: string | null | undefined, nowMs: number = Date.now()): string => {
    if (!iso) return dash;
    const ms = new Date(iso).getTime();
    if (Number.isNaN(ms)) return dash;
    const s = Math.round((nowMs - ms) / 1000);
    if (s < 45) return t.justNow;
    const m = Math.round(s / 60);
    if (m < 60) return plural(lang, m, t.minutesAgo);
    const h = Math.round(m / 60);
    if (h < 24) return plural(lang, h, t.hoursAgo);
    const days = Math.round(h / 24);
    if (days < 7) return plural(lang, days, t.daysAgo);
    return date(new Date(ms).toISOString().slice(0, 10), true);
  };

  /** Percentage points, for rates: "0.3 points" / "0,3 puan". */
  const points = (diff: number): string => plural(lang, Math.abs(diff), t.points, { count: dec(Math.abs(diff), 1) });

  /**
   * A change against the previous period, as a signed figure plus a word ("up 4.2%" / "%4,2 arttı").
   * Data deltas are neutral (red is for check gaps only). Rates change in points; small counts (previous
   * under 30) in absolute numbers, not percentages (06-data.md §2).
   */
  const delta = (current: number | null | undefined, previous: number | null | undefined, unit: Unit) => {
    if (!isNum(current) || !isNum(previous)) return { text: dash, sentence: t.noPrevious, direction: "none" as const };
    const diff = current - previous;
    const direction = diff > 0 ? ("up" as const) : diff < 0 ? ("down" as const) : ("flat" as const);
    let body: string;
    if (unit === "pct") body = points(diff * 100);
    else if (unit === "count" && Math.abs(previous) < 30) body = int(Math.abs(diff));
    else if (previous === 0) return { text: dash, sentence: t.noPrevious, direction: "none" as const };
    else body = pct(Math.abs(diff / previous), 1);
    const signed = direction === "up" ? `+${body}` : direction === "down" ? `${MINUS}${body}` : body;
    const sentence = direction === "flat" ? t.noChange : fmt(direction === "up" ? t.up : t.down, { value: body });
    return { text: signed, sentence, direction };
  };

  /** Bytes: "4.1 MB" / "4,1 MB", "2 GB". */
  const bytes = (n: number | null | undefined): string => {
    if (!isNum(n)) return dash;
    const [div, k] = n >= 1024 ** 3 ? [1024 ** 3, "gb"] : n >= 1024 ** 2 ? [1024 ** 2, "mb"] : n >= 1024 ? [1024, "kb"] : [1, "b"];
    const v = n / div;
    return fmt(t.bytes[k as "b" | "kb" | "mb" | "gb"], { v: Number.isInteger(Math.round(v * 10) / 10) ? int(v) : dec(v, 1) });
  };

  const pad = (x: number) => String(x).padStart(2, "0");
  /** Local time of day for an ISO timestamp: "09:12". */
  const time = (iso: string | null | undefined): string => {
    if (!iso) return dash;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? dash : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  /** "Today 09:12", "Yesterday 18:40", or "23 Oct 2026, 09:00". */
  const when = (iso: string | null | undefined, nowMs: number = Date.now()): string => {
    if (!iso) return dash;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return dash;
    const day = localDay(d);
    const today = localDay(new Date(nowMs));
    const yesterday = localDay(new Date(nowMs - 86400000));
    if (day === today) return fmt(t.today_at, { time: time(iso) });
    if (day === yesterday) return fmt(t.yesterday_at, { time: time(iso) });
    return fmt(t.at, { date: date(day, true), time: time(iso) });
  };
  /** The same inside a sentence: "yesterday at 09:00" / "dün 09:00’da". */
  const whenMid = (iso: string | null | undefined, nowMs: number = Date.now()): string => {
    if (!iso) return dash;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return dash;
    const day = localDay(d);
    const clock = lang === "tr" ? trAtTime(time(iso)) : time(iso);
    if (day === localDay(new Date(nowMs))) return fmt(t.today_mid, { time: clock });
    if (day === localDay(new Date(nowMs - 86400000))) return fmt(t.yesterday_mid, { time: clock });
    return fmt(t.at_mid, { date: date(day, true), time: clock });
  };
  /** A date inside a sentence: "9 Oct" / "9 Ekim". */
  const dateLong = (iso: string | null | undefined): string => (!iso ? dash : lang === "tr" ? trLong(iso) : date(iso));
  /** A since-date inside a sentence: "9 Oct" / "9 Ekim’den" (the Turkish templates add "beri"). */
  const since = (iso: string | null | undefined): string => (!iso ? dash : lang === "tr" ? trFrom(iso) : date(iso));

  return { lang, currency, currencyMark: mark, dash, int, dec, pct, tryMoney, money, ratio, value, compact, date, range, relativeTime, points, delta, bytes, time, when, whenMid, since, dateLong, localDay };
}

export type Format = ReturnType<typeof createFormat>;
const cache = new Map<string, Format>();
export const formatFor = (lang: Lang, currency: string = currentCurrency): Format => {
  const k = `${lang}:${currency}`;
  let f = cache.get(k);
  if (!f) cache.set(k, (f = createFormat(lang, currency)));
  return f;
};

/** Formatters bound to the current language and the workspace currency. */
export function useFormat(): Format {
  const lang = useLang();
  const currency = useSyncExternalStore(subscribe, getCurrency, getCurrency);
  return useMemo(() => formatFor(lang, currency), [lang, currency]);
}
