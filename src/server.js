// HTTP API and the static front end. Binds 127.0.0.1 by default: the app holds the person's
// warehouse access, so it is a local tool unless someone deliberately puts it behind auth.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { callAction, registry } from "./actions/index.js";
import { workspaceInfo } from "./actions/catalogue.js";
import { agentMode, runTurn } from "./agent/agent.js";
import { ROOT } from "./config.js";
import { AppError } from "./errors.js";

export const MAX_BODY_BYTES = 1024 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
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
  ".md": "text/markdown; charset=utf-8",
};

const SECURITY_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" };
const STATUS = { not_found: 404, unknown_action: 404, forbidden: 403, too_large: 413, bad_request: 400 };
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const json = (res, status, body) => {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};
const fail = (res, status, code, message) => json(res, status, { ok: false, error: { code, message } });

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
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("bad_request", "The request body is not valid JSON.");
  }
}

const langOf = (req, url, body) => {
  const l = body?.lang ?? url.searchParams.get("lang") ?? req.headers["accept-language"] ?? "";
  return String(l).toLowerCase().startsWith("tr") ? "tr" : "en";
};

/**
 * @param {{ config: any, store: any, warehouse: any, pack: any, client?: any, webDir?: string }} app
 *   client: an Anthropic client for the agent (tests pass a stub).
 */
export function createHandler(app) {
  const { config, store, warehouse, pack } = app;
  const webDir = path.resolve(app.webDir ?? path.join(ROOT, "web"));
  const running = new Map(); // turn id -> AbortController
  const loopbackOnly = LOOPBACK.has(config.host ?? "127.0.0.1");

  async function state() {
    const ws = await workspaceInfo({ store, warehouse, pack, config });
    const run = store.latestCheckRun();
    const conv = store.latestConversation();
    return {
      workspace: { name: ws.name, demo: ws.demo, data_from: ws.data_from, data_to: ws.data_to, refreshed_at: ws.refreshed_at },
      agent: agentMode(config, app.client),
      pins: store.listPins(),
      alerts: store.listAlerts(),
      activity: store.listActivity(100),
      checks: run?.results ?? [],
      check_run: run ? { id: run.id, created_at: run.created_at, days: run.days, actor: run.actor } : null,
      conversations: conv ? [{ id: conv.id, turns: store.listTurns(conv.id).map((t) => store.hydrateTurn(t)) }] : [],
    };
  }

  async function ask(req, res, body) {
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question || question.length > 2000) return fail(res, 400, "bad_request", "question must be text of 1 to 2,000 characters.");
    const controller = new AbortController();
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
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
        lang: langOf(req, new URL(req.url, "http://x"), body),
        conversationId: typeof body.conversation_id === "string" ? body.conversation_id : undefined,
        context: body.context && typeof body.context === "object" ? body.context : undefined,
        store,
        warehouse,
        pack,
        config,
        client: app.client,
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

  async function serveStatic(req, res, pathname) {
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return fail(res, 400, "bad_request", "Bad path.");
    }
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(webDir, `.${path.posix.normalize(`/${rel}`)}`);
    if (file !== webDir && !file.startsWith(webDir + path.sep)) return fail(res, 404, "not_found", "Not found.");
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error("not a file");
      const body = await readFile(file);
      res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  }

  return async function handler(req, res) {
    const url = new URL(req.url, "http://localhost");
    const { pathname } = url;
    try {
      // A page on another site must not drive this server through the browser (DNS rebinding, CSRF).
      const host = (req.headers.host ?? "").replace(/:\d+$/, "");
      if (loopbackOnly && !LOOPBACK.has(host)) return fail(res, 403, "forbidden", "This server only answers on localhost.");
      if (req.method === "POST") {
        const origin = req.headers.origin;
        if (origin && origin !== "null") {
          let originHost = "";
          try {
            originHost = new URL(origin).host;
          } catch {}
          if (originHost !== req.headers.host) return fail(res, 403, "forbidden", "Cross-origin requests are not accepted.");
        } else if (origin === "null") return fail(res, 403, "forbidden", "Cross-origin requests are not accepted.");
        if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json") && Number(req.headers["content-length"] ?? 0) > 0) {
          return fail(res, 415, "bad_request", "Send JSON with Content-Type: application/json.");
        }
      }

      if (pathname === "/api/state" && req.method === "GET") return json(res, 200, await state());

      const action = pathname.match(/^\/api\/actions\/([a-z_]+)$/);
      if (action && req.method === "POST") {
        const body = await readJson(req);
        if (!registry.has(action[1])) return fail(res, 404, "unknown_action", `Unknown action "${action[1]}".`);
        const result = await callAction(action[1], body, { actor: "person", lang: langOf(req, url, null), store, warehouse, pack, config, turn: null });
        return json(res, 200, { ok: true, result });
      }

      if (pathname === "/api/ask" && req.method === "POST") return await ask(req, res, await readJson(req));

      const stop = pathname.match(/^\/api\/turns\/([A-Za-z0-9_]+)\/stop$/);
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
      if (err instanceof AppError) return fail(res, STATUS[err.code] ?? 400, err.code, err.message);
      console.error("[ai-analyst]", err);
      return fail(res, 500, "internal", "Something went wrong on the server. The log has the details.");
    }
  };
}

/** Starts the server; resolves once it listens. */
export async function startServer(app) {
  const server = createServer(createHandler(app));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(app.config.port, app.config.host ?? "127.0.0.1", resolve);
  });
  return server;
}
