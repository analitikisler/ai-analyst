#!/usr/bin/env node
// ai-analyst: serve · seed-demo · mcp · ask "<question>" · check
import { parseArgs } from "node:util";
import { callAction } from "./actions/index.js";
import { runAllChecks } from "./actions/data.js";
import { runTurn } from "./agent/agent.js";
import { loadConfig, workspaceName } from "./config.js";
import { fmtPct } from "./format.js";
import { startMcp } from "./mcp.js";
import { startServer } from "./server.js";
import { openWorkspace, resetDemo } from "./workspace.js";

const HELP = `ai-analyst · analytics you can ask, with every number checked · Analitik İşler

Usage:
  ai-analyst serve [--port 8787] [--host 127.0.0.1] [--data-dir ./data] [--no-cloud]   web app and HTTP API (seeds the demo on first run)
  ai-analyst seed-demo [--data-dir ./data]                               rebuild the demo warehouse and start a fresh workspace
  ai-analyst mcp [--data-dir ./data]                                     MCP server on stdio, for chat apps
  ai-analyst ask "<question>" [--lang en|tr]                             answer one question in the terminal
  ai-analyst check [--days 14]                                           run every tracking check; exits 1 if one does not add up

Configuration: environment, then ai-analyst.config.json, then <data_dir>/secrets.json. See docs/CONTRACT.md.
A host other than 127.0.0.1 needs AI_ANALYST_TOKEN. --no-cloud (or AI_ANALYST_NO_CLOUD=1) refuses every call to BigQuery and model providers.`;

const HOUR = 60 * 60 * 1000;

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      "data-dir": { type: "string" },
      "no-cloud": { type: "boolean" },
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
  // --no-cloud: no calls to outside services (the smoke server); AI_ANALYST_NO_CLOUD=0 in the environment overrides it.
  if (values["no-cloud"] && process.env.AI_ANALYST_NO_CLOUD !== "0") process.env.AI_ANALYST_NO_CLOUD = "1";
  const env = { ...process.env, ...(values["data-dir"] ? { AI_ANALYST_DATA_DIR: values["data-dir"] } : {}), ...(values.port ? { PORT: values.port } : {}), ...(values.host ? { HOST: values.host } : {}) };
  const config = loadConfig({ env });
  const lang = values.lang === "tr" ? "tr" : config.language;
  const person = (ws) => ({ actor: "person", lang, app: ws, turn: null });

  if (command === "seed-demo") {
    const rows = await resetDemo(config);
    const ws = await openWorkspace({ ...config, warehouse: "duckdb" }, { seed: true });
    const run = ws.store.latestCheckRun();
    console.log(`Demo warehouse: ${rows} rows in ${config.dataDir}/demo.duckdb`);
    console.log(`Workspace seeded: ${run.results.length} tracking checks run, the example dashboard and the demo events.`);
    ws.close();
    return 0;
  }

  if (command === "serve") {
    const ws = await openWorkspace(config, { seed: true });
    if (ws.seeded.warehouse) console.log(`Built the demo warehouse in ${config.dataDir}/demo.duckdb`);
    if (ws.seeded.workspace) console.log("Seeded the demo workspace.");
    const server = await startServer(ws);
    const { port } = server.address();
    const mode = ws.config.provider.value === "planner" ? "built-in planner" : `${ws.config.provider.value} · ${ws.config.model}`;
    if (process.env.AI_ANALYST_NO_CLOUD === "1") console.log("No calls to outside services (AI_ANALYST_NO_CLOUD=1): BigQuery and model providers are refused.");
    console.log(`ai analyst · ${workspaceName(ws.config, ws.warehouse)} · ${ws.warehouse.dialect} · answers: ${mode}`);
    const shown = ["0.0.0.0", "::"].includes(config.host) ? "127.0.0.1" : config.host;
    console.log(`Open http://${shown.includes(":") ? `[${shown}]` : shown}:${port}/${config.token ? "?token=<AI_ANALYST_TOKEN>" : ""}`);
    // Watched checks run again at start and every hour while the server runs.
    const watched = async () => {
      if (!ws.store.list("watches").length) return;
      await runAllChecks({ store: ws.store, warehouse: ws.warehouse, pack: ws.pack }, 14, "system").catch((err) => console.error("[ai-analyst] watched checks:", err.message));
    };
    if (!ws.seeded.workspace) await watched();
    const timer = setInterval(watched, HOUR);
    timer.unref();
    const stop = () => {
      clearInterval(timer);
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
    await startMcp(ws, { lang });
    return null;
  }

  if (command === "ask") {
    const question = rest.join(" ").trim();
    if (!question) throw new Error('Give a question: ai-analyst ask "Do GA4 purchases match orders in the last 14 days?"');
    const ws = await openWorkspace(config, { seed: true });
    const turn = await runTurn({
      question,
      lang,
      app: ws,
      conversationId: "new",
      emit: (type, data) => {
        if (type === "step") console.error(`  ${data.ok ? "·" : "×"} ${data.tool} · ${data.summary[lang]}`);
      },
    });
    for (const a of turn.answers) console.log(`\n${a.sentence[lang]}\n\n${a.query.sql}\n`);
    if (turn.refusal) console.log(`${turn.refusal.heading[lang]}\n${turn.refusal.body[lang]}`);
    if (turn.text) console.log(turn.text[lang]);
    if (turn.error) console.error(turn.error.message);
    ws.close();
    return turn.error ? 1 : 0;
  }

  if (command === "check") {
    const ws = await openWorkspace(config, { seed: true });
    const run = await callAction("run_all_checks", { days: Number(values.days) }, person(ws));
    const words = { adds_up: "adds up", does_not_add_up: "does not add up", insufficient_data: "not enough data" };
    console.log(`Tracking checks, ${run.from} to ${run.to}:`);
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
