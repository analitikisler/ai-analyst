// Parses one XLSX file off the main thread (see readTableSafe in orders-file.js): the bytes in, { columns, rows } or
// the error out. Runs under the worker's memory limit; the parent ends it on its time limit.
import { parentPort, workerData } from "node:worker_threads";
import { readTable } from "./orders-file.js";

try {
  const table = readTable(Buffer.from(workerData.bytes.buffer, workerData.bytes.byteOffset, workerData.bytes.byteLength), "xlsx", workerData.opts ?? {});
  parentPort.postMessage({ ok: true, table });
} catch (err) {
  parentPort.postMessage({ ok: false, error: { code: err?.code ?? "file_unreadable", message: err?.code ? err.message : "The file could not be read: a damaged XLSX file. Export it again as CSV or XLSX.", params: err?.params ?? {} } });
}
