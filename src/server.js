// HTTP API and the built web app (web/dist). The app holds the person's warehouse access and model keys, so
// it is a local tool by default:
//   - binds 127.0.0.1; any other address needs AI_ANALYST_TOKEN, and then every request carries it (a bearer
//     header, or an HttpOnly SameSite=Strict cookie set by one visit to /?token=…);
//   - the Host header must be this server (localhost, 127.0.0.1, [::1] with the port, or a configured name),
//     against DNS rebinding; a request from another site (Origin, Sec-Fetch-Site) is refused; no CORS headers;
//   - JSON bodies up to 1 MB, request timeouts, errors without stack traces or paths;
//   - the page has a CSP with default-src 'self' (inline script only by hash), nosniff, no referrer, no framing;
//   - settings-changing actions only from this machine: the socket address, never a header; a request that came
//     through a reverse proxy (any forwarding header) is not local.
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { callAction, registry } from "./actions/index.js";
import { runTurn } from "./agent/agent.js";
import { ROOT } from "./config.js";
import { AppError } from "./errors.js";
import { buildState } from "./state.js";

export const MAX_BODY_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const LOOPBACK_ADDR = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const COOKIE = "ai_analyst_token";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
};

const BASE_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Resource-Policy": "same-origin" };
const STATUS = { not_found: 404, unknown_action: 404, forbidden: 403, loopback_only: 403, unauthorized: 401, too_large: 413, bad_request: 400, invalid_input: 400, unsupported_media: 415, locked: 409, not_pending: 409, already_undone: 409, undo_gone: 409, only_one: 409, test_required: 409, no_cloud: 503, over_ceiling: 409, no_data: 409, unavailable: 409, source_unavailable: 503, not_undoable: 409, bytes_cap: 422, sql_location_mismatch: 409, sql_table_not_allowed: 409 };

const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
  res.end(JSON.stringify(body));
};
const fail = (res, status, code, message, params) => json(res, status, { ok: false, error: { code, message, ...(params ? { params } : {}) } });

async function readJson(req) {
  if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) throw new AppError("too_large", "The request body is larger than 1 MB.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new AppError("too_large", "The request body is larger than 1 MB.");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return body;
  } catch {
    throw new AppError("bad_request", "The request body is not a JSON object.");
  }
}

const langOf = (req, url, body) => {
  const l = body?.lang ?? url.searchParams.get("lang") ?? req.headers["accept-language"] ?? "";
  return String(l).toLowerCase().startsWith("tr") ? "tr" : "en";
};

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const cookieOf = (req, name) => {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
};

/** Inline scripts of index.html, hashed for the CSP (the theme bootstrap). */
export function inlineScriptHashes(html) {
  const out = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) if (m[1].trim()) out.push(`'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);
  return out;
}
export const cspFor = (hashes) =>
  ["default-src 'self'", `script-src 'self'${hashes.length ? ` ${hashes.join(" ")}` : ""}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");

/** Which Host headers this server answers to. */
export function allowedHostsFor(config, port) {
  const names = new Set(["localhost", "127.0.0.1", "[::1]", ...(config.allowedHosts ?? [])]);
  if (config.host && !["0.0.0.0", "::"].includes(config.host)) names.add(config.host.includes(":") && !config.host.startsWith("[") ? `[${config.host}]` : config.host);
  const out = new Set();
  for (const n of names) {
    const lower = n.toLowerCase();
    if (/:\d+$/.test(lower) && !lower.endsWith("]")) out.add(lower);
    else {
      out.add(`${lower}:${port}`);
      if (port === 80) out.add(lower);
    }
  }
  return out;
}

/**
 * @param {object} app the workspace (config, store, warehouse, pack, …)
 * @param {{ webDir?: string, port?: () => number }} [opts] webDir: the built web app (default web/dist).
 */
export function createHandler(app, opts = {}) {
  // A checkout serves web/dist; an installed package ships the same files as web-dist (src/pack.js).
  const webDir = path.resolve(opts.webDir ?? app.webDir ?? (existsSync(path.join(ROOT, "web", "dist", "index.html")) || !existsSync(path.join(ROOT, "web-dist")) ? path.join(ROOT, "web", "dist") : path.join(ROOT, "web-dist")));
  const running = new Map(); // turn id -> AbortController
  let indexCache = null;
  const portOf = () => opts.port?.() ?? app.config.port;
  const token = () => app.config.token;

  function index() {
    const file = path.join(webDir, "index.html");
    const mtime = existsSync(file) ? statSync(file).mtimeMs : null;
    if (!mtime) return null;
    if (indexCache?.mtime !== mtime) {
      const html = readFileSync(file, "utf8");
      indexCache = { mtime, html, csp: cspFor(inlineScriptHashes(html)) };
    }
    return indexCache;
  }

  function sendIndex(req, res) {
    const page = index();
    if (!page) {
      res.writeHead(503, { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      return res.end("The web app is not built yet. Run: bun run build (or npm run build), then start ai-analyst serve again. The API at /api/ works without it.\n");
    }
    res.writeHead(200, { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "Content-Security-Policy": page.csp });
    res.end(req.method === "HEAD" ? undefined : page.html);
  }

  async function serveStatic(req, res, pathname) {
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return fail(res, 400, "bad_request", "Bad path.");
    }
    if (rel.includes("\0")) return fail(res, 400, "bad_request", "Bad path.");
    if (rel === "/" || rel === "/index.html") return sendIndex(req, res);
    const file = path.resolve(webDir, `.${path.posix.normalize(`/${rel}`)}`);
    if (!file.startsWith(webDir + path.sep)) return fail(res, 404, "not_found", "Not found.");
    let info = null;
    try {
      info = statSync(file);
    } catch {}
    if (!info?.isFile()) {
      // A path with an extension that is not there is a missing file; anything else is a route of the app.
      if (/\.[a-z0-9]{1,8}$/i.test(rel)) {
        res.writeHead(404, { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Not found");
      }
      return sendIndex(req, res);
    }
    const body = await readFile(file);
    // Vite names built assets by content hash, so they never change under the same name.
    const hashed = /\/assets\//.test(rel) && /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(rel);
    res.writeHead(200, { ...BASE_HEADERS, "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache" });
    res.end(req.method === "HEAD" ? undefined : body);
  }

  async function ask(req, res, body, lang, loopback) {
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question || question.length > 2000) return fail(res, 400, "bad_request", "question must be text of 1 to 2,000 characters.");
    const conversationId = body.conversation_id == null ? undefined : String(body.conversation_id);
    if (conversationId && conversationId !== "new" && !app.store.getConversation(conversationId)) return fail(res, 404, "not_found", "This conversation is not here any more.");
    let context;
    if (body.context && typeof body.context === "object" && !Array.isArray(body.context)) {
      const c = body.context;
      context = Object.fromEntries(Object.entries(c).filter(([k, v]) => /^[a-z_]{1,24}$/.test(k) && (typeof v === "string" ? v.length <= 200 : typeof v === "object" ? JSON.stringify(v).length <= 400 : ["number", "boolean"].includes(typeof v))).slice(0, 12));
    }
    const controller = new AbortController();
    res.writeHead(200, { ...BASE_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders?.();
    // If the person closes the page mid-turn, stop spending on it.
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });
    const emit = (type, data) => {
      if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    let turnId = null;
    try {
      await runTurn({
        question,
        lang,
        conversationId,
        context,
        app,
        // The agent's tool calls carry where the question came from, as the person's own calls do.
        loopback,
        signal: controller.signal,
        emit,
        onTurn: (t) => {
          turnId = t.id;
          running.set(t.id, controller);
        },
      });
    } finally {
      if (turnId) running.delete(turnId);
      res.end();
    }
  }

  /** Refuses requests that are not for this server, or not from it. Returns false when it answered. */
  function guard(req, res, url) {
    const host = String(req.headers.host ?? "").toLowerCase();
    if (!allowedHostsFor(app.config, portOf()).has(host)) {
      fail(res, 403, "forbidden", "This server does not answer to that host name.");
      return false;
    }
    const isApi = url.pathname.startsWith("/api/");
    const origin = req.headers.origin;
    if ((isApi || req.method !== "GET") && origin !== undefined) {
      // The whole origin, scheme included: http, or https when a TLS proxy in front says so.
      const proto = req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted ? ["http", "https"] : ["http"];
      if (!proto.some((p) => origin === `${p}://${host}`)) {
        fail(res, 403, "forbidden", "Requests from another site are not accepted.");
        return false;
      }
    }
    const site = req.headers["sec-fetch-site"];
    if (isApi && site && !["same-origin", "none"].includes(String(site))) {
      fail(res, 403, "forbidden", "Requests from another site are not accepted.");
      return false;
    }
    if (token()) {
      const auth = String(req.headers.authorization ?? "");
      const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      const cookie = cookieOf(req, COOKIE);
      const query = url.searchParams.get("token");
      if (query && req.method === "GET" && !isApi && safeEqual(query, token())) {
        // One visit with ?token= sets the cookie, then the address bar loses the token.
        res.writeHead(303, { ...BASE_HEADERS, Location: "/", "Set-Cookie": `${COOKIE}=${encodeURIComponent(token())}; HttpOnly; SameSite=Strict; Path=/${req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`, "Cache-Control": "no-store" });
        res.end();
        return false;
      }
      if (!(bearer && safeEqual(bearer, token())) && !(cookie && safeEqual(cookie, token()))) {
        if (isApi) fail(res, 401, "unauthorized", "This server needs its access token. Open the address it printed at start, or send Authorization: Bearer <token>.");
        else {
          res.writeHead(401, { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
          res.end("This server needs its access token. Open the address ai-analyst serve printed, which ends in ?token=…\n");
        }
        return false;
      }
    }
    return true;
  }

  return async function handler(req, res) {
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return fail(res, 400, "bad_request", "Bad request.");
    }
    const { pathname } = url;
    // "From this machine" is decided by the socket address only, never by a header. A request that passed through
    // a reverse proxy (it carries a forwarding header) is never local, even though the proxy connects from 127.0.0.1.
    const proxied = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "via"].some((h) => req.headers[h] !== undefined);
    const loopback = LOOPBACK_ADDR.has(req.socket.remoteAddress) && !proxied;
    try {
      if (!guard(req, res, url)) return;
      if (req.method === "POST") {
        const ct = String(req.headers["content-type"] ?? "").toLowerCase();
        const hasBody = Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"];
        // A cross-site form cannot send application/json without a preflight, which this server never answers.
        if (hasBody && !ct.startsWith("application/json")) return fail(res, 415, "unsupported_media", "Send JSON with Content-Type: application/json.");
        // Without an Origin (not a browser) a POST must still be JSON; the bodiless stop call is the one exception.
        if (!req.headers.origin && !ct.startsWith("application/json") && !/^\/api\/turns\/[A-Za-z0-9_]+\/stop$/.test(pathname)) {
          return fail(res, 415, "unsupported_media", "Send JSON with Content-Type: application/json.");
        }
      }

      if (pathname === "/api/state" && req.method === "GET") return json(res, 200, await buildState(app, { loopback }));

      const action = pathname.match(/^\/api\/actions\/([a-z_]{1,64})$/);
      if (action && req.method === "POST") {
        const body = await readJson(req);
        if (!registry.has(action[1])) return fail(res, 404, "unknown_action", `Unknown action "${action[1]}".`);
        const result = await callAction(action[1], body, { actor: "person", lang: langOf(req, url, null), app, turn: null, loopback });
        return json(res, 200, { ok: true, result });
      }

      if (pathname === "/api/ask" && req.method === "POST") {
        const body = await readJson(req);
        return await ask(req, res, body, langOf(req, url, body), loopback);
      }

      const stop = pathname.match(/^\/api\/turns\/([A-Za-z0-9_]{1,64})\/stop$/);
      if (stop && req.method === "POST") {
        const controller = running.get(stop[1]);
        controller?.abort();
        return json(res, 200, { ok: true, result: { stopped: Boolean(controller) } });
      }

      if (pathname.startsWith("/api/")) return fail(res, 404, "not_found", "No such endpoint.");
      if (req.method === "GET" || req.method === "HEAD") return await serveStatic(req, res, pathname);
      return fail(res, 405, "bad_request", "Method not allowed.");
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof AppError) return fail(res, STATUS[err.code] ?? 400, err.code, err.message, err.params);
      // The stack only: a client error object can carry request config and headers.
      console.error("[ai-analyst]", err?.stack ?? String(err));
      return fail(res, 500, "internal", "Something went wrong on the server. The log has the details.");
    }
  };
}

export const isLoopbackHost = (h) => LOOPBACK_HOSTS.has(h);

/** Starts the server; resolves once it listens. A non-loopback address needs AI_ANALYST_TOKEN. */
export async function startServer(app, opts = {}) {
  const host = app.config.host ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host) && !app.config.token) {
    throw new Error(`Listening on ${host} makes this server reachable from other machines. Set AI_ANALYST_TOKEN to a long random value first, or keep the default 127.0.0.1.`);
  }
  if (app.config.token && app.config.token.length < 24) throw new Error("AI_ANALYST_TOKEN must be at least 24 characters.");
  let server;
  const handler = createHandler(app, { ...opts, port: () => server.address()?.port ?? app.config.port });
  server = createServer({ requestTimeout: 60_000, headersTimeout: 15_000, keepAliveTimeout: 5_000 }, handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(app.config.port, host === "localhost" ? "127.0.0.1" : host, resolve);
  });
  app.address = `http://${host.includes(":") ? `[${host}]` : host}:${server.address().port}`;
  return server;
}
