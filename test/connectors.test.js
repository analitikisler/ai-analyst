// The connectors, with every outside call stubbed: the host checks, the orders file parser (CSV variants, XLSX,
// Turkish headers, bad files, zip bombs), GA4, Shopify and WooCommerce (mapping, paging, errors, the no-cloud
// refusal, aggregates only, write scopes refused) and the local mart (0 on a covered day, NULL on another).
// Everything a test writes goes in a folder from tempDir, removed at exit; no test makes unbounded data.
import "./setup.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createDeflateRaw, deflateRawSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { checkUrl, connectorFetch, embeddedV4, isPrivateAddress, pinnedRequest } from "../src/connectors/net.js";
import { amountOf, decodeText, fileKind, guessMapping, aggregate, parseCsv, readTable, checkMapping, CANCELLED_NOTE, inflateBudget, MAX_INFLATED } from "../src/connectors/orders-file.js";
import { channelOfGroup, deviceOfCategory, fetchGa4Days, ga4Error, ga4Transport, propertyId } from "../src/connectors/ga4.js";
import { fetchShopifyDays, shopDomain, shopifyClient, shopifyInfo } from "../src/connectors/shopify.js";
import { fetchWooDays, shopUrl, slimOrder, wooCheckScope, wooClient } from "../src/connectors/woocommerce.js";
import { buildLocalWarehouse, replaceLanding } from "../src/connectors/local.js";
import { remoteStates, switchNote } from "../src/connectors/index.js";
import { channelFrom } from "../src/connectors/attribution.js";
import { loadConfig } from "../src/config.js";
import { createServer } from "node:net";
import { callAction } from "../src/actions/index.js";
import { ctxFor, demoWorkspace, tempDir } from "./helpers.js";

const open = [];
after(() => open.forEach((w) => w.close()));
const codeIs = (code) => (e) => {
  assert.equal(e.code, code, e.message);
  return true;
};
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

// ---------------------------------------------------------------- host checks

test("host checks: https on the fixed host only; no IP, private, link-local, local names, credentials or redirects", async () => {
  const hosts = ["shop.example.com"];
  assert.equal(checkUrl("https://shop.example.com/wp-json/", hosts).hostname, "shop.example.com");
  assert.equal(checkUrl("https://SHOP.example.com./x", hosts).hostname, "shop.example.com.");
  for (const bad of [
    "http://shop.example.com/",
    "ftp://shop.example.com/",
    "https://other.example.com/",
    "https://shop.example.com.evil.test/",
    "https://127.0.0.1/",
    "https://10.0.0.5/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://[fe80::1]/",
    "https://localhost/",
    "https://printer.local/",
    "https://metadata.google.internal/",
    "https://user:pass@shop.example.com/",
    "not a url",
  ]) {
    assert.throws(() => checkUrl(bad, (h) => h !== "other.example.com" && h !== "shop.example.com.evil.test" ? true : hosts.includes(h)), codeIs("host_not_allowed"), bad);
  }
  for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "0.0.0.0", "100.64.0.1", "224.0.0.1", "::1", "fe80::1", "fc00::1", "fd12::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1"]) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2a00:1450::1"]) assert.equal(isPrivateAddress(ip), false, ip);

  // Through the guarded fetch, with a stub: the checks still run, redirects are asked to error and a 3xx is refused.
  const seen = [];
  const app = { connectorFetch: async (url, init) => (seen.push([url, init.redirect]), url.endsWith("/moved") ? new Response("", { status: 302, headers: { Location: "https://evil.test/" } }) : json({ ok: true })) };
  const call = connectorFetch(app, { service: "WooCommerce", hosts });
  assert.equal((await call("https://shop.example.com/ok")).status, 200);
  await assert.rejects(call("https://shop.example.com/moved"), codeIs("host_not_allowed"));
  await assert.rejects(call("https://evil.test/"), codeIs("host_not_allowed"));
  await assert.rejects(call("http://shop.example.com/ok"), codeIs("host_not_allowed"));
  assert.deepEqual(seen.map((s) => s[1]), ["error", "error"]);
  assert.ok(seen.every(([u]) => new URL(u).hostname === "shop.example.com"));

  // A network failure is shop_unreachable, never the stack.
  const down = connectorFetch({ connectorFetch: async () => { throw new Error("ECONNRESET at /secret/path"); } }, { service: "Shopify", hosts });
  await assert.rejects(down("https://shop.example.com/"), (e) => e.code === "shop_unreachable" && !/secret/.test(e.message));

  assert.equal(shopUrl("http://shop.example.com"), null, "plain http is never upgraded silently");
  assert.equal(shopUrl("shop.example.com/"), "https://shop.example.com");
  assert.equal(shopUrl("https://10.0.0.1"), null);
  assert.equal(shopUrl("shop.example.com/wp-json/wc/v3"), "https://shop.example.com");
  assert.equal(shopDomain("Ornek"), "ornek.myshopify.com");
  assert.equal(shopDomain("https://ornek.myshopify.com/admin/orders"), "ornek.myshopify.com");
  assert.equal(shopDomain("ornek.myshopify.com.evil.test"), null);
  assert.equal(shopDomain("shop.example.com"), null);
});

test("no-cloud: without a stub every connector refuses before anything is resolved or sent", async () => {
  assert.equal(process.env.AI_ANALYST_NO_CLOUD, "1");
  const call = connectorFetch({}, { service: "Shopify", hosts: ["ornek.myshopify.com"] });
  await assert.rejects(call("https://ornek.myshopify.com/admin/api/2025-07/graphql.json"), codeIs("no_cloud"));
  // Even an address the host checks would refuse says no_cloud first: nothing is looked up.
  await assert.rejects(call("https://127.0.0.1/"), codeIs("no_cloud"));
  await assert.rejects(ga4Transport({}, { kind: "adc" }), codeIs("no_cloud"));
  await assert.rejects(fetchShopifyDays(shopifyClient({}, "ornek.myshopify.com", "shpat_x"), { from: "2026-10-01", to: "2026-10-01", timeZone: "Europe/Istanbul" }), codeIs("no_cloud"));
  await assert.rejects(fetchWooDays(wooClient({}, "https://shop.example.com", "ck_x", "cs_x"), { from: "2026-10-01", to: "2026-10-01", timeZone: "Europe/Istanbul" }), codeIs("no_cloud"));

  // Through the actions too: a test without stubs ends in no_cloud, not in a step that reached the network.
  const ws = await demoWorkspace({ seed: false });
  open.push(ws);
  await assert.rejects(callAction("test_shopify", { shop: "ornek", token: "shpat_00000000" }, ctxFor(ws)), codeIs("no_cloud"));
  await assert.rejects(callAction("test_woocommerce", { url: "https://shop.example.com", key: "ck_0000", secret: "cs_0000" }, ctxFor(ws)), codeIs("no_cloud"));
  const key = path.join(ws.dir, "sa.json");
  writeFileSync(key, JSON.stringify({ type: "service_account", client_email: "x@p.iam.gserviceaccount.com" }));
  await assert.rejects(callAction("test_ga4", { property_id: "123456789", auth: { kind: "key_file", path: key } }, ctxFor(ws)), codeIs("no_cloud"));
});

// ---------------------------------------------------------------- the orders file: CSV

const TR_HEADER = ["Sipariş No", "Sipariş Tarihi", "Sipariş Durumu", "Toplam Tutar (TL)", "Para Birimi", "Kanal", "Cihaz", "Müşteri E-posta"];

test("CSV: four delimiters, quotes, newlines in quotes, CRLF and blank lines", () => {
  for (const sep of [",", ";", "\t", "|"]) {
    const t = parseCsv(["a", "b", "c"].join(sep) + "\r\n" + ["1", '"x' + sep + 'y"', "3"].join(sep) + "\r\n\r\n" + ["4", "5", "6"].join(sep));
    assert.deepEqual(t, [["a", "b", "c"], ["1", `x${sep}y`, "3"], ["4", "5", "6"]], JSON.stringify(sep));
  }
  assert.deepEqual(parseCsv('id,note\n1,"line one\nline two ""quoted"""\n'), [["id", "note"], ["1", 'line one\nline two "quoted"']]);
  assert.deepEqual(parseCsv("﻿a;b\n1;2"), [["a", "b"], ["1", "2"]]);
});

test("CSV: UTF-8 with and without a BOM, UTF-16 with a BOM, Windows-1254 (Turkish Excel)", () => {
  const text = "Sipariş No;Toplam\nŞ-1;₺1.234,56\n";
  assert.equal(decodeText(Buffer.from(text, "utf8")), text);
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")])), text);
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")])), text);
  // "Sipariş Tarihi;Ödeme Durumu\nİptal;Ağ" in Windows-1254: ş FE, Ö D6, İ DD, ğ F0.
  const cp1254 = Buffer.from([0x53, 0x69, 0x70, 0x61, 0x72, 0x69, 0xfe, 0x20, 0x54, 0x61, 0x72, 0x69, 0x68, 0x69, 0x3b, 0xd6, 0x64, 0x65, 0x6d, 0x65, 0x0a, 0xdd, 0x70, 0x74, 0x61, 0x6c, 0x3b, 0x41, 0xf0]);
  assert.equal(decodeText(cp1254), "Sipariş Tarihi;Ödeme\nİptal;Ağ");
  const t = readTable(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("a\tb\n1\t2\n", "utf16le")]), "csv");
  assert.deepEqual(t, { columns: ["a", "b"], rows: [["1", "2"]] });
});

test("Turkish and English headers: the mapping guess, test orders pre-selected, cancelled counted with a note", () => {
  const rows = [
    ["1001", "20.10.2026 10:15", "Tamamlandı", "1.234,56", "TL", "Instagram", "Mobil", "ayse@example.com"],
    ["1002", "20.10.2026 23:59", "İptal Edildi", "100,00", "TRY", "Organik", "Masaüstü", "can@example.com"],
    ["1003", "21.10.2026 09:00", "Test Siparişi", "50", "TL", "Google Ads", "mobile", "x@example.com"],
    ["1004", "", "Tamamlandı", "10", "TL", "", "", ""],
    ["1005", "21.10.2026 09:00", "Tamamlandı", "abc", "TL", "", "", ""],
  ];
  const m = guessMapping(TR_HEADER, rows);
  assert.deepEqual(
    { order_id: m.order_id, created_at: m.created_at, status: m.status, total: m.total, currency: m.currency, channel: m.channel, device: m.device },
    { order_id: "Sipariş No", created_at: "Sipariş Tarihi", status: "Sipariş Durumu", total: "Toplam Tutar (TL)", currency: "Para Birimi", channel: "Kanal", device: "Cihaz" },
  );
  assert.deepEqual(m.exclude_statuses, ["Test Siparişi"]);
  const { rows: out, preview } = aggregate({ columns: TR_HEADER, rows }, checkMapping(TR_HEADER, m), { timeZone: "Europe/Istanbul", currency: "TRY" });
  assert.deepEqual(out.sort((a, b) => a.channel.localeCompare(b.channel)), [
    { date: "2026-10-20", channel: "meta_ads", device: "mobile", orders: 1, revenue: 1234.56 },
    { date: "2026-10-20", channel: "organic", device: "desktop", orders: 1, revenue: 100 },
  ]);
  assert.deepEqual(preview.excluded, { status: 1, no_date: 1, bad_total: 1 });
  assert.equal(preview.orders, 2);
  assert.ok(preview.warnings.some((w) => w.en === CANCELLED_NOTE.en));
  // Aggregates only: no order id, email or status survives into a row.
  assert.doesNotMatch(JSON.stringify({ out, preview }), /@example\.com|1001|Tamamlandı/);

  const en = ["Name", "Created at", "Financial Status", "Total", "Currency", "Referring Site", "Email"];
  const g = guessMapping(en, []);
  assert.deepEqual([g.order_id, g.created_at, g.status, g.total, g.currency, g.channel], ["Name", "Created at", "Financial Status", "Total", "Currency", "Referring Site"]);
  assert.throws(() => checkMapping(en, { ...g, total: "Nope" }), codeIs("mapping_invalid"));
  assert.throws(() => checkMapping(en, { ...g, created_at: "" }), codeIs("mapping_invalid"));
});

test("amounts, line-item exports, offsets and a currency mismatch", () => {
  const cases = { "1.234,56": 1234.56, "1,234.56": 1234.56, "1234.56": 1234.56, "₺1.234,56": 1234.56, "1 234,56 TL": 1234.56, "12,5": 12.5, "-15,00": -15, "(12,50)": -12.5, "1.234.567": 1234567, "": null, "abc": null };
  for (const [raw, n] of Object.entries(cases)) assert.equal(amountOf(raw), n, raw);
  // Shopify's export: one row per line item, the total on the first row only.
  const cols = ["Name", "Created at", "Total", "Currency"];
  const rows = [
    ["#1", "2026-10-20T23:30:00+00:00", "300.00", "TRY"],
    ["#1", "2026-10-20T23:30:00+00:00", "", ""],
    ["#2", "2026-10-20 23:30:00", "50.00", "TRY"],
  ];
  const r = aggregate({ columns: cols, rows }, checkMapping(cols, guessMapping(cols, rows)), { timeZone: "Europe/Istanbul", currency: "TRY" });
  // 23:30 UTC is 02:30 the next day in Istanbul; a time without an offset is read as Istanbul time.
  assert.deepEqual(r.preview.daily, [{ date: "2026-10-20", orders: 1, revenue: 50 }, { date: "2026-10-21", orders: 1, revenue: 300 }]);
  assert.deepEqual(r.preview.excluded, { status: 0, no_date: 0, bad_total: 0 });
  assert.ok(r.preview.warnings.some((w) => /repeats an order number/.test(w.en)));
  assert.throws(() => aggregate({ columns: cols, rows: [["#3", "2026-10-20", "10", "USD"]] }, checkMapping(cols, guessMapping(cols, [])), { currency: "TRY" }), codeIs("currency_mismatch"));
});

// ---------------------------------------------------------------- XLSX

/** A zip file from entries { name, data, method?, size? } (size: the declared uncompressed size, to lie with). */
function zipOf(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8");
    const method = e.method ?? 8;
    const body = e.compressed ?? (method === 8 ? deflateRawSync(raw) : raw);
    const size = e.size ?? raw.length;
    const name = Buffer.from(e.name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(e.flags ?? 0, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(size >>> 0, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(e.flags ?? 0, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(size >>> 0, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    central.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const WORKBOOK = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Siparişler" sheetId="1" r:id="rId7"/></sheets></workbook>`;
const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="worksheet" Target="worksheets/orders.xml"/></Relationships>`;
const STYLES = `<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="4"/></cellXfs></styleSheet>`;
const serial = (iso) => (Date.parse(`${iso}Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;

function xlsxOf(sheetXml, { shared = [], extra = [] } = {}) {
  const sst = `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`;
  return zipOf([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "xl/workbook.xml", data: WORKBOOK },
    { name: "xl/_rels/workbook.xml.rels", data: RELS },
    { name: "xl/styles.xml", data: STYLES },
    { name: "xl/sharedStrings.xml", data: sst },
    { name: "xl/worksheets/orders.xml", data: `<worksheet><sheetData>${sheetXml}</sheetData></worksheet>` },
    ...extra,
  ]);
}

test("XLSX: the first sheet through its relationship, shared and inline strings, serial dates, Turkish headers", () => {
  const shared = ["Sipariş No", "Sipariş Tarihi", "Durum", "Genel Toplam", "Tamamlandı", "Ali &amp; Veli"];
  const sheet =
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="inlineStr"><is><t>Not</t></is></c></row>` +
    `<row r="2"><c r="A2"><v>5001</v></c><c r="B2" s="1"><v>${serial("2026-10-20T10:30:00")}</v></c><c r="C2" t="s"><v>4</v></c><c r="D2" s="2"><v>1234.5</v></c><c r="E2" t="s"><v>5</v></c></row>` +
    // A gap (no C3) and a cell past column 500 are handled; the date as text works too.
    `<row r="3"><c r="A3"><v>5002</v></c><c r="B3" t="str"><v>21.10.2026 08:00</v></c><c r="D3"><v>99.9</v></c><c r="ZZ3"><v>x</v></c></row>`;
  const buf = xlsxOf(sheet, { shared });
  assert.equal(fileKind("siparisler.xlsx", buf.subarray(0, 4096)), "xlsx");
  const t = readTable(buf, "xlsx");
  assert.deepEqual(t.columns, ["Sipariş No", "Sipariş Tarihi", "Durum", "Genel Toplam", "Not"]);
  assert.deepEqual(t.rows[0], ["5001", "2026-10-20 10:30:00", "Tamamlandı", "1234.5", "Ali & Veli"]);
  assert.equal(t.rows[1][1], "21.10.2026 08:00");
  assert.equal(t.rows[1][2], "");
  const m = guessMapping(t.columns, t.rows);
  assert.deepEqual([m.order_id, m.created_at, m.status, m.total], ["Sipariş No", "Sipariş Tarihi", "Durum", "Genel Toplam"]);
  const { preview } = aggregate(t, checkMapping(t.columns, m), { currency: "TRY" });
  assert.deepEqual(preview.daily, [{ date: "2026-10-20", orders: 1, revenue: 1234.5 }, { date: "2026-10-21", orders: 1, revenue: 99.9 }]);
});

test("bad files: refused by kind, unreadable, password protected, truncated, zip64, empty", () => {
  const nul = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
  assert.equal(fileKind("orders.xls", Buffer.from("a,b\n1,2")), null);
  assert.equal(fileKind("orders.pdf", Buffer.from("%PDF-1.7")), null);
  assert.equal(fileKind("orders.csv", nul), null, "binary with NUL bytes is not CSV");
  assert.equal(fileKind("orders.zip", Buffer.from([0x50, 0x4b, 0x03, 0x04])), null);
  assert.equal(fileKind("orders.csv", Buffer.from("a,b\n")), "csv");
  assert.equal(fileKind("export", Buffer.from([0x50, 0x4b, 0x03, 0x04])), "xlsx");
  const unreadable = codeIs("file_unreadable");
  assert.throws(() => readTable(Buffer.from("just one line\n"), "csv"), unreadable);
  assert.throws(() => readTable(Buffer.from(""), "csv"), unreadable);
  assert.throws(() => readTable(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), "xlsx"), unreadable);
  const good = xlsxOf(`<row><c t="inlineStr"><is><t>a</t></is></c><c t="inlineStr"><is><t>b</t></is></c></row><row><c><v>1</v></c><c><v>2</v></c></row>`);
  assert.deepEqual(readTable(good, "xlsx"), { columns: ["a", "b"], rows: [["1", "2"]] });
  assert.throws(() => readTable(good.subarray(0, good.length - 30), "xlsx"), unreadable, "truncated");
  assert.throws(() => readTable(zipOf([{ name: "xl/workbook.xml", data: WORKBOOK, flags: 1 }]), "xlsx"), (e) => e.code === "file_unreadable" && /password/.test(e.message));
  assert.throws(() => readTable(zipOf([{ name: "docProps/app.xml", data: "<x/>" }]), "xlsx"), (e) => e.code === "file_unreadable" && /no workbook/.test(e.message));
  assert.throws(() => readTable(zipOf([{ name: "xl/workbook.xml", data: WORKBOOK, method: 14 }]), "xlsx"), unreadable, "LZMA");
  const z64 = Buffer.from(good);
  z64.writeUInt32LE(0xffffffff, z64.length - 6);
  assert.throws(() => readTable(z64, "xlsx"), (e) => e.code === "file_unreadable" && /zip64/.test(e.message));
});

test("zip bombs: the unpack cap is 50 times the file (200 MB at most); a declared size and a lying size are both refused", async () => {
  // Declared: refused from the directory, nothing is inflated.
  const lie = zipOf([
    { name: "xl/workbook.xml", data: WORKBOOK },
    { name: "xl/_rels/workbook.xml.rels", data: RELS },
    { name: "xl/worksheets/orders.xml", data: "<worksheet/>", size: 0xfffffff0 },
  ]);
  assert.throws(() => readTable(lie, "xlsx"), (e) => e.code === "file_unreadable" && /unpacks to more than 1 MB/.test(e.message));
  assert.equal(inflateBudget(10), 1024 * 1024);
  assert.equal(inflateBudget(2 * 1024 * 1024), 100 * 1024 * 1024);
  assert.equal(inflateBudget(25 * 1024 * 1024), MAX_INFLATED);
  assert.equal(MAX_INFLATED, 200 * 1024 * 1024);

  // Inflated: about 410 MB of spaces deflate to well under 1 MB, built in 1 MB steps (never held whole). The entry
  // says 10 bytes; the parser must stop at its budget (50 times the file) instead of trusting it.
  const chunk = Buffer.alloc(1024 * 1024, 0x20);
  const parts = [];
  const d = createDeflateRaw({ level: 9 });
  d.on("data", (c) => parts.push(c));
  const done = new Promise((r) => d.on("end", r));
  for (let i = 0; i < 120; i++) if (!d.write(chunk)) await new Promise((r) => d.once("drain", r));
  d.end();
  await done;
  const compressed = Buffer.concat(parts);
  assert.ok(compressed.length < 2 * 1024 * 1024, `bomb is ${compressed.length} bytes`);
  const bomb = zipOf([
    { name: "xl/workbook.xml", data: WORKBOOK },
    { name: "xl/_rels/workbook.xml.rels", data: RELS },
    { name: "xl/worksheets/orders.xml", data: "", compressed, size: 10 },
  ]);
  assert.throws(() => readTable(bomb, "xlsx"), (e) => e.code === "file_unreadable" && /oversized|unpacks/.test(e.message), "the inflate stops at the budget");
});

// ---------------------------------------------------------------- GA4

test("GA4: groups and devices mapped, every page read, warnings, currency, and Google's errors as app codes", async () => {
  const groups = [["Organic Search", "google"], ["Direct", "(direct)"], ["Paid Search", "google"], ["Paid Search", "bing"], ["Paid Social", "facebook"], ["Paid Social", "l.instagram.com"], ["Paid Social", "tiktok"], ["Paid Social", "linkedin"], ["Paid Social", ""], ["Email", "newsletter"], ["Referral", "blog.example.com"], ["Organic Social", "t.co"], ["Organic Video", "youtube"], ["Affiliates", "partner"], ["Display", "google"], ["Unassigned", ""], ["(not set)", ""], ["", ""]];
  assert.deepEqual(groups.map(([g, src]) => channelOfGroup(g, src)), ["organic", "direct", "google_ads", "other", "meta_ads", "meta_ads", "tiktok_ads", "other", "other", "email", "referral", "organic_social", "other", "other", "other", "unknown", "unknown", "unknown"]);
  assert.deepEqual(["mobile", "tablet", "desktop", "smart tv", ""].map(deviceOfCategory), ["mobile", "mobile", "desktop", "unknown", "unknown"]);
  assert.equal(propertyId("properties/123456789"), "123456789");
  assert.equal(propertyId("G-ABC123"), null);

  const calls = [];
  const all = [
    ["20261020", "Organic Search", "mobile", "google", "100", "3", "300.5"],
    ["20261020", "Referral", "tablet", "blog.example.com", "10", "1", "50"],
    ["20261020", "Affiliates", "desktop", "partner", "5", "0", "0"],
    ["20261021", "Paid Social", "desktop", "facebook", "40", "2", "200"],
    ["bad", "Direct", "desktop", "(direct)", "1", "1", "1"],
  ];
  const transport = {
    async runReport(property, body) {
      calls.push({ property, offset: body.offset, dims: body.dimensions.map((x) => x.name), metrics: body.metrics.map((x) => x.name) });
      const page = all.slice(body.offset, body.offset + 2);
      return { rowCount: all.length, rows: page.map((r) => ({ dimensionValues: r.slice(0, 4).map((value) => ({ value })), metricValues: r.slice(4).map((value) => ({ value })) })), metadata: { currencyCode: "TRY", subjectToThresholding: true, dataLossFromOtherRow: true }, propertyQuota: { tokensPerDay: { remaining: 24000 } } };
    },
  };
  const r = await fetchGa4Days(transport, "123456789", "2026-10-20", "2026-10-21");
  assert.deepEqual(calls.map((c) => c.offset), [0, 2, 4]);
  assert.deepEqual(calls[0].dims, ["date", "sessionDefaultChannelGroup", "deviceCategory", "sessionSource"]);
  assert.deepEqual(calls[0].metrics, ["sessions", "transactions", "purchaseRevenue"]);
  assert.deepEqual(r.rows, [
    { date: "2026-10-20", channel: "organic", device: "mobile", sessions: 100, ga4_purchases: 3, ga4_revenue: 300.5 },
    { date: "2026-10-20", channel: "referral", device: "mobile", sessions: 10, ga4_purchases: 1, ga4_revenue: 50 },
    { date: "2026-10-20", channel: "other", device: "desktop", sessions: 5, ga4_purchases: 0, ga4_revenue: 0 },
    { date: "2026-10-21", channel: "meta_ads", device: "desktop", sessions: 40, ga4_purchases: 2, ga4_revenue: 200 },
  ]);
  assert.equal(r.currency, "TRY");
  assert.equal(r.quota, 24000);
  assert.equal(r.warnings.length, 2);

  const fail = (status) => ({ runReport: async () => { throw Object.assign(new Error(`HTTP ${status} with token ya29.secret`), { code: status }); } });
  for (const [status, code] of [[401, "key_rejected"], [403, "property_not_found"], [404, "property_not_found"], [429, "source_unavailable"], [500, "source_unavailable"]]) {
    // A bare 429 is not a quota error: Google names the quota when it is one (see real-connectors.test.js).
    await assert.rejects(fetchGa4Days(fail(status), "1234", "2026-10-20", "2026-10-20"), codeIs(code), String(status));
  }
  assert.equal(ga4Error(Object.assign(new Error("x"), { response: { status: 403 } })).code, "property_not_found");
});

// ---------------------------------------------------------------- Shopify

const SHOP = "ornek.myshopify.com";
function shopifyStub({ scopes = ["read_orders"], pages = [], fail = null } = {}) {
  const seen = [];
  const fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    seen.push({ url, query, variables, token: init.headers["X-Shopify-Access-Token"] });
    if (fail && fail(seen.length, query)) return fail(seen.length, query);
    if (query.includes("currentAppInstallation")) return json({ data: { shop: { ianaTimezone: "Europe/Istanbul", currencyCode: "TRY" }, currentAppInstallation: { accessScopes: scopes.map((handle) => ({ handle })) } } });
    if (query.includes("query Orders")) {
      const i = variables.cursor ? Number(variables.cursor) : 0;
      return json({ data: { orders: { pageInfo: { hasNextPage: i + 1 < pages.length, endCursor: String(i + 1) }, nodes: pages[i] ?? [] } } });
    }
    return json({ data: { first: { nodes: [{ createdAt: "2026-01-02T09:00:00Z" }] }, last: { nodes: [{ createdAt: "2026-10-21T09:00:00Z" }] } } });
  };
  return { fetch, seen };
}
const sOrder = (createdAt, amount, { test = false, shipping = 0, source = null, medium = null, currency = "TRY" } = {}) => ({
  createdAt, test, totalPriceSet: { shopMoney: { amount: String(amount), currencyCode: currency } }, totalShippingPriceSet: { shopMoney: { amount: String(shipping) } },
  customerJourneySummary: source || medium ? { lastVisit: { source, utmParameters: { source, medium } } } : null,
});

test("Shopify: read_orders only, every page, test orders out, shipping off, channel from the last visit, no personal fields asked", async () => {
  const stub = shopifyStub({
    pages: [
      [sOrder("2026-10-20T07:00:00Z", 150, { shipping: 30, source: "google", medium: "cpc" }), sOrder("2026-10-20T08:00:00Z", 999, { test: true }), sOrder("2026-10-20T21:30:00Z", 100)],
      [sOrder("2026-10-21T10:00:00Z", 80, { source: "instagram", medium: "paid_social" }), sOrder("2026-10-25T10:00:00Z", 500)],
    ],
  });
  const client = shopifyClient({ connectorFetch: stub.fetch }, SHOP, "shpat_test_token");
  const info = await shopifyInfo(client);
  assert.deepEqual([info.timeZone, info.currency], ["Europe/Istanbul", "TRY"]);
  const r = await fetchShopifyDays(client, { from: "2026-10-20", to: "2026-10-21", timeZone: "Europe/Istanbul" });
  // 21:30 UTC is the 21st in Istanbul; the order on the 25th is outside the range.
  assert.deepEqual(r.rows.sort((a, b) => (a.date + a.channel).localeCompare(b.date + b.channel)), [
    { date: "2026-10-20", channel: "google_ads", device: "unknown", orders: 1, revenue: 120 },
    { date: "2026-10-21", channel: "meta_ads", device: "unknown", orders: 1, revenue: 80 },
    { date: "2026-10-21", channel: "unknown", device: "unknown", orders: 1, revenue: 100 },
  ]);
  assert.equal(r.orders, 3);
  const orderCalls = stub.seen.filter((s) => s.query.includes("query Orders"));
  assert.deepEqual(orderCalls.map((s) => s.variables.cursor), [null, "1"]);
  assert.ok(stub.seen.every((s) => s.url === `https://${SHOP}/admin/api/2025-07/graphql.json` && s.token === "shpat_test_token"));
  for (const s of stub.seen) assert.doesNotMatch(s.query, /\b(email|phone|firstName|lastName|displayName|billingAddress|shippingAddress|lineItems|note)\b/);

  // A write scope is refused, and so is a token that cannot read orders.
  await assert.rejects(shopifyInfo(shopifyClient({ connectorFetch: shopifyStub({ scopes: ["read_orders", "write_orders"] }).fetch }, SHOP, "t")), (e) => e.code === "scope_write" && /write_orders/.test(e.message));
  await assert.rejects(shopifyInfo(shopifyClient({ connectorFetch: shopifyStub({ scopes: ["read_products"] }).fetch }, SHOP, "t")), codeIs("key_rejected"));
  // Only read_orders and a short read-only allowlist: a personal-data scope is refused with that reason.
  assert.deepEqual((await shopifyInfo(shopifyClient({ connectorFetch: shopifyStub({ scopes: ["read_orders", "read_all_orders", "read_products", "read_analytics"] }).fetch }, SHOP, "t"))).scopes.length, 4);
  for (const extra of ["read_customers", "read_customer_events", "read_users", "read_checkouts", "read_draft_orders", "read_gift_cards"]) {
    await assert.rejects(shopifyInfo(shopifyClient({ connectorFetch: shopifyStub({ scopes: ["read_orders", extra] }).fetch }, SHOP, "t")), (e) => e.code === "scope_extra" && e.params.personal === extra && /personal data/.test(e.message), extra);
  }
  await assert.rejects(shopifyInfo(shopifyClient({ connectorFetch: shopifyStub({ scopes: ["read_orders", "read_themes"] }).fetch }, SHOP, "t")), (e) => e.code === "scope_extra" && e.params.personal === "" && /more than this app needs/.test(e.message));

  // HTTP errors and GraphQL throttling.
  const withStatus = (status) => shopifyClient({ connectorFetch: async () => new Response("{}", { status }) }, SHOP, "t");
  for (const [status, code] of [[401, "key_rejected"], [403, "key_rejected"], [404, "shop_unreachable"], [429, "rate_limited"], [500, "shop_unreachable"]]) await assert.rejects(shopifyInfo(withStatus(status)), codeIs(code), String(status));
  const throttled = shopifyClient({ connectorFetch: async () => json({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }) }, SHOP, "t");
  await assert.rejects(shopifyInfo(throttled), codeIs("rate_limited"));
});

test("Shopify through the actions: a write token fails the scope step; a sync that hits a limit stores nothing", async () => {
  const ws = await demoWorkspace({ seed: false, env: { AI_ANALYST_SHOPIFY_SHOP: SHOP, AI_ANALYST_SHOPIFY_TOKEN: "shpat_env_token_0000" } });
  open.push(ws);
  ws.connectorFetch = shopifyStub({ scopes: ["read_orders", "write_products"] }).fetch;
  const t = await callAction("test_shopify", { shop: "ornek" }, ctxFor(ws));
  assert.equal(t.ok, false);
  assert.deepEqual(t.steps.map((s) => [s.id, s.status]), [["reach", "ok"], ["scope", "failed"], ["orders", "skipped"], ["range", "skipped"]]);
  assert.equal(t.steps[1].error.code, "scope_write");

  const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  ws.connectorFetch = shopifyStub({ pages: [[sOrder(`${day(2)}T09:00:00Z`, 100)], [sOrder(`${day(3)}T09:00:00Z`, 50)]] }).fetch;
  const states = await callAction("sync_sources", { connector: "shopify", history_days: 7 }, ctxFor(ws));
  assert.equal(states.find((s) => s.id === "shopify").status, "connected");
  const before = ws.store.list("landing", { limit: 100 });
  assert.equal(before.reduce((s, r) => s + r.orders, 0), 2);
  assert.ok(before.every((r) => Object.keys(r).sort().join() === "channel,date,device,id,orders,revenue,source,table"), "aggregates only");

  // The second page answers 429: the run stops, stores nothing, and the state carries the error.
  ws.connectorFetch = shopifyStub({ pages: [[sOrder(`${day(2)}T09:00:00Z`, 999)], []], fail: (n, q) => (q.includes("query Orders") && n > 2 ? new Response("{}", { status: 429 }) : null) }).fetch;
  await assert.rejects(callAction("sync_sources", { connector: "shopify", history_days: 7 }, ctxFor(ws)), codeIs("rate_limited"));
  assert.deepEqual(ws.store.list("landing", { limit: 100 }), before);
  const s = (await callAction("list_connectors", {}, ctxFor(ws))).find((x) => x.id === "shopify");
  assert.deepEqual([s.status, s.error.code, s.last_sync.ok], ["error", "rate_limited", false]);
  assert.equal(s.secret.locked, true);
  assert.doesNotMatch(JSON.stringify(s), /shpat_env_token_0000/);
  // The environment fixes the shop and token: Settings cannot disconnect it.
  await assert.rejects(callAction("disconnect_source", { connector: "shopify" }, ctxFor(ws)), codeIs("locked"));
});

// ---------------------------------------------------------------- WooCommerce

const BASE = "https://shop.example.com";
const wOrder = (id, gmt, total, { status = "completed", shipping = 0, source, medium, device, type } = {}) => ({
  id, status, date_created_gmt: gmt, total: String(total), shipping_total: String(shipping), currency: "TRY",
  meta_data: [
    ...(source ? [{ key: "_wc_order_attribution_utm_source", value: source }] : []),
    ...(medium ? [{ key: "_wc_order_attribution_utm_medium", value: medium }] : []),
    ...(device ? [{ key: "_wc_order_attribution_device_type", value: device }] : []),
    ...(type ? [{ key: "_wc_order_attribution_source_type", value: type }] : []),
  ],
});
const READ_ONLY = { code: "woocommerce_rest_authentication_error", message: "The API key provided does not have write permissions.", data: { status: 401 } };
function wooStub({ pages = [], batch = 401, batchBody = READ_ONLY, status = 200 } = {}) {
  const seen = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    seen.push({ url: u, method: init.method ?? "GET", auth: init.headers.Authorization });
    if (u.pathname === "/wp-json/") return json({ name: "Örnek", timezone_string: "Europe/Istanbul" });
    if (status !== 200) return new Response("{}", { status });
    if (u.pathname.endsWith("/orders/batch")) return typeof batchBody === "string" ? new Response(batchBody, { status: batch }) : json(batchBody, batch);
    const page = Number(u.searchParams.get("page") ?? 1);
    return json(pages[page - 1] ?? [], 200, { "X-WP-TotalPages": String(pages.length) });
  };
  return { fetch, seen };
}

test("WooCommerce: limited fields, every page, never-placed orders out, attribution meta mapped, write keys refused", async () => {
  const p1 = Array.from({ length: 100 }, (_, i) => wOrder(i + 1, "2026-10-20T09:00:00", 10, { source: "google", medium: "cpc", device: "Mobile" }));
  p1[0] = wOrder(1, "2026-10-20T09:00:00", 99, { status: "failed" });
  p1[1] = wOrder(2, "2026-10-20T09:00:00", 99, { status: "checkout-draft" });
  p1[2] = wOrder(3, "2026-10-20T09:00:00", 40, { status: "cancelled", shipping: 10, type: "typein", device: "Desktop" });
  const p2 = [wOrder(101, "2026-10-20T22:00:00", 70, { status: "refunded", source: "newsletter", medium: "email" }), wOrder(102, "2026-10-19T08:00:00", 5)];
  const stub = wooStub({ pages: [p1, p2] });
  const client = wooClient({ connectorFetch: stub.fetch }, BASE, "ck_read", "cs_read");
  const r = await fetchWooDays(client, { from: "2026-10-20", to: "2026-10-21", timeZone: "Europe/Istanbul" });
  const by = Object.fromEntries(r.rows.map((x) => [`${x.date}|${x.channel}|${x.device}`, [x.orders, x.revenue]]));
  assert.deepEqual(by, { "2026-10-20|google_ads|mobile": [97, 970], "2026-10-20|direct|desktop": [1, 30], "2026-10-21|email|unknown": [1, 70] });
  assert.equal(r.currency, "TRY");
  const orderCalls = stub.seen.filter((s) => s.url.pathname.endsWith("/orders"));
  assert.deepEqual(orderCalls.map((s) => s.url.searchParams.get("page")), ["1", "2"]);
  for (const s of orderCalls) {
    assert.equal(s.url.searchParams.get("_fields"), "id,status,date_created_gmt,total,shipping_total,currency,meta_data");
    assert.equal(s.url.origin, BASE);
    assert.equal(s.auth, `Basic ${Buffer.from("ck_read:cs_read").toString("base64")}`);
  }

  // The scope check: an empty batch refused (read key) passes; one accepted (write key) is refused.
  assert.equal(await wooCheckScope(wooClient({ connectorFetch: wooStub({ batch: 401 }).fetch }, BASE, "k", "s")), "read");
  assert.equal(await wooCheckScope(wooClient({ connectorFetch: wooStub({ batch: 403, batchBody: { code: "rest_forbidden" } }).fetch }, BASE, "k", "s")), "read");
  // Anything but WordPress's own refusal fails closed: a firewall page, a 400, a 500, a 403 without a REST code.
  for (const [batch, batchBody] of [[403, "<html>Blocked by WAF</html>"], [403, { code: "blocked" }], [400, { code: "rest_invalid_param" }], [404, "{}"], [500, "{}"], [401, "not json"]]) {
    await assert.rejects(wooCheckScope(wooClient({ connectorFetch: wooStub({ batch, batchBody }).fetch }, BASE, "k", "s")), (e) => e.code === "scope_unchecked" && e.params.status === batch, `${batch} ${JSON.stringify(batchBody)}`);
  }
  await assert.rejects(wooCheckScope(wooClient({ connectorFetch: wooStub({ batch: 200 }).fetch }, BASE, "k", "s")), codeIs("scope_write"));
  for (const [status, code] of [[401, "key_rejected"], [404, "shop_unreachable"], [429, "rate_limited"], [503, "shop_unreachable"]]) {
    await assert.rejects(fetchWooDays(wooClient({ connectorFetch: wooStub({ status }).fetch }, BASE, "k", "s"), { from: "2026-10-20", to: "2026-10-20", timeZone: "Europe/Istanbul" }), codeIs(code), String(status));
  }
  const notList = wooClient({ connectorFetch: async () => json({ code: "x" }) }, BASE, "k", "s");
  await assert.rejects(fetchWooDays(notList, { from: "2026-10-20", to: "2026-10-20", timeZone: "Europe/Istanbul" }), codeIs("shop_unreachable"));
});

test("WooCommerce through the actions: http refused, a write key fails the scope step", async () => {
  const ws = await demoWorkspace({ seed: false });
  open.push(ws);
  ws.connectorFetch = wooStub({ batch: 200, pages: [[]] }).fetch;
  const http = await callAction("test_woocommerce", { url: "http://shop.example.com", key: "ck_1", secret: "cs_1" }, ctxFor(ws));
  assert.deepEqual([http.ok, http.steps[0].status, http.steps[0].error.code], [false, "failed", "host_not_allowed"]);
  const ip = await callAction("test_woocommerce", { url: "https://192.168.1.10", key: "ck_1", secret: "cs_1" }, ctxFor(ws));
  assert.equal(ip.steps[0].error.code, "host_not_allowed");
  const write = await callAction("test_woocommerce", { url: "shop.example.com", key: "ck_1", secret: "cs_1" }, ctxFor(ws));
  assert.deepEqual(write.steps.map((s) => [s.id, s.status]), [["reach", "ok"], ["scope", "failed"], ["orders", "skipped"], ["range", "skipped"]]);
  assert.equal(write.steps[1].error.code, "scope_write");
  await assert.rejects(callAction("connect_woocommerce", { test_id: write.test_id }, ctxFor(ws)), codeIs("test_required"));
});

// ---------------------------------------------------------------- the local mart

test("the mart: 0 on a day a source covered without rows, NULL on a day it did not; ad columns NULL", async () => {
  const ws = await demoWorkspace({ seed: false });
  open.push(ws);
  // GA4 covers the 1st to the 4th with sessions every day; the orders cover the 1st to the 2nd, with a row on the 1st only.
  const ga4 = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].map((date) => ({ date, channel: "organic", device: "mobile", sessions: 10, ga4_purchases: 1, ga4_revenue: 5 }));
  replaceLanding(ws.store, { table: "ga4", source: "ga4", from: "2026-10-01", to: "2026-10-04", rows: ga4 });
  replaceLanding(ws.store, { table: "orders", source: "orders_file", from: "2026-10-01", to: "2026-10-02", rows: [{ date: "2026-10-01", channel: "organic", device: "mobile", orders: 2, revenue: 30 }, { date: "2026-09-01", channel: "organic", device: "mobile", orders: 99, revenue: 99 }, { date: "2026-10-01", channel: "made_up", device: "fridge", orders: 1, revenue: 1 }] });
  const { file, rows } = await buildLocalWarehouse(ws.config, ws.store);
  assert.ok(file.startsWith(ws.dir));
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const db = await DuckDBInstance.create(file, { access_mode: "READ_ONLY" });
  const conn = await db.connect();
  try {
    const out = (await conn.runAndReadAll("SELECT CAST(date AS VARCHAR) AS date, channel, device, sessions, orders, CAST(revenue AS DOUBLE) AS revenue, ad_spend, platform_conversions FROM daily_channel_device ORDER BY date, channel")).getRowObjectsJson();
    assert.equal(rows, out.length);
    assert.deepEqual(out.map((r) => [r.date, r.channel, r.device, r.sessions == null ? null : Number(r.sessions), r.orders == null ? null : Number(r.orders), r.revenue, r.ad_spend, r.platform_conversions]), [
      ["2026-10-01", "organic", "mobile", 10, 2, 30, null, null],
      ["2026-10-01", "unknown", "unknown", 0, 1, 1, null, null],
      ["2026-10-02", "organic", "mobile", 10, 0, 0, null, null],
      ["2026-10-03", "organic", "mobile", 10, null, null, null, null],
      ["2026-10-04", "organic", "mobile", 10, null, null, null, null],
    ]);
    // A day GA4 covered with no GA4 row (the unknown row on the 1st) reads 0 sessions.
    const unknown = (await conn.runAndReadAll("SELECT sessions FROM daily_channel_device WHERE channel = 'unknown'")).getRowObjectsJson()[0];
    assert.equal(Number(unknown.sessions), 0);
  } finally {
    conn.closeSync?.();
    db.closeSync?.();
  }
  // A second sync of the 2nd only replaces the 2nd.
  replaceLanding(ws.store, { table: "orders", source: "orders_file", from: "2026-10-02", to: "2026-10-02", rows: [{ date: "2026-10-02", channel: "organic", device: "mobile", orders: 4, revenue: 40 }] });
  const sum = ws.store.list("landing", { limit: 100 }).filter((r) => r.table === "orders").reduce((s, r) => s + r.orders, 0);
  assert.equal(sum, 2 + 1 + 4);
});

test("the switch note: none on the demo or local; BigQuery and an environment-fixed source say to switch by hand", () => {
  assert.equal(switchNote({ warehouse: "duckdb", warehouseSetting: { locked: false } }), null);
  assert.equal(switchNote({ warehouse: "local", warehouseSetting: { locked: true, env: "AI_ANALYST_WAREHOUSE" } }), null);
  assert.match(switchNote({ warehouse: "bigquery", warehouseSetting: { locked: false } }).en, /Settings › Sources/);
  const env = switchNote({ warehouse: "bigquery", warehouseSetting: { locked: true, env: "AI_ANALYST_WAREHOUSE" } });
  assert.match(env.en, /AI_ANALYST_WAREHOUSE=local/);
  assert.match(env.tr, /AI_ANALYST_WAREHOUSE=local/);
  assert.match(switchNote({ warehouse: "duckdb", warehouseSetting: { locked: true, env: "AI_ANALYST_WAREHOUSE" } }).en, /restart/);
});

test("tempDir folders live under the system temp dir", () => {
  const d = tempDir("aa-conn-");
  assert.ok(path.basename(d).startsWith("aa-conn-"));
});

// ---------------------------------------------------------------- security review 3

test("M2: IPv6 forms that carry a private IPv4 address, special ranges, and the public ones that stay open", () => {
  const priv = [
    "::ffff:172.16.0.1", "::ffff:100.64.0.1", "::ffff:0.0.0.0", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::FFFF:192.168.0.1",
    "64:ff9b::7f00:1", "64:ff9b::10.0.0.1", "64:ff9b:1::1", "2002:7f00:1::1", "2002:a9fe:a9fe::", "2002:c0a8:0101::1",
    "::127.0.0.1", "::10.0.0.1", "::", "::1", "0:0:0:0:0:0:0:1", "[::1]", "fe80::1%en0",
    "198.18.0.1", "198.19.255.255", "192.0.0.8", "192.0.2.1", "203.0.113.5", "255.255.255.255", "240.0.0.1",
    "fec0::1", "fc00::1", "fd00::1", "fe80::1", "ff02::1", "2001::1", "2001:0:4136:e378::1", "2001:db8::1", "100::1",
    "not-an-ip", "",
  ];
  for (const ip of priv) assert.equal(isPrivateAddress(ip), true, ip);
  const pub = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "198.20.0.1", "100.128.0.1", "2a00:1450:4001::200e", "2606:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1", "2001:4860::8888"];
  for (const ip of pub) assert.equal(isPrivateAddress(ip), false, ip);
  assert.equal(embeddedV4("::ffff:7f00:1"), "127.0.0.1");
  assert.equal(embeddedV4("2002:c0a8:0101::1"), "192.168.1.1");
  assert.equal(embeddedV4("2a00:1450::1"), null);
});

test("L2: port 443 only; L6: the shop addresses from the environment and the config file are checked at start", () => {
  assert.equal(checkUrl("https://shop.example.com:443/x", ["shop.example.com"]).port, "");
  for (const bad of ["https://shop.example.com:8443/", "https://shop.example.com:80/", "https://shop.example.com:22/"]) assert.throws(() => checkUrl(bad, ["shop.example.com"]), codeIs("host_not_allowed"), bad);
  assert.equal(shopUrl("shop.example.com:8443"), null);
  const dir = tempDir("aa-cfg-");
  const cfg = (env) => loadConfig({ env: { AI_ANALYST_DATA_DIR: dir, ...env }, cwd: dir }).connectors;
  assert.equal(cfg({ AI_ANALYST_SHOPIFY_SHOP: "Ornek" }).shopify.shop.value, "ornek.myshopify.com");
  assert.equal(cfg({ AI_ANALYST_WOOCOMMERCE_URL: "shop.example.com/" }).woocommerce.url.value, "https://shop.example.com");
  for (const env of [{ AI_ANALYST_SHOPIFY_SHOP: "shop.example.com" }, { AI_ANALYST_SHOPIFY_SHOP: "ornek.myshopify.com.evil.test" }, { AI_ANALYST_WOOCOMMERCE_URL: "http://shop.example.com" }, { AI_ANALYST_WOOCOMMERCE_URL: "https://10.0.0.1" }, { AI_ANALYST_WOOCOMMERCE_URL: "https://shop.example.com:8443" }, { AI_ANALYST_WOOCOMMERCE_URL: "https://localhost" }]) {
    assert.throws(() => cfg(env), /is not a valid address/, JSON.stringify(env));
  }
  writeFileSync(path.join(dir, "ai-analyst.config.json"), JSON.stringify({ connectors: { woocommerce: { url: "https://192.168.1.5" } } }));
  assert.throws(() => cfg({}), /connectors\.woocommerce\.url in the config file is not a valid address/);
});

test("M2: the name is resolved once and the request connects to that checked address (DNS rebinding)", async () => {
  // A resolver that answers public first and private after: only the first answer is ever used.
  const answers = [[{ address: "93.184.216.34", family: 4 }], [{ address: "127.0.0.1", family: 4 }], [{ address: "169.254.169.254", family: 4 }]];
  const resolved = [];
  const sent = [];
  const app = {
    connectorResolve: async (name) => (resolved.push(name), answers[Math.min(resolved.length - 1, answers.length - 1)]),
    connectorTransport: async (u, init, a) => (sent.push([u.hostname, a.address]), json({ ok: true })),
  };
  const call = connectorFetch(app, { service: "WooCommerce", hosts: ["shop.example.com"] });
  await call("https://shop.example.com/wp-json/");
  assert.deepEqual(resolved, ["shop.example.com"], "one lookup per request");
  assert.deepEqual(sent, [["shop.example.com", "93.184.216.34"]], "connected to the checked address");
  // The next request resolves again; now the name points inside: refused before anything is sent.
  await assert.rejects(call("https://shop.example.com/wp-json/"), codeIs("host_not_allowed"));
  assert.equal(sent.length, 1);
  // A mixed answer (one public, one private) is refused as a whole, and so is every disguised IPv6 form.
  for (const bad of [[{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }], [{ address: "::ffff:7f00:1", family: 6 }], [{ address: "64:ff9b::a9fe:a9fe", family: 6 }], [{ address: "2002:7f00:1::1", family: 6 }], [{ address: "::127.0.0.1", family: 6 }], [{ address: "fec0::1", family: 6 }]]) {
    const one = connectorFetch({ connectorResolve: async () => bad, connectorTransport: async () => (sent.push("x"), json({})) }, { service: "WooCommerce", hosts: ["shop.example.com"] });
    await assert.rejects(one("https://shop.example.com/"), codeIs("host_not_allowed"), JSON.stringify(bad));
  }
  assert.equal(sent.length, 1);
  const none = connectorFetch({ connectorResolve: async () => [], connectorTransport: async () => json({}) }, { service: "WooCommerce", hosts: ["shop.example.com"] });
  await assert.rejects(none("https://shop.example.com/"), codeIs("shop_unreachable"));
  // Without a stubbed transport the real path is guarded: no_cloud before any lookup.
  const lookups = [];
  const guarded = connectorFetch({ connectorResolve: async (n) => (lookups.push(n), [{ address: "93.184.216.34", family: 4 }]) }, { service: "WooCommerce", hosts: ["shop.example.com"] });
  await assert.rejects(guarded("https://shop.example.com/"), codeIs("no_cloud"));
  assert.deepEqual(lookups, []);
});

test("M2: the pinned request dials the checked address and still sends the name as SNI", async () => {
  // A plain TCP listener on this machine stands in for the shop: it records the TLS ClientHello and hangs up.
  let hello = Buffer.alloc(0);
  const got = new Promise((resolve) => {
    const srv = createServer((sock) => {
      sock.once("data", (d) => {
        hello = d;
        sock.destroy();
        srv.close();
        resolve();
      });
    });
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      // The name does not resolve anywhere; only the pinned address can be reached.
      pinnedRequest(new URL(`https://shop.invalid:${port}/wp-json/`), { method: "GET", headers: {} }, { address: "127.0.0.1", family: 4 }, { timeoutMs: 5000 }).catch(() => {});
    });
  });
  await got;
  assert.ok(hello.length > 0 && hello[0] === 0x16, "a TLS handshake arrived at the checked address");
  assert.ok(hello.includes(Buffer.from("shop.invalid")), "SNI carries the name");
});

test("M1: WooCommerce order meta is cut to the four attribution values on arrival; nothing else survives", async () => {
  const personal = [
    { key: "_billing_tc_kimlik_no", value: "12345678901" },
    { key: "_billing_phone_extra", value: "+90 555 000 00 00" },
    { key: "_wc_order_attribution_user_agent", value: "Mozilla/5.0 (iPhone; secret-agent)" },
    { key: "_wc_order_attribution_session_entry", value: "https://shop.example.com/?email=ayse@example.com" },
    { key: "is_vat_exempt", value: "no" },
  ];
  const raw = { id: 7, status: "completed", date_created_gmt: "2026-10-20T09:00:00", total: "100", shipping_total: "10", currency: "TRY", billing: { email: "x@example.com" }, meta_data: [...personal, { key: "_wc_order_attribution_utm_source", value: "google" }, { key: "_wc_order_attribution_utm_medium", value: "cpc" }, { key: "_wc_order_attribution_device_type", value: "Mobile" }, { key: "_wc_order_attribution_source_type", value: "utm" }] };
  const meta = [...raw.meta_data];
  const slim = slimOrder(raw);
  assert.deepEqual(slim, { status: "completed", date_created_gmt: "2026-10-20T09:00:00", total: "100", shipping_total: "10", currency: "TRY", source: "google", medium: "cpc", sourceType: "utm", device: "Mobile" });
  assert.equal(raw.meta_data, undefined, "the raw order lets go of its meta");
  const stub = wooStub({ pages: [[{ ...raw, meta_data: meta }]] });
  const r = await fetchWooDays(wooClient({ connectorFetch: stub.fetch }, BASE, "k", "s"), { from: "2026-10-20", to: "2026-10-20", timeZone: "Europe/Istanbul" });
  assert.deepEqual(r.rows, [{ date: "2026-10-20", channel: "google_ads", device: "mobile", orders: 1, revenue: 90 }]);
  assert.doesNotMatch(JSON.stringify(r), /12345678901|555|secret-agent|ayse|kimlik|session_entry|user_agent|example\.com/);
});

test("L4: a bad character reference is file_unreadable, not a crash", () => {
  for (const ent of ["&#x110000;", "&#xD800;", "&#99999999;"]) {
    const buf = xlsxOf(`<row><c t="inlineStr"><is><t>a${ent}</t></is></c><c t="inlineStr"><is><t>b</t></is></c></row><row><c><v>1</v></c><c><v>2</v></c></row>`);
    assert.throws(() => readTable(buf, "xlsx"), (e) => e.code === "file_unreadable" && /damaged character/.test(e.message), ent);
  }
  assert.deepEqual(readTable(xlsxOf(`<row><c t="inlineStr"><is><t>&#x15F;&#305;</t></is></c><c t="inlineStr"><is><t>b</t></is></c></row><row><c><v>1</v></c><c><v>2</v></c></row>`), "xlsx").columns, ["şı", "b"]);
});

test("L7: from another machine the connector states carry no shop domain, property, file name or error details", async () => {
  const ws = await demoWorkspace({ seed: false, env: { AI_ANALYST_SHOPIFY_SHOP: SHOP, AI_ANALYST_SHOPIFY_TOKEN: "shpat_env_token_0000" } });
  open.push(ws);
  ws.connectorFetch = async () => new Response("{}", { status: 404 });
  await assert.rejects(callAction("sync_sources", { connector: "shopify", history_days: 2 }, ctxFor(ws)), codeIs("shop_unreachable"));
  const local = (await callAction("list_connectors", {}, ctxFor(ws))).find((s) => s.id === "shopify");
  assert.equal(local.target, SHOP);
  assert.match(JSON.stringify(local.error), /ornek/);
  const remote = remoteStates(ws).find((s) => s.id === "shopify");
  assert.equal(remote.target, null);
  assert.deepEqual(Object.keys(remote.error).sort(), ["code", "message"]);
  assert.doesNotMatch(JSON.stringify(remoteStates(ws)), /ornek|myshopify|shpat/);
});

test("GA-style source / medium in a channel column maps like UTM source and medium; whole names still work", () => {
  const cases = { "google / cpc": "google_ads", "instagram / paid": "meta_ads", "(direct) / (none)": "direct", "google / organic": "organic", "newsletter / email": "email", "Organik": "organic", "Google Ads": "google_ads", "Instagram": "meta_ads", "partner / referral": "referral", "facebook / social": "organic_social", "Paid Social": "other" };
  for (const [channel, id] of Object.entries(cases)) assert.equal(channelFrom({ channel }), id, channel);
  const cols = ["Sipariş No", "Sipariş Tarihi", "Toplam", "Kaynak"];
  const rows = Object.keys(cases).slice(0, 5).map((k, i) => [String(i + 1), "2026-10-20 10:00", "10", k]);
  const m = guessMapping(cols, rows);
  assert.equal(m.channel, "Kaynak");
  const { preview } = aggregate({ columns: cols, rows }, checkMapping(cols, m), { currency: "TRY" });
  assert.deepEqual(preview.channels.map((c) => c.key).sort(), ["direct", "email", "google_ads", "meta_ads", "organic"]);
});

// ---------------------------------------------------------------- review 3 follow-up: deadlines and the XLSX worker

/** A local server that accepts, then drips one byte of a never-ending TLS record every 50 ms. */
function drippingServer() {
  return new Promise((resolve) => {
    const socks = new Set();
    const srv = createServer((sock) => {
      socks.add(sock);
      sock.on("error", () => {});
      sock.once("data", () => {
        // A handshake record header claiming 16 KB, then its body one byte at a time: the socket is never idle.
        sock.write(Buffer.from([0x16, 0x03, 0x03, 0x40, 0x00]));
        const t = setInterval(() => (sock.destroyed ? clearInterval(t) : sock.write(Buffer.from([0x02]))), 50);
        sock.on("close", () => clearInterval(t));
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ port: srv.address().port, close: () => (socks.forEach((s) => s.destroy()), srv.close()) }));
  });
}

test("pinnedRequest: one deadline for the whole request, not reset by a server dripping bytes; the caller's signal stops it", async () => {
  const srv = await drippingServer();
  try {
    const url = new URL(`https://shop.invalid:${srv.port}/`);
    const t0 = Date.now();
    await assert.rejects(pinnedRequest(url, { method: "GET", headers: {} }, { address: "127.0.0.1", family: 4 }, { timeoutMs: 600 }), (e) => e.code === "timeout");
    const took = Date.now() - t0;
    assert.ok(took >= 550 && took < 3000, `stopped after ${took} ms`);

    const ac = new AbortController();
    const t1 = Date.now();
    setTimeout(() => ac.abort(), 150);
    await assert.rejects(pinnedRequest(url, { method: "GET", headers: {}, signal: ac.signal }, { address: "127.0.0.1", family: 4 }, { timeoutMs: 10_000 }), (e) => e.code === "aborted");
    assert.ok(Date.now() - t1 < 2000, "the abort ends it at once");
    const done = new AbortController();
    done.abort();
    await assert.rejects(pinnedRequest(url, { headers: {}, signal: done.signal }, { address: "127.0.0.1", family: 4 }), (e) => e.code === "aborted", "an aborted signal never connects");
  } finally {
    srv.close();
  }
});

test("XLSX in a worker: the same table, errors carried back as app codes, the time limit and the shared-string cap", async () => {
  const { readTableSafe, XLSX_WORKER_LIMITS } = await import("../src/connectors/orders-file.js");
  assert.equal(XLSX_WORKER_LIMITS.maxOldGenerationSizeMb, 512);
  const sheet = `<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c t="s"><v>2</v></c><c t="s"><v>3</v></c></row>`;
  const buf = xlsxOf(sheet, { shared: ["Sipariş Tarihi", "Toplam", "20.10.2026", "10,5"] });
  assert.deepEqual(await readTableSafe(buf, "xlsx"), readTable(buf, "xlsx"));
  assert.deepEqual(await readTableSafe(Buffer.from("a;b\n1;2\n"), "csv"), { columns: ["a", "b"], rows: [["1", "2"]] });
  await assert.rejects(readTableSafe(Buffer.from([0x50, 0x4b, 3, 4, 9]), "xlsx"), (e) => e.code === "file_unreadable" && e instanceof Error);
  await assert.rejects(readTableSafe(zipOf([{ name: "xl/workbook.xml", data: WORKBOOK, flags: 1 }]), "xlsx"), (e) => e.code === "file_unreadable" && /password/.test(e.message));
  // The time limit: a worker that cannot finish in time is ended, and the file is unreadable.
  await assert.rejects(readTableSafe(buf, "xlsx", { timeoutMs: 1 }), (e) => e.code === "file_unreadable" && /too long/.test(e.message));
  // The shared-string cap (a million by default; a small one here so the test stays small).
  assert.deepEqual((await readTableSafe(buf, "xlsx", { maxShared: 4 })).columns, ["Sipariş Tarihi", "Toplam"]);
  await assert.rejects(readTableSafe(buf, "xlsx", { maxShared: 3 }), (e) => e.code === "file_unreadable" && /more than 3 different texts/.test(e.message));
  assert.throws(() => readTable(buf, "xlsx", { maxShared: 3 }), codeIs("file_unreadable"));
});
