// The brand (brand/ai/BRAND.md §3): product names are lowercase and never translated. The retired names must not
// appear in the copy (src/text.js), in any server source string, or in what the server sends: AppState, the
// catalogue, the agent's system prompt, the MCP server's name, instructions and tool descriptions, the waitlist.
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../src/config.js";
import { callAction, registry } from "../src/actions/index.js";
import { systemPrompt } from "../src/agent/agent.js";
import { buildMcpServer } from "../src/mcp.js";
import { buildState } from "../src/state.js";
import { execFile } from "node:child_process";
import { ctxFor, demoWorkspace, tempDir } from "./helpers.js";

// "AI Analyst", "Ai Tag Debugger", "A.I. analyst", "ai Analyst", "AI-Tag-Debugger", "Analitik İşler Cloud", and the
// other retired product names. The new names ("ai analyst", "ai tag debugger", "ai cloud") and code identifiers
// ("ai-analyst", "ai_tag_debugger", AI_ANALYST_*) do not match.
const RETIRED = [
  /\b(?:AI|Ai|aI|A\.I\.)[ -]+(?:[Aa]nalyst|[Tt]ag[ -][Dd]ebugger)\b/,
  /\bai[ -]+(?:Analyst|Tag\b|tag Debugger)/,
  /Analitik [İI][şs]ler Cloud/i,
  /\bTagport\b/,
];
const retiredIn = (text) => RETIRED.map((re) => text.match(re)?.[0]).filter(Boolean);

let ws;
before(async () => (ws = await demoWorkspace({ seed: true })));
after(() => ws.close());

test("the retired names are in no server source file", () => {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".js")) files.push(p);
    }
  };
  walk(path.join(ROOT, "src"));
  assert.ok(files.some((f) => f.endsWith(path.join("src", "text.js"))));
  for (const f of files) assert.deepEqual(retiredIn(readFileSync(f, "utf8")), [], path.relative(ROOT, f));
});

test("the retired names are in nothing the server sends", async () => {
  const ctx = ctxFor(ws);
  const out = {
    state: await buildState(ws),
    sources: await callAction("list_sources", {}, ctx),
    suggestions: await callAction("list_suggestions", {}, ctx),
    metrics: await callAction("list_metrics", {}, ctx),
    checks: await callAction("list_checks", {}, ctx),
    settings: await callAction("get_settings", {}, ctx),
    chat_app: await callAction("get_chat_app_setup", { client: "claude-desktop" }, ctx),
    actions: [...registry.values()].map((a) => a.description),
    prompt: systemPrompt({ pack: ws.pack, range: await ws.warehouse.range(), workspace: "Örnek Moda", demo: true, lang: "en" }),
  };
  assert.deepEqual(retiredIn(JSON.stringify(out)), []);
  assert.match(out.prompt, /You are the analytics agent in ai analyst by Analitik İşler/);
  assert.ok(out.state.waitlist.every((w) => decodeURIComponent(w.mailto).includes("?subject=ai cloud waitlist: ") && w.mailto.startsWith("mailto:hello@analitikisler.com")));
  assert.ok(out.sources.some((s) => s.name?.en === "ai tag debugger"));
});

test("the MCP server: id ai-analyst, display name ai analyst, no retired name in its instructions or tools", () => {
  const mcp = buildMcpServer(ws);
  const info = mcp.server._serverInfo ?? {};
  assert.equal(info.name, "ai-analyst");
  assert.equal(info.title, "ai analyst");
  const instructions = mcp.server._instructions ?? "";
  assert.match(instructions, /^ai analyst \(by Analitik İşler\)/);
  assert.deepEqual(retiredIn(instructions), []);
  assert.deepEqual(retiredIn(JSON.stringify(Object.keys(mcp._registeredTools ?? {}).map((k) => mcp._registeredTools[k].description))), []);
});

test("the guard itself: retired spellings are caught, the new names and identifiers are not", () => {
  for (const bad of ["AI Analyst", "Ai Analyst", "AI analyst", "AI-Tag-Debugger", "AI Tag Debugger’ın", "A.I. analyst", "ai Analyst", "Analitik İşler Cloud", "analitik işler cloud", "Tagport"]) assert.notDeepEqual(retiredIn(bad), [], bad);
  for (const ok of ["ai analyst", "ai analyst’te", "ai tag debugger’ı", "ai cloud’da", "ai-analyst", "@analitikisler/ai-analyst", "ai_tag_debugger", "AI_ANALYST_TOKEN", "Analitik İşler", "the AI in a chat app"]) assert.deepEqual(retiredIn(ok), [], ok);
});

test("ai-analyst check prints plain verdict words, no ✓ or × in front (BRAND §11)", async () => {
  const dir = tempDir("aa-cli-");
  // A clean environment: only what the CLI needs, never the caller's keys.
  const env = { PATH: process.env.PATH, AI_ANALYST_NO_CLOUD: "1", AI_ANALYST_DATA_DIR: dir };
  const out = await new Promise((resolve) => execFile(process.execPath, [path.join(ROOT, "src", "cli.js"), "check", "--days", "14"], { cwd: dir, env, timeout: 120_000 }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr })));
  assert.ok([0, 1].includes(out.code), out.stderr);
  const lines = out.stdout.split("\n").filter((l) => /^ {2}\S/.test(l));
  assert.equal(lines.length, 4, out.stdout);
  for (const l of lines) {
    assert.doesNotMatch(l, /[✓×✔✗!]/, l);
    assert.match(l, /(adds up|does not add up|not enough data)/, l);
  }
});

test("the metric pack belongs to Analitik İşler: owner and history actor (BRAND §11)", () => {
  for (const m of Object.values(ws.pack.metrics)) {
    assert.equal(m.owner, "Analitik İşler", m.id);
    for (const h of m.history ?? []) assert.equal(h.actor?.en ?? h.actor, "Analitik İşler", `${m.id} v${h.version}`);
  }
});
