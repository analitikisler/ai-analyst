#!/usr/bin/env bun
// Rewrites shadcn/ui component classes into the Tally vocabulary, so a component added later with
// `bunx --bun shadcn@4.21.4 add <name>` matches the rest of the kit. Idempotent; run it after every add:
//   bun scripts/tally-shadcn.mjs [files...]   (default: every file in src/components/ui)
//
// It also drops "use client" (not an RSC app). What it changes, and why (Analitik İşler design system, see PHASE1.md):
// - `dark:*` classes go: tokens switch with the theme, components never branch on it.
// - shadcn's `accent` means "hover ground"; Tally's `accent` is the link blue. Hover grounds become surface-2.
// - Focus glows (`ring-3 ring-ring/50`) and `outline-none` on controls go: one focus treatment for the whole app,
//   the 2 px accent outline from index.css. Menu items keep `outline-hidden`, their highlight is the ground.
// - Invalid glows go (no glow, no blur); the red border stays.
// - Overlays: scrim `bg-overlay`, a 1 px `ring-border` edge, no backdrop blur, no zoom.
// - Nothing moves on press (`translate-y-px`), transitions are colour only.
// - Controls (buttons, inputs, toggles, selects) use the 4 px radius (`rounded-md`); cards and panels 6 px.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "ui");
const CONTROLS = new Set(["button.tsx", "input.tsx", "textarea.tsx", "select.tsx", "native-select.tsx", "toggle.tsx", "toggle-group.tsx", "input-group.tsx", "tabs.tsx", "kbd.tsx"]);

/** Rewrites one class token; returns null to drop it. */
function token(t, file) {
  const variants = t.split(":");
  const utility = variants[variants.length - 1];
  const prefix = variants.slice(0, -1);
  if (prefix.includes("dark")) return null;
  // Focus and invalid glows.
  if (/^ring-(3|\[3px\])$/.test(utility) && prefix.some((p) => p.includes("focus") || p.includes("aria-invalid") || p.startsWith("has-"))) return null;
  if (/^ring-(ring\/50|destructive\/\d+)$/.test(utility)) return null;
  if (utility === "border-ring" && prefix.some((p) => p.includes("focus"))) return null;
  if (/^border-destructive\/\d+$/.test(utility) && prefix.some((p) => p.includes("focus"))) return null;
  if (utility === "outline-none" && !prefix.some((p) => p.includes("focus"))) return null;
  if (/^outline-(1|ring)$/.test(utility) && prefix.some((p) => p.includes("focus"))) return null;
  // Overlays: the Tally scrim, a 1 px rule instead of a translucent ring, no blur, nothing zooms.
  if (/^backdrop-blur/.test(utility) || prefix.includes("supports-backdrop-filter")) return null;
  if (/^bg-black\/\d+$/.test(utility)) return [...prefix, "bg-overlay"].join(":");
  if (utility === "ring-foreground/10") return [...prefix, "ring-border"].join(":");
  if (/^zoom-(in|out)-\d+$/.test(utility)) return null;
  // Motion.
  if (utility === "translate-y-px") return null;
  if (utility === "transition-all") return [...prefix, "transition-colors"].join(":");
  // Hover grounds and their ink.
  if (utility === "bg-accent") return [...prefix, "bg-surface-2"].join(":");
  if (utility === "text-accent-foreground") return [...prefix, "text-text-strong"].join(":");
  // Radius on controls.
  if (CONTROLS.has(file)) {
    if (/^rounded-(lg|\[min\(var\(--radius-md\),\d+px\)\])$/.test(utility)) return [...prefix, "rounded-md"].join(":");
  }
  return t;
}

function rewriteClassString(s, file) {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => token(t, file))
    .filter((t) => t !== null)
    .join(" ");
}

async function rewrite(fileName) {
  const full = path.isAbsolute(fileName) ? fileName : path.join(UI, fileName);
  const base = path.basename(full);
  const src = await readFile(full, "utf8");
  // Every double-quoted string except module specifiers; token() only touches the utilities listed above.
  const out = src.replace(/^"use client"\n\n?/, "").replace(/(?<!from\s)"([^"\n]*)"/g, (_m, inner) => `"${rewriteClassString(inner, base)}"`);
  if (out !== src) {
    await writeFile(full, out);
    console.log("tallied", base);
  }
}

const files = process.argv.slice(2);
for (const f of files.length ? files : (await readdir(UI)).filter((f) => f.endsWith(".tsx"))) await rewrite(f);
