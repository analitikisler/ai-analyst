// The orders file: an export from the shop (ikas, Ticimax, Shopify, WooCommerce or any table with one order per row),
// CSV or XLSX, at most 25 MB. Read on this machine only. The server guesses which column is which from Turkish and
// English headers, shows the daily aggregates, and on import keeps only those (date x channel x device: orders,
// revenue); the file itself is deleted. No order row, customer name, email, address or phone number is stored.
// Every cell is data, never an instruction.
import { Worker } from "node:worker_threads";
import { inflateRawSync } from "node:zlib";
import { AppError } from "../errors.js";
import { T } from "../text.js";
import { channelFrom, dateIn, deviceFrom } from "./attribution.js";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
// What an XLSX may unpack to: 50 times the file, at most 200 MB (an orders export of 25 MB unpacks to far less).
export const MAX_INFLATED = 200 * 1024 * 1024;
export const INFLATE_RATIO = 50;
export const inflateBudget = (fileBytes) => Math.min(MAX_INFLATED, Math.max(1024 * 1024, INFLATE_RATIO * fileBytes));
export const MAX_SHARED = 1_000_000;
const MAX_ROWS = 2_000_000;

// ---------------------------------------------------------------- reading the file

/** csv or xlsx from the name and the first bytes; null when it is neither. */
export function fileKind(name, head) {
  const zip = head?.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  const ext = String(name ?? "").toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? "";
  if (zip) return ext === "xlsx" || ext === "" || ext === "xlsm" ? "xlsx" : null;
  if (["xls", "xlsb", "ods", "numbers", "zip", "pdf"].includes(ext)) return null;
  // Text: no NUL bytes in the first 4 KB unless it is UTF-16 with a byte order mark.
  const bom16 = head?.length >= 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff));
  if (!bom16 && head && head.subarray(0, 4096).includes(0)) return null;
  return "csv";
}

const unreadable = (why) => new AppError("file_unreadable", `The file could not be read: ${why}. Export it again as CSV or XLSX.`, { params: { reason: why } });

/** Bytes to text: UTF-8 (with or without BOM), UTF-16 with a BOM, else Windows-1254 (Turkish Excel). */
export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  const body = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    try {
      return new TextDecoder("windows-1254").decode(body);
    } catch {
      return new TextDecoder("latin1").decode(body);
    }
  }
}

/** The delimiter of a CSV: the one of , ; tab | found most often outside quotes on the first line. */
function delimiterOf(text) {
  const counts = { ",": 0, ";": 0, "\t": 0, "|": 0 };
  let quoted = false;
  for (let i = 0; i < text.length && i < 64 * 1024; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ",";
}

/** RFC 4180 CSV (quotes doubled inside quoted fields, newlines inside quotes), any of four delimiters. */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const sep = delimiterOf(text);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row.map((x) => x.trim()));
      if (rows.length > MAX_ROWS) throw unreadable("more than 2 million rows");
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row.map((x) => x.trim()));
  return rows;
}

// --- XLSX: a zip of XML files. Only the first worksheet, its shared strings and the workbook are read.

/** The entries of a zip file: name → { method, size, offset, csize }. Zip64 and encrypted files are refused. */
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw unreadable("not a complete XLSX file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff || count === 0xffff) throw unreadable("the XLSX file is too large (zip64)");
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw unreadable("a damaged XLSX file");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (flags & 1) throw unreadable("the XLSX file is password protected");
    out.set(name.replace(/^\/+/, ""), { method, csize, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zipRead(buf, entries, name, budget) {
  const e = entries.get(name);
  if (!e) return null;
  const p = e.local;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) throw unreadable("a damaged XLSX file");
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + e.csize);
  if (e.size > budget.left) throw unreadable(`the XLSX file unpacks to more than ${Math.round(budget.max / 1048576)} MB`);
  let out;
  if (e.method === 0) out = data;
  else if (e.method === 8) {
    try {
      out = inflateRawSync(data, { maxOutputLength: Math.max(1, budget.left) });
    } catch {
      throw unreadable("a damaged or oversized XLSX file");
    }
  } else throw unreadable("an XLSX compression this app cannot read");
  budget.left -= out.length;
  return out.toString("utf8");
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] !== "#") return ENT[e.toLowerCase()];
    const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    // A reference past U+10FFFF (or a surrogate) is a damaged file, not a crash.
    if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw unreadable("a damaged character in the XLSX file");
    return String.fromCodePoint(cp);
  });
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
/** The text of an <si> or <is>: every <t>, without phonetic runs. */
const textOf = (xml) => unxml([...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map((m) => m[1] ?? "").join(""));

const colIndex = (ref) => {
  const letters = String(ref).match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Number formats that show a date or time (built-in ids, and custom codes with d, m, y or h outside quotes). */
function dateStyles(stylesXml) {
  const custom = new Map();
  for (const m of (stylesXml ?? "").matchAll(/<numFmt\b[^>]*>/g)) custom.set(Number(attr(m[0], "numFmtId")), unxml(attr(m[0], "formatCode") ?? ""));
  const isDateFmt = (id) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (id >= 27 && id <= 36) || (id >= 50 && id <= 58) || (custom.has(id) && /[dmyh]/i.test(custom.get(id).replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")));
  const xfs = (stylesXml ?? "").match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? "";
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => isDateFmt(Number(attr(m[0], "numFmtId") ?? 0)));
}

/** An Excel serial date (days since 1899-12-30, as local time) to "YYYY-MM-DD HH:mm:ss". */
export function serialToLocal(serial, date1904 = false) {
  const ms = Math.round((Number(serial) + (date1904 ? 1462 : 0)) * 86_400_000);
  const d = new Date(Date.UTC(1899, 11, 30) + ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace("T", " ");
}

/** The first worksheet as rows of text cells; date-formatted numbers become local times. */
export function parseXlsx(buf, { maxShared = MAX_SHARED } = {}) {
  const entries = zipEntries(buf);
  const max = inflateBudget(buf.length);
  const budget = { left: max, max };
  const workbook = zipRead(buf, entries, "xl/workbook.xml", budget);
  if (!workbook) throw unreadable("no workbook in the XLSX file");
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook);
  // The first sheet in the workbook's order, through its relationship id.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const first = workbook.match(/<sheet\b[^>]*>/)?.[0];
  const rid = first ? attr(first, "r:id") : null;
  const rels = zipRead(buf, entries, "xl/_rels/workbook.xml.rels", budget);
  if (rid && rels) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => attr(t, "Id") === rid);
    const target = rel ? attr(rel, "Target") : null;
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheet = zipRead(buf, entries, sheetPath, budget);
  if (!sheet) throw unreadable("no worksheet in the XLSX file");
  const sharedXml = zipRead(buf, entries, "xl/sharedStrings.xml", budget) ?? "";
  const shared = [];
  for (const m of sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
    if (shared.length >= maxShared) throw unreadable(`more than ${maxShared.toLocaleString("en")} different texts in the XLSX file`);
    shared.push(textOf(m[1] ?? "").slice(0, 4000));
  }
  const dates = dateStyles(zipRead(buf, entries, "xl/styles.xml", budget));
  const rows = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    let next = 0;
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1];
      const ref = attr(a, "r");
      const i = ref ? colIndex(ref) : next;
      next = i + 1;
      if (i > 500) continue;
      const t = attr(a, "t");
      const inner = cm[2] ?? "";
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (t === "s") value = shared[Number(v)] ?? "";
      else if (t === "inlineStr") value = textOf(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "");
      else if (t === "str" || t === "e") value = v != null ? unxml(v) : "";
      else if (t === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (v != null) {
        const s = Number(attr(a, "s") ?? 0);
        value = dates[s] && Number.isFinite(Number(v)) ? serialToLocal(v, date1904) ?? v : v;
      }
      row[i] = value.trim();
    }
    for (let i = 0; i < row.length; i++) row[i] ??= "";
    if (row.some((x) => x !== "")) rows.push(row);
    if (rows.length > MAX_ROWS) throw unreadable("more than 2 million rows");
  }
  return rows;
}

/** Reads a file into { columns, rows }; the header is the first row with at least two cells. */
export function readTable(buf, kind, opts = {}) {
  const all = kind === "xlsx" ? parseXlsx(buf, opts) : parseCsv(decodeText(buf));
  const h = all.findIndex((r) => r.filter((x) => x !== "").length >= 2);
  if (h < 0 || all.length - h < 2) throw unreadable("no header row and order rows were found");
  const header = all[h];
  const seen = new Map();
  const columns = header.map((c, i) => {
    let name = c || `Column ${i + 1}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if (n) name = `${name} (${n + 1})`;
    return name;
  });
  return { columns, rows: all.slice(h + 1) };
}

// ---------------------------------------------------------------- the mapping

const norm = (s) =>
  String(s ?? "")
    .toLocaleLowerCase("tr")
    .replace(/i̇/g, "i")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Header names, normalised (lower case, no Turkish letters, single spaces), best first. */
export const HEADERS = {
  order_id: ["order id", "order number", "order no", "order", "name", "siparis no", "siparis numarasi", "siparis id", "siparis kodu", "siparis", "id", "no"],
  created_at: ["created at", "order date", "date created", "order created", "created", "processed at", "date", "siparis tarihi", "olusturulma tarihi", "olusturma tarihi", "siparis olusturma tarihi", "kayit tarihi", "tarih"],
  status: ["order status", "status", "financial status", "payment status", "siparis durumu", "durum", "durumu", "odeme durumu"],
  total: ["order total", "total", "grand total", "total price", "order amount", "toplam tutar", "genel toplam", "siparis tutari", "siparis toplami", "odenen tutar", "toplam", "tutar"],
  currency: ["order currency", "currency", "currency code", "para birimi", "doviz", "doviz cinsi"],
  channel: ["channel", "sales channel", "source", "source name", "referring site", "kanal", "satis kanali", "kaynak", "siparis kaynagi"],
  utm_source: ["utm source", "utm kaynak", "origin", "attribution source"],
  utm_medium: ["utm medium", "utm ortam", "attribution medium"],
  device: ["device", "device type", "cihaz", "cihaz turu", "cihaz tipi", "platform"],
  user_agent: ["user agent", "useragent", "browser", "tarayici"],
};
const FIELDS = Object.keys(HEADERS);

const isTest = (v) => /\btest\b/.test(norm(v));
const isCancelled = (v) => /cancel|iptal|void|refund|iade/.test(norm(v));

/** Guesses the mapping from the header; exclude_statuses pre-selects test orders only. */
export function guessMapping(columns, rows = []) {
  const n = columns.map(norm);
  const used = new Set();
  const pick = (field) => {
    for (const h of HEADERS[field]) {
      const i = n.findIndex((c, j) => c === h && !used.has(j));
      if (i >= 0) {
        used.add(i);
        return columns[i];
      }
    }
    // A header that starts with a known name ("Toplam Tutar (TL)").
    for (const h of HEADERS[field]) {
      if (h.length < 4) continue;
      const i = n.findIndex((c, j) => c.startsWith(`${h} `) && !used.has(j));
      if (i >= 0) {
        used.add(i);
        return columns[i];
      }
    }
    return null;
  };
  const m = {};
  // Dates and totals first, so a generic name ("tarih", "tutar") does not take a better column's place.
  for (const f of ["created_at", "total", "order_id", "status", "currency", "utm_source", "utm_medium", "channel", "device", "user_agent"]) m[f] = pick(f);
  const mapping = Object.fromEntries(FIELDS.map((f) => [f, m[f] ?? null]));
  mapping.created_at ??= "";
  mapping.total ??= "";
  mapping.exclude_statuses = statusesOf({ columns, rows }, mapping.status).map((s) => s.value).filter(isTest);
  return mapping;
}

export function statusesOf({ columns, rows }, status) {
  const i = status ? columns.indexOf(status) : -1;
  if (i < 0) return [];
  const counts = new Map();
  for (const r of rows) {
    const v = r[i] ?? "";
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, 100);
}

/** Checks a mapping against the columns; returns it cleaned. */
export function checkMapping(columns, mapping) {
  const out = { exclude_statuses: [...new Set((mapping.exclude_statuses ?? []).map(String))].slice(0, 200) };
  for (const f of FIELDS) {
    const v = mapping[f] ?? null;
    if (v != null && v !== "" && !columns.includes(v)) throw new AppError("mapping_invalid", `The file has no column "${v}". Choose one of its columns.`, { params: { field: f, column: String(v).slice(0, 80) } });
    out[f] = v === "" ? null : v;
  }
  for (const f of ["created_at", "total"]) if (!out[f]) throw new AppError("mapping_invalid", `Choose the column with the order ${f === "created_at" ? "date" : "total"}.`, { params: { field: f } });
  out.created_at ??= "";
  return out;
}

// ---------------------------------------------------------------- values

/** 1.234,56 · 1,234.56 · 1234.56 · ₺1.234,56 · 1 234,56 TL → a number; null when it is not one. */
export function amountOf(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw ?? "").trim();
  if (!s) return null;
  const neg = /^-|^\(.*\)$|-$/.test(s.replace(/[^\d.,()-]/g, ""));
  s = s.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return null;
  const lc = s.lastIndexOf(",");
  const ld = s.lastIndexOf(".");
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lc >= 0) s = (s.match(/,/g).length === 1 && !/,\d{3}$/.test(s)) || /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  else if (ld >= 0 && (s.match(/\./g).length > 1)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const CURRENCY_ALIASES = { tl: "TRY", ytl: "TRY", "₺": "TRY", "$": "USD", "€": "EUR", "£": "GBP", usd: "USD", eur: "EUR", gbp: "GBP" };
export const currencyOf = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return CURRENCY_ALIASES[s.toLowerCase()] ?? s.toUpperCase();
};

/** The day of an order time in the chosen zone (see attribution.dateIn); also "YYYY-MM-DD HH:mm:ss" from XLSX. */
const dayOf = (raw, timeZone) => {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // Excel serials in a text cell (a CSV saved from Excel can carry them).
  if (/^\d{5}(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 80000) return serialToLocal(s)?.slice(0, 10) ?? null;
  return dateIn(s, timeZone);
};

// ---------------------------------------------------------------- aggregates

export const CANCELLED_NOTE = T("Cancelled orders are counted, as in the Orders metric. Exclude them here only if GA4 does not record them.", "İptal edilen siparişler, Siparişler metriğinde olduğu gibi sayılır. Bunları burada yalnızca GA4 kaydetmiyorsa hariç tutun.");

/**
 * The daily aggregates of a table under a mapping, and the preview of them.
 * @returns {{ rows: { date, channel, device, orders, revenue }[], preview: object }}
 */
export function aggregate({ columns, rows }, mapping, { timeZone = "Europe/Istanbul", currency }) {
  const col = (name) => (name ? columns.indexOf(name) : -1);
  const [ci, ti, si, cu, ch, us, um, dv, ua, oi] = [mapping.created_at, mapping.total, mapping.status, mapping.currency, mapping.channel, mapping.utm_source, mapping.utm_medium, mapping.device, mapping.user_agent, mapping.order_id].map(col);
  const exclude = new Set(mapping.exclude_statuses ?? []);
  const excluded = { status: 0, no_date: 0, bad_total: 0 };
  const byKey = new Map();
  const seen = new Set();
  let repeats = 0;
  const others = new Map();
  // Order ids that have a readable total on some row (line-item exports leave it empty on the other rows).
  const withTotal = new Set();
  if (oi >= 0 && ti >= 0) for (const r of rows) if (amountOf(r[ti]) != null) withTotal.add((r[oi] ?? "").trim());
  for (const r of rows) {
    const id = oi >= 0 ? (r[oi] ?? "").trim() : "";
    // Exports with one row per line item repeat the order id; the order counts once, on its first row with a total.
    if (id && seen.has(id)) {
      repeats++;
      continue;
    }
    if (si >= 0 && exclude.has(r[si] ?? "")) {
      excluded.status++;
      if (id) seen.add(id);
      continue;
    }
    const date = ci >= 0 ? dayOf(r[ci], timeZone) : null;
    if (!date) {
      excluded.no_date++;
      continue;
    }
    const total = ti >= 0 ? amountOf(r[ti]) : null;
    if (total == null) {
      if (!id || !withTotal.has(id)) excluded.bad_total++;
      continue;
    }
    if (id) seen.add(id);
    if (cu >= 0) {
      const c = currencyOf(r[cu]);
      if (c && c !== currency) others.set(c, (others.get(c) ?? 0) + 1);
    }
    const channel = channelFrom({ channel: ch >= 0 ? r[ch] : undefined, source: us >= 0 ? r[us] : undefined, medium: um >= 0 ? r[um] : undefined });
    const device = deviceFrom({ device: dv >= 0 ? r[dv] : undefined, userAgent: ua >= 0 ? r[ua] : undefined });
    const key = `${date}|${channel}|${device}`;
    const acc = byKey.get(key) ?? { date, channel, device, orders: 0, revenue: 0 };
    acc.orders += 1;
    acc.revenue += total;
    byKey.set(key, acc);
  }
  if (others.size) {
    const list = [...others.keys()].slice(0, 5).join(", ");
    throw new AppError("currency_mismatch", `The file has orders in ${list}, and this workspace writes money in ${currency}. Export the orders in ${currency}, or change the currency in Settings first.`, { params: { currency, found: list } });
  }
  const out = [...byKey.values()].map((r) => ({ ...r, revenue: Math.round(r.revenue * 100) / 100 }));
  const daily = new Map();
  const channels = new Map();
  const devices = new Map();
  for (const r of out) {
    const d = daily.get(r.date) ?? { date: r.date, orders: 0, revenue: 0 };
    d.orders += r.orders;
    d.revenue += r.revenue;
    daily.set(r.date, d);
    channels.set(r.channel, (channels.get(r.channel) ?? 0) + r.orders);
    devices.set(r.device, (devices.get(r.device) ?? 0) + r.orders);
  }
  const days = [...daily.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => ({ ...d, revenue: Math.round(d.revenue * 100) / 100 }));
  const warnings = [];
  const statuses = statusesOf({ columns, rows }, mapping.status);
  if (si >= 0 && statuses.some((s) => isCancelled(s.value) && !exclude.has(s.value))) warnings.push(CANCELLED_NOTE);
  if (days.length && [...devices.keys()].every((k) => k === "unknown")) warnings.push(T("No device column: the tracking checks run on totals, without a device split.", "Cihaz sütunu yok: ölçüm kontrolleri cihaz ayrımı olmadan toplamlar üzerinden çalışır."));
  if (days.length && [...channels.keys()].every((k) => k === "unknown")) warnings.push(T("No channel or UTM column: orders are not split by channel.", "Kanal veya UTM sütunu yok: siparişler kanala göre ayrılmaz."));
  if (repeats) warnings.push(T(`${repeats} ${repeats === 1 ? "row repeats" : "rows repeat"} an order number (one row per product); each order is counted once.`, `${repeats} satır bir sipariş numarasını tekrar ediyor (ürün başına bir satır); her sipariş bir kez sayılır.`));
  const sum = (k) => Math.round(days.reduce((s, d) => s + d[k], 0) * 100) / 100;
  const sorted = (m) => [...m].map(([key, orders]) => ({ key, orders })).sort((a, b) => b.orders - a.orders);
  return {
    rows: out,
    preview: { from: days[0]?.date ?? null, to: days.at(-1)?.date ?? null, days: days.length, orders: sum("orders"), revenue: sum("revenue"), currency, excluded, daily: days, channels: sorted(channels), devices: sorted(devices), warnings },
  };
}

// ---------------------------------------------------------------- XLSX in a worker

export const XLSX_WORKER_LIMITS = { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 };
export const XLSX_TIME_LIMIT_MS = 30_000;

/**
 * readTable, with an XLSX parsed in a worker thread under a memory limit and a time limit, so a crafted file cannot
 * take the server down. A limit hit is file_unreadable. CSV is read here (it has no unpacking step).
 * @param {Buffer} buf @param {"csv"|"xlsx"} kind @param {{ timeoutMs?: number, maxShared?: number }} [opts]
 */
export function readTableSafe(buf, kind, { timeoutMs = XLSX_TIME_LIMIT_MS, ...opts } = {}) {
  if (kind !== "xlsx") return Promise.resolve(readTable(buf, kind, opts));
  return new Promise((resolve, reject) => {
    const copy = new Uint8Array(buf.length);
    copy.set(buf);
    const worker = new Worker(new URL("./xlsx-worker.js", import.meta.url), { workerData: { bytes: copy, opts }, transferList: [copy.buffer], resourceLimits: XLSX_WORKER_LIMITS });
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      fn(v);
    };
    const timer = setTimeout(() => finish(reject, unreadable("the XLSX file took too long to read")), timeoutMs);
    worker.once("message", (m) => {
      if (m?.ok) finish(resolve, m.table);
      else if (m?.error?.code) finish(reject, new AppError(m.error.code, m.error.message, { params: m.error.params ?? {} }));
      else finish(reject, unreadable("a damaged XLSX file"));
    });
    // Out of memory (ERR_WORKER_OUT_OF_MEMORY) or any crash in the worker: the file is not readable here.
    worker.once("error", (err) => finish(reject, unreadable(err?.code === "ERR_WORKER_OUT_OF_MEMORY" ? "the XLSX file needs too much memory to read" : "a damaged XLSX file")));
    worker.once("exit", (code) => finish(reject, unreadable(code ? "the XLSX file needs too much memory to read" : "a damaged XLSX file")));
  });
}
