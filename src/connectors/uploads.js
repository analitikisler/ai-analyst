// Uploaded orders files: streamed to <data_dir>/uploads/ (mode 0600) by POST /api/uploads/orders, read for the
// preview, deleted on import, on a new upload's prune after an hour, or when the person chooses another file.
// Only the file name, kind, size and the chosen mapping are kept in the app database while the upload lives.
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { AppError } from "../errors.js";
import { newId } from "../store/store.js";
import { validTimeZone } from "./attribution.js";
import { aggregate, checkMapping, fileKind, guessMapping, MAX_UPLOAD_BYTES, readTableSafe, statusesOf } from "./orders-file.js";

export const UPLOAD_TTL_MS = 60 * 60 * 1000;
export const uploadsDir = (config) => path.join(config.dataDir, "uploads");

/** Deletes uploads older than an hour (files and records), and stray files with no record. */
export function pruneUploads(app, now = Date.now()) {
  const dir = uploadsDir(app.config);
  for (const u of app.store.list("uploads", { limit: 1000 })) {
    if (now - Date.parse(u.created_at) > UPLOAD_TTL_MS) dropUpload(app, u.id);
  }
  if (!existsSync(dir)) return;
  const live = new Set(app.store.list("uploads", { limit: 1000 }).map((u) => path.basename(u.file)));
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    try {
      if (!live.has(f) && now - statSync(p).mtimeMs > 60_000) rmSync(p, { force: true });
    } catch {}
  }
}

export function dropUpload(app, id) {
  const u = app.store.get("uploads", id);
  if (u?.file) rmSync(u.file, { force: true });
  app.store.remove("uploads", id);
  if (app.uploadCache?.id === id) app.uploadCache = null;
}

/**
 * Streams a request body to a new upload file; refuses more than 25 MB without reading the rest.
 * @returns {Promise<{ file: string, size: number }>}
 */
export async function receiveUpload(app, req, ext) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > MAX_UPLOAD_BYTES) throw tooLarge();
  const dir = uploadsDir(app.config);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${newId("up")}.${ext}`);
  const out = createWriteStream(file, { flags: "wx", mode: 0o600 });
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) throw tooLarge();
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    rmSync(file, { force: true });
    throw err;
  }
  if (!size) {
    rmSync(file, { force: true });
    throw new AppError("file_unreadable", "The file is empty.", { params: { reason: "empty" } });
  }
  return { file, size };
}
const tooLarge = () => new AppError("upload_too_large", "The file is larger than 25 MB. Export a shorter period, or only the order columns.", { params: { max: MAX_UPLOAD_BYTES } });

async function tableOf(app, u) {
  if (app.uploadCache?.id === u.id) return app.uploadCache.table;
  if (!existsSync(u.file)) throw new AppError("upload_not_found", "The uploaded file is gone (uploads are kept for an hour). Choose the file again.");
  const table = await readTableSafe(readFileSync(u.file), u.kind);
  app.uploadCache = { id: u.id, table };
  return table;
}

function view(app, u, table) {
  const { preview } = aggregate(table, u.mapping, { timeZone: u.time_zone, currency: app.config.currency });
  return { upload_id: u.id, file_name: u.file_name, kind: u.kind, columns: table.columns, mapping: u.mapping, statuses: statusesOf(table, u.mapping.status), time_zone: u.time_zone, preview };
}

/** Registers a received file: checks it is CSV or XLSX and readable, guesses the mapping, returns OrdersUpload. */
export async function createUpload(app, { file, size, fileName }) {
  pruneUploads(app);
  const head = readFileSync(file).subarray(0, 4096);
  const kind = fileKind(fileName, head);
  if (!kind) {
    rmSync(file, { force: true });
    throw new AppError("upload_kind", "Choose a CSV or XLSX file (an older .xls file can be saved as XLSX from Excel).", { params: { name: String(fileName).slice(0, 120) } });
  }
  let table;
  try {
    table = await readTableSafe(readFileSync(file), kind);
  } catch (err) {
    rmSync(file, { force: true });
    throw err;
  }
  const mapping = guessMapping(table.columns, table.rows);
  const u = { id: newId("up"), file, file_name: String(fileName || `orders.${kind}`).slice(0, 200), kind, size, mapping, time_zone: app.config.connectors.ordersFile.timeZone, created_at: new Date().toISOString() };
  // One upload at a time: a new file replaces the one before.
  for (const old of app.store.list("uploads", { limit: 100 })) dropUpload(app, old.id);
  app.store.put("uploads", u);
  app.uploadCache = { id: u.id, table };
  // A file without a date or a total column still gets its preview, with the mapping to fix.
  if (!mapping.created_at || !mapping.total) return { upload_id: u.id, file_name: u.file_name, kind, columns: table.columns, mapping, statuses: statusesOf(table, mapping.status), time_zone: u.time_zone, preview: emptyPreview(app) };
  return view(app, u, table);
}

const emptyPreview = (app) => ({ from: null, to: null, days: 0, orders: 0, revenue: 0, currency: app.config.currency, excluded: { status: 0, no_date: 0, bad_total: 0 }, daily: [], channels: [], devices: [], warnings: [] });

function liveUpload(app, id) {
  const u = app.store.get("uploads", id);
  if (!u || Date.now() - Date.parse(u.created_at) > UPLOAD_TTL_MS) {
    if (u) dropUpload(app, id);
    throw new AppError("upload_not_found", "The uploaded file is gone (uploads are kept for an hour). Choose the file again.");
  }
  return u;
}

const zoneOf = (tz, fallback) => {
  if (tz == null) return fallback;
  const z = validTimeZone(tz);
  if (!z) throw new AppError("invalid_input", "Choose a time zone such as Europe/Istanbul.", { params: { time_zone: String(tz).slice(0, 60) } });
  return z;
};

/** A new mapping or time zone, and the preview under it. */
export async function previewUpload(app, { upload_id, mapping, time_zone }) {
  const u = liveUpload(app, upload_id);
  const table = await tableOf(app, u);
  const next = { ...u, mapping: mapping ? checkMapping(table.columns, mapping) : u.mapping, time_zone: zoneOf(time_zone, u.time_zone) };
  app.store.put("uploads", next);
  if (!next.mapping.created_at || !next.mapping.total) return { ...view(app, { ...next, mapping: { ...next.mapping } }, { columns: table.columns, rows: [] }), preview: emptyPreview(app) };
  return view(app, next, table);
}

/** The aggregates under the final mapping; the caller stores them, then the file is deleted. */
export async function uploadAggregates(app, { upload_id, mapping, time_zone }) {
  const u = liveUpload(app, upload_id);
  const table = await tableOf(app, u);
  const m = checkMapping(table.columns, mapping);
  const tz = zoneOf(time_zone, u.time_zone);
  const { rows, preview } = aggregate(table, m, { timeZone: tz, currency: app.config.currency });
  if (!preview.days) throw new AppError("mapping_invalid", "No orders are left to import with this mapping. Check the date and total columns and the excluded statuses.", { params: { field: "created_at" } });
  return { upload: u, rows, preview, mapping: m, time_zone: tz };
}
