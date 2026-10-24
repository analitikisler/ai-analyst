// Calendar arithmetic on YYYY-MM-DD strings (UTC, so a date never shifts by a time zone).

export const parseISO = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
export const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(s: string, n: number): string {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Days from a to b (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);

/** Monday of the ISO week that holds the date. */
export function weekStart(s: string): string {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return iso(d);
}

export const monthStart = (s: string) => `${s.slice(0, 7)}-01`;

export function monthEnd(s: string): string {
  const d = parseISO(monthStart(s));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return iso(d);
}

export function addMonths(s: string, n: number): string {
  const d = parseISO(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = parseISO(monthEnd(iso(d))).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
}

/** Every date from a to b inclusive. */
export function eachDay(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}
