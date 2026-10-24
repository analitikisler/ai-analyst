#!/usr/bin/env node
// Development: the API server on 8788 and Vite on 5190 (web/vite.config.ts proxies /api to 8788 and presents
// the API's own origin, which the server's Origin check accepts). Ctrl-C stops both. Outside services are
// refused (AI_ANALYST_NO_CLOUD=1) unless AI_ANALYST_NO_CLOUD=0 is set.
import { spawn } from "node:child_process";
import path from "node:path";
import { ROOT } from "./config.js";

// Development makes no calls to outside services unless AI_ANALYST_NO_CLOUD=0 is set.
const env = { ...process.env, AI_ANALYST_NO_CLOUD: process.env.AI_ANALYST_NO_CLOUD === "0" ? "0" : "1" };
const children = [
  spawn(process.execPath, [path.join(ROOT, "src", "cli.js"), "serve", "--port", process.env.PORT ?? "8788"], { stdio: "inherit", cwd: process.cwd(), env }),
  spawn(process.env.BUN ?? "bun", ["run", "--cwd", path.join(ROOT, "web"), "dev"], { stdio: "inherit" }),
];
const stop = (code = 0) => {
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  process.exit(code);
};
for (const c of children) {
  c.on("exit", (code) => stop(code ?? 0));
  c.on("error", (err) => {
    console.error(err.code === "ENOENT" ? "bun was not found. Install Bun 1.3 or later, or set BUN to its path." : err.message);
    stop(1);
  });
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
