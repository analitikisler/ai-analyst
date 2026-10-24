#!/usr/bin/env bun
// House-rule lint for src/ (runs before every build):
// - no `dark:` classes: tokens switch with the theme by themselves;
// - no hex colours in components: tokens only (brand/tokens.css owns every value);
// - no inline interface text in JSX: copy lives in src/i18n/en.ts and tr.ts;
// - no em dashes anywhere in the copy or the code.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const problems = [];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "fixtures") yield* walk(full);
    } else if (/\.(tsx?|css)$/.test(entry.name)) yield full;
  }
}

for await (const file of walk(SRC)) {
  const rel = path.relative(SRC, file);
  const text = await readFile(file, "utf8");
  text.split("\n").forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (/(^|["'`\s])dark:[a-z[]/.test(line) && !line.trim().startsWith("//")) problems.push(`${at} dark: class`);
    if (/#[0-9a-fA-F]{3,8}\b/.test(line) && !rel.endsWith(".css") && !line.trim().startsWith("//")) problems.push(`${at} hex colour`);
    if (line.includes("—")) problems.push(`${at} em dash`);
    if (rel.endsWith(".tsx") && !rel.startsWith("i18n")) {
      // Text between tags that starts with a letter, e.g. <span>Close</span>; {expressions} are fine.
      const m = /(?<![=\w])>\s*([A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü' ,.]{1,})\s*</.exec(line);
      if (m) problems.push(`${at} inline text "${m[1].trim()}"`);
      const a = /\b(aria-label|title|placeholder|alt)="([A-Za-z][^"]*)"/.exec(line);
      if (a) problems.push(`${at} inline ${a[1]} "${a[2]}"`);
    }
  });
}

if (problems.length) {
  console.error(`House-rule lint: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("House-rule lint: clean");
