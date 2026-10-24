#!/usr/bin/env node
// Captures fixtures from a locally running ai-analyst server (demo warehouse, built-in planner).
// Start the server first with its data dir inside this prototype and no model key, then:
//   bun scripts/capture-fixtures.mjs [http://127.0.0.1:8797]
// It only talks to the given loopback address and writes JSON into src/api/fixtures/.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:8797";
if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(BASE)) throw new Error("Capture only from a loopback server.");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "api", "fixtures");

async function save(name, data) {
  await mkdir(path.dirname(path.join(OUT, name)), { recursive: true });
  await writeFile(path.join(OUT, name), JSON.stringify(data, null, 2) + "\n");
  console.log("wrote", name);
}

async function getState() {
  const res = await fetch(`${BASE}/api/state`);
  return res.json();
}

async function action(name, input, lang = "en") {
  const res = await fetch(`${BASE}/api/actions/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept-Language": lang },
    body: JSON.stringify(input ?? {}),
  });
  return res.json();
}

/** POST /api/ask and collect the event stream as [{ event, data }]. */
async function ask(question, lang, conversationId = "new", context) {
  const res = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, lang, conversation_id: conversationId, ...(context ? { context } : {}) }),
  });
  const text = await res.text();
  const events = [];
  for (const block of text.split("\n\n")) {
    const ev = block.match(/^event: (.+)$/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    if (ev) events.push({ event: ev, data: data ? JSON.parse(data) : null });
  }
  const turn = events.find((e) => e.event === "turn")?.data;
  return { question, lang, conversation_id: turn?.conversation_id ?? null, turn_id: turn?.turn_id ?? null, events };
}

const SUGGESTIONS = {
  en: [
    "Do GA4 purchases match orders in the last 14 days?",
    "Do Meta conversions match orders this month?",
    "Which channel has the highest ROAS in the last 28 days?",
    "Revenue by week for the last 90 days",
  ],
  tr: [
    "Son 14 günde GA4 satın almaları siparişlerle tutuyor mu?",
    "Bu ay Meta dönüşümleri siparişlerle tutuyor mu?",
    "Son 28 günde en yüksek ROAS hangi kanalda?",
    "Son 90 günün haftalık cirosu",
  ],
};

// More questions from 06-data.md §1, chosen to cover each planner outcome (answer, check, refusal, known bugs).
const MORE = {
  en: [
    "Revenue last week against the week before",
    "Which channel brings the most revenue?",
    "Is mobile converting worse than desktop?",
    "How many orders did we get yesterday?",
    "How much have we spent on ads this month?",
    "What is the return rate?",
    "Conversion rate by device in the last 28 days",
    "Ad spend by channel in the last 28 days",
    "Do Google Ads conversions match orders in the last 14 days?",
  ],
  tr: [
    "Geçen hafta ciro bir önceki haftaya göre nasıl?",
    "Hangi kanal daha çok ciro getiriyor?",
    "Mobilde dönüşüm oranı masaüstünden düşük mü?",
    "Dün kaç sipariş geldi?",
    "Bu ay reklama ne kadar harcandı?",
    "İade oranı ne?",
    "Son 28 günde kanallara göre reklam harcaması",
    "Son 14 günde Google Ads dönüşümleri siparişlerle tutuyor mu?",
  ],
};

const slug = (s) =>
  s
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

async function main() {
  // 1. The server's state as the seed left it (the seed adds pins, activity and one turn; see PHASE1.md).
  await save("state.seeded.json", await getState());

  // 2. Catalogue.
  for (const lang of ["en", "tr"]) {
    await save(`catalogue/metrics.${lang}.json`, await action("list_metrics", {}, lang));
    await save(`catalogue/checks.${lang}.json`, await action("list_checks", {}, lang));
    await save(`catalogue/sources.${lang}.json`, await action("list_sources", {}, lang));
    await save(`catalogue/workspace.${lang}.json`, await action("get_workspace", {}, lang));
  }
  const metrics = (await action("list_metrics", {}, "en")).result;
  const metricIds = (metrics.metrics ?? metrics).map((m) => m.id);
  const explained = {};
  for (const id of metricIds) explained[id] = (await action("explain_metric", { metric: id }, "en")).result;
  await save("catalogue/explain.json", explained);

  // 3. Checks: a full run plus each check on its own.
  await save("checks/run_all_checks.json", await action("run_all_checks", { days: 14 }, "en"));
  const checks = (await action("list_checks", {}, "en")).result;
  const checkIds = (checks.checks ?? checks).map((c) => c.id);
  const reconciled = {};
  for (const id of checkIds) {
    reconciled[id] = {
      last14: (await action("reconcile", { check: id, from: "2026-10-09", to: "2026-10-22" }, "en")).result,
      last28: (await action("reconcile", { check: id, from: "2026-09-25", to: "2026-10-22" }, "en")).result,
      month: (await action("reconcile", { check: id, from: "2026-10-01", to: "2026-10-22" }, "en")).result,
    };
  }
  await save("checks/reconcile.json", reconciled);

  // 4. Dashboard queries (06-data.md §1, the six default tiles) plus comparison periods run as second queries,
  //    since QueryParams has no compare option yet.
  const q = (metric, group_by, from, to, filters) => action("run_query", { metric, group_by, from, to, ...(filters ? { filters } : {}) }, "en").then((r) => r.result);
  const dashboard = {
    revenue_7d: await q("revenue", "none", "2026-10-16", "2026-10-22"),
    revenue_7d_daily: await q("revenue", "day", "2026-10-16", "2026-10-22"),
    revenue_prev_7d: await q("revenue", "none", "2026-10-09", "2026-10-15"),
    orders_7d: await q("orders", "none", "2026-10-16", "2026-10-22"),
    orders_7d_daily: await q("orders", "day", "2026-10-16", "2026-10-22"),
    orders_prev_7d: await q("orders", "none", "2026-10-09", "2026-10-15"),
    revenue_weekly_13w: await q("revenue", "week", "2026-07-25", "2026-10-22"),
    roas_channel_28d: await q("roas", "channel", "2026-09-25", "2026-10-22"),
    revenue_daily_28d: await q("revenue", "day", "2026-09-25", "2026-10-22"),
    revenue_daily_prev_28d: await q("revenue", "day", "2026-08-28", "2026-09-24"),
    orders_daily_28d: await q("orders", "day", "2026-09-25", "2026-10-22"),
    ga4_purchases_daily_28d: await q("ga4_purchases", "day", "2026-09-25", "2026-10-22"),
    sessions_channel_28d: await q("sessions", "channel", "2026-09-25", "2026-10-22"),
    conversion_rate_device_28d: await q("conversion_rate", "device", "2026-09-25", "2026-10-22"),
    ad_spend_channel_28d: await q("ad_spend", "channel", "2026-09-25", "2026-10-22"),
    cpa_channel_28d: await q("cpa", "channel", "2026-09-25", "2026-10-22"),
    aov_week_13w: await q("aov", "week", "2026-07-25", "2026-10-22"),
    orders_month: await q("orders", "month", "2026-07-25", "2026-10-22"),
  };
  await save("dashboard/queries.json", dashboard);

  // 5. Ask: each suggestion and the extra questions in its own conversation, both languages.
  const asks = {};
  for (const lang of ["en", "tr"]) {
    for (const question of [...SUGGESTIONS[lang], ...MORE[lang]]) {
      const turn = await ask(question, lang);
      asks[`${lang}/${slug(question)}`] = turn;
      await save(`ask/${lang}/${slug(question)}.json`, turn);
    }
  }
  // A follow-up in the same conversation as the GA4 answer (06-data.md, 04: the planner refuses it today).
  const ga4 = { en: SUGGESTIONS.en[0], tr: SUGGESTIONS.tr[0] };
  const follow = { en: "Is the gap only on mobile?", tr: "Fark sadece mobilde mi?" };
  for (const lang of ["en", "tr"]) {
    const first = await ask(ga4[lang], lang);
    const second = await ask(follow[lang], lang, first.conversation_id);
    await save(`ask/${lang}/followup-gap-mobile.json`, { conversation_id: first.conversation_id, turns: [first, second] });
  }
  // "Ask about this" from a dashboard tile: the same question with context.
  await save(
    "ask/en/context-dashboard-tile.json",
    await ask("Why is this lower than last week?", "en", "new", { view: "dashboard", answer_id: null }),
  );

  // 6. Writes, to capture their result shapes: pin an answer, create and decide an alert, undo the pin.
  const anyAnswer = Object.values(asks)
    .flatMap((t) => t.events)
    .find((e) => e.event === "answer")?.data?.answer;
  const writes = {};
  if (anyAnswer) {
    writes.pin_answer = await action("pin_answer", { answer_id: anyAnswer.id, title: "Pinned from fixtures" }, "en");
    writes.create_alert = await action(
      "create_alert",
      { check: "ga4_vs_orders", title: "GA4 against orders" },
      "en",
    );
    const after = await getState();
    const pinActivity = after.activity.find((a) => a.undo?.type === "pin");
    if (pinActivity) writes.undo = await action("undo", { activity_id: pinActivity.id }, "en");
  }
  writes.unknown_action = await action("no_such_action", {}, "en");
  writes.bad_input = await action("run_query", { metric: "nope" }, "en");
  await save("writes.json", writes);

  // 7. State at the end (one conversation, latest turns hydrated).
  await save("state.after.json", await getState());

  // 8. The ask index the fixture API matches questions against.
  await save("ask/index.json", await askIndex());
}

/** [{ lang, question, file, turn }] for every captured turn, read back from disk. */
async function askIndex() {
  const { readdir, readFile } = await import("node:fs/promises");
  const index = [];
  for (const lang of ["en", "tr"]) {
    for (const file of (await readdir(path.join(OUT, "ask", lang))).sort()) {
      const data = JSON.parse(await readFile(path.join(OUT, "ask", lang, file), "utf8"));
      const turns = data.turns ?? [data];
      turns.forEach((t, turn) => index.push({ lang, question: t.question, file: `${lang}/${file}`, turn, answered: t.events.some((e) => e.event === "answer") }));
    }
  }
  return index;
}

if (process.argv.includes("--index-only")) {
  await save("ask/index.json", await askIndex());
  process.exit(0);
}

if (!process.argv.includes("--index-only")) main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
