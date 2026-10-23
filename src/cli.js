#!/usr/bin/env node
// ai-analyst: serve [--port 8787] · seed-demo · mcp · ask "<question>" [--lang tr] · check [--days 14]
import { parseArgs } from "node:util";
import { callAction } from "./actions/index.js";
import { runTurn } from "./agent/agent.js";
import { loadConfig } from "./config.js";
import { fmtPct } from "./format.js";
import { startMcp } from "./mcp.js";
import { startServer } from "./server.js";
import { openWorkspace, resetDemo } from "./workspace.js";

const HELP = `ai-analyst · agent-native analytics by Analitik İşler

Usage:
  ai-analyst serve [--port 8787] [--host 127.0.0.1]   web app and HTTP API (seeds the demo on first run)
  ai-analyst seed-demo                                rebuild the demo warehouse and start a fresh workspace
  ai-analyst mcp                                      MCP server on stdio, for chat apps
  ai-analyst ask "<question>" [--lang en|tr]           answer one question in the terminal
  ai-analyst check [--days 14]                        run every check; exits 1 if one does not add up

Configuration: environment, then ai-analyst.config.json. See docs/CONTRACT.md.`;

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      lang: { type: "string", default: "en" },
      days: { type: "string", default: "14" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  if (!command || values.help || command === "help") {
    console.log(HELP);
    return 0;
  }
  const config = loadConfig();
  if (values.port) config.port = Number(values.port);
  if (values.host) config.host = values.host;
  const lang = values.lang === "tr" ? "tr" : "en";

  if (command === "seed-demo") {
    const rows = await resetDemo(config);
    const ws = await openWorkspace({ ...config, warehouse: "duckdb" }, { seed: true });
    const run = ws.store.latestCheckRun();
    console.log(`Demo warehouse: ${rows} rows in ${config.dataDir}/demo.duckdb`);
    console.log(`Workspace seeded: ${run.results.length} checks run, ${ws.store.listPins().length} pins, 1 answered question.`);
    ws.close();
    return 0;
  }

  if (command === "serve") {
    const ws = await openWorkspace(config, { seed: true });
    if (ws.seeded.warehouse) console.log(`Built the demo warehouse in ${config.dataDir}/demo.duckdb`);
    if (ws.seeded.workspace) console.log("Seeded the demo workspace.");
    const server = await startServer(ws);
    const { port } = server.address();
    console.log(`ai analyst · ${ws.config.workspace} · ${ws.warehouse.dialect} · agent: ${config.anthropicApiKey ? config.model : "built-in planner"}`);
    console.log(`Open http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${port}/`);
    const stop = () => {
      server.close();
      ws.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return null;
  }

  if (command === "mcp") {
    const ws = await openWorkspace(config, { seed: true });
    await startMcp({ ...ws, lang });
    return null;
  }

  if (command === "ask") {
    const question = rest.join(" ").trim();
    if (!question) throw new Error('Give a question: ai-analyst ask "Do GA4 purchases match our orders in the last 14 days?"');
    const ws = await openWorkspace(config, { seed: true });
    const turn = await runTurn({
      question,
      lang,
      store: ws.store,
      warehouse: ws.warehouse,
      pack: ws.pack,
      config,
      emit: (type, data) => {
        if (type === "step") console.error(`  ${data.ok ? "·" : "×"} ${data.tool} ${data.summary}`);
      },
    });
    for (const a of turn.answers) console.log(`\n${a.sentence}\n\n${a.query.sql}\n`);
    if (turn.text) console.log(turn.text);
    if (turn.error) console.error(turn.error.message);
    ws.close();
    return turn.error ? 1 : 0;
  }

  if (command === "check") {
    const ws = await openWorkspace(config, { seed: true });
    const run = await callAction("run_all_checks", { days: Number(values.days) }, { actor: "person", lang, store: ws.store, warehouse: ws.warehouse, pack: ws.pack, config, turn: null });
    const words = { adds_up: "adds up", does_not_add_up: "does not add up", insufficient_data: "not enough data" };
    console.log(`Checks, ${run.from} to ${run.to}:`);
    for (const r of run.results) {
      const delta = r.delta_pct == null ? "–" : fmtPct(r.delta_pct, 1, true);
      console.log(`  ${r.verdict === "adds_up" ? "✓" : "×"} ${r.check.padEnd(22)} Δ ${delta.padStart(7)}  ${words[r.verdict]}${r.out_of_tolerance_since && r.verdict !== "adds_up" ? ` since ${r.out_of_tolerance_since}` : ""}`);
    }
    ws.close();
    return run.results.some((r) => r.verdict === "does_not_add_up") ? 1 : 0;
  }

  throw new Error(`Unknown command "${command}".\n\n${HELP}`);
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== null) process.exitCode = code;
  },
  (err) => {
    console.error(err.message);
    process.exitCode = 2;
  },
);
