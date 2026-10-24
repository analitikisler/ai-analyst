#!/usr/bin/env node
// npm pack and publish: web/.gitignore (the front end's) keeps web/dist out of the package, so the built app is
// copied to ./web-dist before packing and removed after. The server serves web/dist when it exists (a checkout),
// else web-dist (an installed package).
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";

const from = path.join(ROOT, "web", "dist");
const to = path.join(ROOT, "web-dist");
if (process.argv[2] === "copy") {
  if (!existsSync(path.join(from, "index.html"))) {
    console.error("web/dist is missing: run bun run build first.");
    process.exit(1);
  }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
} else if (process.argv[2] === "clean") rmSync(to, { recursive: true, force: true });
else {
  console.error("Usage: node src/pack.js copy|clean");
  process.exit(2);
}
