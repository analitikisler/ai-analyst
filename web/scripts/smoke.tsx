// Smoke test of the prototype's mock server and formatters, bundled by Vite and run by Bun (`bun run smoke`).
// Checks the figures against 09-ux.md (real demo numbers), the flows' rules, and renders every route in en and tr.
import { QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { createQueryClient, keys } from "../src/api/queries";
import { httpDriver, mockDriver } from "./smoke-driver";
import { groupEvents } from "../src/components/charts/events";
import { AnswerCard } from "../src/components/ask/AnswerCard";
import { CheckBars } from "../src/components/charts/CheckBars";
import { TurnView } from "../src/components/ask/Thread";
import { MessageScroller, MessageScrollerContent, MessageScrollerProvider, MessageScrollerViewport } from "../src/components/ui/message-scroller";
import { MAIN_NAV } from "../src/components/layout/nav";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { LanguageProvider } from "../src/i18n";
import { routes } from "../src/routes";
import type { AskEvent, Lang } from "../src/api/types";
import { createFormat } from "../src/lib/format";
import { renderSmoke } from "./render-smoke";

const SMOKE_URL = process.env.SMOKE_URL;
const driver = SMOKE_URL ? await httpDriver(SMOKE_URL) : await mockDriver();
const HTTP = driver.kind === "http";
if (HTTP) {
  console.log(`smoke against ${SMOKE_URL} (no reset: run it on a freshly seeded demo data dir, built-in planner)`);
  try {
    await driver.state();
  } catch (err) {
    console.log(`FAIL the server at ${SMOKE_URL} does not answer GET /api/state: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

let failures = 0;
let skipped = 0;
/** A step that needs the mock (the simulated key or fix): skipped over HTTP. */
const skip = (name: string) => {
  console.log(`skip ${name} (fixtures only)`);
  skipped++;
};
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : ` · ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};
async function ask(question: string, lang: Lang, conversation_id?: string) {
  const events: AskEvent[] = [];
  await driver.turn({ question, lang, conversation_id }, (e) => events.push(e));
  return events;
}
const answerOf = (ev: AskEvent[]) => ev.find((e) => e.event === "answer")?.data as { answer: import("../src/api/types").Answer } | undefined;

(await driver.reset());
const s0 = (await driver.state());
check("first run: no conversations, two system activity rows, no person rows", s0.conversations.length === 0 && s0.activity.length === 2 && s0.activity.every((a) => a.actor === "system"));
check("one dashboard, Shop overview, Example, six tiles", s0.dashboards.length === 1 && s0.dashboards[0]!.name.en === "Shop overview" && s0.dashboards[0]!.example && s0.dashboards[0]!.tiles === 6);

const ga4 = answerOf(await ask("Do GA4 purchases match orders in the last 14 days?", "en", "new"))!.answer;
const c = ga4.check!;
check("F1 GA4: 2,753 against 2,474, −10.1%, since 9 Oct, finding", c.expected.value === 2753 && c.measured.value === 2474 && Math.abs(c.delta_pct! + 0.1013) < 0.0005 && c.out_of_tolerance_since === "2026-10-09" && c.findings.length === 1);
check("F1 sentence matches 09-ux.md", ga4.sentence.en === "Does not add up. GA4 recorded 2,474 purchases against 2,753 back-office orders for 9–22 Oct 2026: 10.1% fewer, outside the ±5% tolerance. The gap is on mobile (−15.6%) from 9 Oct.", ga4.sentence.en);
check("F1 chart shows the v4.12 marker (a global event in its range)", groupEvents((await driver.state()).events, ga4.check!.series!.map((p) => p.date)).some((g) => g.events.some((e) => e.id === "ev_v412")));
const dev = answerOf(await ask("Is the gap only on mobile?", "en"))!.answer;
// handmade marks a fixture the mock replays; the server computes the same answer and has no such flag.
check("F2 device follow-up answered", dev.kind === "check_split" && (driver.kind === "http" || dev.handmade === true) && dev.sentence.en.startsWith("Yes. On mobile GA4 recorded 1,419 purchases against 1,681 orders"), dev.sentence.en);
check("F2 headline is the mobile segment: 1,681 / 1,419, −15.6%, all devices −10.1% on one line", dev.check!.expected.value === 1681 && dev.check!.measured.value === 1419 && Math.abs(dev.check!.delta_pct! + 0.156) < 0.0005 && dev.check!.label.en.endsWith("· mobile") && dev.check!.breakdown.length === 2 && Math.abs(dev.overall!.delta_pct! + 0.1013) < 0.0005, dev.check!.label);
{
  const conv = (await driver.state()).conversations[0]!;
  const full = (await driver.act("get_conversation", { conversation_id: conv.id }, "en"));
  check("questions from suggestions and follow-ups keep both languages; the title follows", conv.title_text?.tr === "Son 14 günde GA4 satın almaları siparişlerle tutuyor mu?" && full.turn_list[1]!.question_text?.tr === "Fark yalnızca mobilde mi?", conv.title_text);
}
{
  // "Why" explains rather than repeats: its own kind, the start and the release, the segment, no why follow-up.
  const why = answerOf(await ask("Why do GA4 purchases not match back-office orders for 9–22 Oct?", "en", "new"))!.answer;
  check("why is its own kind: since 9 Oct, release v4.12, mobile, mobile Safari, next steps", why.kind === "why" && why.why?.started === "2026-10-09" && why.why.release === "v4.12" && why.why.segment?.key === "mobile" && why.why.narrower?.en === "mobile Safari" && why.why.next.length >= 2, why.why);
  check("a why answer offers no why follow-up", !why.followups.some((q) => /^why/i.test(q.en)), why.followups.map((q) => q.en));
  // Walk the follow-ups from the first suggestion, five steps deep: never a repeat, never the question just answered.
  const askedQ: string[] = [];
  let conv: string | undefined = "new";
  let q = "Do GA4 purchases match orders in the last 14 days?";
  let repeats: string[] = [];
  let depth = 0;
  for (; depth < 6; depth++) {
    askedQ.push(q);
    const ev = await ask(q, "en", conv);
    conv = (ev.find((e) => e.event === "turn")!.data as { conversation_id: string }).conversation_id;
    const a = answerOf(ev)?.answer;
    if (!a) break;
    const offered = a.followups.map((x) => x.en);
    repeats = repeats.concat(offered.filter((x) => askedQ.includes(x)));
    if (offered.length > 3) repeats.push(`more than 3 after "${q}"`);
    const next = offered.find((x) => !/^(Watch|Pin)/.test(x));
    if (!next) break;
    q = next;
  }
  if (process.env.SHOW_WALK) console.log(askedQ);
  check("follow-up walk: five steps deep from the first suggestion, no repeats", depth >= 5 && repeats.length === 0, { depth, repeats, askedQ });
}
const meta = answerOf(await ask("Do Meta conversions match orders this month?", "en", "new"))!.answer;
check("Meta this month: 483 against 658, +36.2%", meta.check!.expected.value === 483 && meta.check!.measured.value === 658);
const roas = answerOf(await ask("ROAS by channel in the last 28 days", "en", "new"))!.answer;
check("ROAS 2.09× overall, Google Ads 2.66×", roas.sentence.en === "ROAS for 25 Sep–22 Oct 2026 is 2.09× overall. Google Ads leads at 2.66×, then Meta Ads at 1.75× and TikTok Ads at 1.09×.", roas.sentence.en);
const week = answerOf(await ask("Revenue last week against the week before", "en", "new"))!.answer;
check("Last week = 12–18 Oct against 5–11 Oct, down 1.2%", week.query.from === "2026-10-12" && week.query.comparison?.from === "2026-10-05" && week.sentence.en.includes("down 1.2%"), week.sentence.en);
const yd = answerOf(await ask("Dün kaç sipariş geldi?", "tr", "new"))!.answer;
check("Yesterday = 22 Oct, 165 orders", yd.query.from === "2026-10-22" && yd.query.total === 165);
const rev = answerOf(await ask("Hangi kanal daha çok ciro getiriyor?", "tr", "new"))!.answer;
check("Revenue by channel has no unasked check", rev.check === null && rev.kind === "split");
const refusal = (await ask("Compare email and Google Ads last month", "en", "new")).find((e) => e.event === "refusal");
check("F3a planner refusal with three similar questions", refusal?.event === "refusal" && refusal.data.code === "planner_unknown" && refusal.data.nearest.length === 3);
const nid = (await ask("Which products sell most?", "en", "new")).find((e) => e.event === "refusal");
check("F3b not in data, no model route", nid?.event === "refusal" && nid.data.code === "not_in_data");
const prop = (await ask("Watch the Meta tracking check", "en", "new")).find((e) => e.event === "approval");
check("S05 the agent proposes, nothing written", prop?.event === "approval" && (await driver.state()).watches.length === 0 && (await driver.state()).badges.waiting === 1);
if (prop?.event === "approval") (await driver.act("decide_proposal", { proposal_id: prop.data.proposal.id, approve: true, where: "ask" }, "en"));
check("approval creates the watch", (await driver.state()).watches.some((w) => w.check === "meta_vs_orders"));

const pin = (await driver.act("pin_answer", { answer_id: dev.id }, "en"));
check("F4 pin becomes a 6×1 split bar tile", pin.tile.chart === "split_bar" && pin.tile.size.w === 6);
const d = (await driver.act("get_dashboard", { dashboard_id: "db_example" }, "en"));
const pinned = d.tiles.find((t) => t.tile_id === pin.tile.id)!;
check("F4 the pinned tile re-runs on 28 days: mobile −9.2%", Math.abs(pinned.check!.breakdown.find((b) => b.key === "mobile")!.delta_pct! + 0.0924) < 0.0005);
const revTile = d.tiles.find((t) => t.tile_id === "pin_revenue")!;
check("S07 revenue 7.63M TL against 6.87M TL", Math.round(revTile.query!.total! / 1e4) === 763 && Math.round(revTile.query!.comparison!.total! / 1e4) === 687);
(await driver.act("undo", { activity_id: pin.activity_id }, "en"));
check("undo removes the tile", !(await driver.act("get_dashboard", { dashboard_id: "db_example" }, "en")).tiles.some((t) => t.tile_id === pin.tile.id));
const ch = (await driver.act("update_tile", { tile_id: "pin_rev_day", chart: "column" }, "en"));
check("F5 chart change is undoable", !!ch.activity_id);
let refused = false;
try {
  (await driver.act("update_tile", { tile_id: "pin_rev_day", size: { w: 3, h: 2 } }, "en"));
} catch {
  refused = true;
}
check("F5 width 3 refused for columns", refused);
const per = (await driver.act("set_dashboard_period", { dashboard_id: "db_example", period: "last_14" }, "en"));
const d14 = (await driver.act("get_dashboard", { dashboard_id: "db_example" }, "en"));
check("F6 last 14 days: revenue 4.11M TL up 16.7% against 3.52M TL", Math.round(d14.tiles[0]!.query!.total! / 1e4) === 411 && Math.round(d14.tiles[0]!.query!.comparison!.total! / 1e4) === 352);
(await driver.act("undo", { activity_id: per.activity_id }, "en"));

// The BigQuery and model-key tests make real calls on the server (Google, Anthropic). Over HTTP they run only against
// a server started with --no-cloud, where they must be refused with no_cloud; without it they are skipped.
const refusedNoCloud = async (fn: () => Promise<unknown>, service: string) => {
  try {
    await fn();
    return false;
  } catch (err) {
    const e = err as { code?: string; params?: Record<string, unknown> };
    return e.code === "no_cloud" && e.params?.service === service;
  }
};
const bqInput = { data_project: "ornek-moda-data", job_project: null, dataset: "ai_analyst", location: null, auth: { kind: "adc" as const }, max_bytes: 2 * 1024 ** 3 };
if (driver.kind === "http" && !driver.noCloud) skip("F8 BigQuery test and F9 model key test (start the server with --no-cloud)");
else if (driver.kind === "http") {
  // Without Google credentials on the machine the test stops at step 1 (a local check), before any call; with them
  // the guard refuses it. Either way nothing leaves the machine.
  const bqNo = await refusedNoCloud(() => driver.act("test_bigquery", bqInput, "en"), "BigQuery");
  const bqLocal = bqNo ? null : await driver.act("test_bigquery", bqInput, "en").catch(() => null);
  check("F8 no-cloud server: the BigQuery test is refused (no_cloud) or stops at local credentials", bqNo || (!!bqLocal && bqLocal.steps[0]?.status === "failed" && bqLocal.steps.slice(1).every((x) => x.status === "skipped")), bqLocal?.steps[0]);
  check("F9 no-cloud server: the key test is refused with no_cloud", await refusedNoCloud(() => driver.act("test_model_key", { provider: "anthropic", key: "abc", model: "claude-opus-5-5" }, "en"), "Anthropic"));
  check("F9 no-cloud server: saving a key is refused with no_cloud", await refusedNoCloud(() => driver.act("save_model_key", { provider: "anthropic", key: "sk-ant-x1", model: "claude-opus-5-5" }, "en"), "Anthropic"));
  check("F9 no-cloud server: no key saved, the built-in planner answers", (await driver.state()).agent.mode !== "model");
} else {
  const bad = (await driver.act("test_bigquery", { data_project: "ornek-moda-data", job_project: null, dataset: "ai_analyst", location: null, auth: { kind: "adc" }, max_bytes: 2 * 1024 ** 3 }, "en"));
  check("F8 first test fails at step 2 (Job User)", !bad.ok && bad.steps[1]!.status === "failed" && bad.steps[1]!.error?.code === "no_jobs");
  const good = (await driver.act("test_bigquery", { data_project: "ornek-moda-data", job_project: "ornek-moda-analytics", dataset: "ai_analyst", location: null, auth: { kind: "adc" }, max_bytes: 2 * 1024 ** 3 }, "en"));
  check("F8 retry passes all six steps", good.ok && good.steps.every((x) => x.status === "ok"));
  (await driver.act("save_data_source", { kind: "bigquery", test_id: good.test_id }, "en"));
  check("F8 status line names BigQuery", (await driver.state()).source.kind === "bigquery" && (await driver.state()).source.project === "ornek-moda-data");
  const rej = (await driver.act("test_model_key", { provider: "anthropic", key: "abc", model: "claude-opus-5-5" }, "en"));
  const okk = (await driver.act("test_model_key", { provider: "anthropic", key: "sk-ant-x1", model: "claude-opus-5-5" }, "en"));
  check("F9 key test: sk-ant- passes, others rejected", !rej.ok && rej.error?.code === "key_rejected" && okk.ok);
  (await driver.act("save_model_key", { provider: "anthropic", key: "sk-ant-x1", model: "claude-opus-5-5" }, "en"));
  check("F9 Anthropic in use", (await driver.state()).agent.provider === "anthropic");
}
check("F10 Claude Desktop snippet carries the env block", (await driver.act("get_chat_app_setup", { client: "claude-desktop" }, "en")).snippet.includes("AI_ANALYST_DATA_DIR"));
(await driver.act("set_preference", { key: "make_it_yours", value: "hidden" }, "en"));
check("F11 card hidden is remembered", (await driver.state()).preferences.make_it_yours === "hidden");
check("activity holds only real actions (no ask rows)", !(await driver.state()).activity.some((a) => a.action === "ask"));

const en = createFormat("en");
const trf = createFormat("tr");
check("en formats", en.value(2753, "count") === "2,753" && en.value(1843210, "try") === "1.84M TL" && en.pct(-0.101, 1, true) === "−10.1%");
check("tr formats", trf.value(2753, "count") === "2.753" && trf.value(1843210, "try") === "1,84 mn TL" && trf.pct(-0.101, 1, true) === "−%10,1");

// `bun run fixtures:handmade` writes the target-behaviour turns (the bugs DECISIONS.md §8 fixes) as fixture
// files marked handmade, next to the captured ones, so a reviewer can compare them with today's planner.
// ---------------------------------------------------------------- owner round 4: checks, activity, exploratory
{
  const nav = MAIN_NAV.map((n) => n.key as string);
  check("nav is Ask, Dashboards and Metrics (no Checks, no Activity)", nav.join(",") === "ask,dashboards,metrics", nav);
  const kids = (routes[0]!.children![0]!.children ?? []) as { path?: string; element?: unknown; lazy?: unknown }[];
  const redirect = (path: string) => kids.find((r) => r.path === path);
  check("/checks, /checks/:id and /activity redirect", ["checks", "checks/:checkId", "activity"].every((p) => !!redirect(p)?.element && !redirect(p)?.lazy));
  (await driver.reset());
  // The check strip and the tally tiles show the same check over the same (dashboard) period.
  const sameDelta: string[] = [];
  const verdicts: string[] = [];
  for (const period of ["last_28", "last_7", "last_week", "this_month"] as const) {
    (await driver.act("set_dashboard_period", { dashboard_id: "db_example", period, compare: "previous_period" }, "en"));
    const d = (await driver.act("get_dashboard", { dashboard_id: "db_example" }, "en"));
    for (const tile of d.tiles.filter((x) => x.check)) {
      const row = d.checks.find((c) => c.check === tile.check!.check)!;
      if (row.delta_pct !== tile.check!.delta_pct || row.from !== tile.from || row.to !== tile.to) sameDelta.push(`${period} ${row.check}`);
    }
    verdicts.push(`${period}:${d.checks.map((c) => `${c.check}=${c.verdict}`).join(",")}`);
  }
  check("strip rows and tally tiles show the same Δ for the same check, for every dashboard period", sameDelta.length === 0, sameDelta);
  check("GA4 over the dashboard's 28 days still does not add up", verdicts[0]!.includes("ga4_vs_orders=does_not_add_up"), verdicts);
  if (process.env.SHOW_VERDICTS) console.log(verdicts.join("\n"));
  (await driver.reset());
  const off = await ask("Which weekday brings the most revenue?", "en", "new");
  const ref = off.find((e) => e.event === "refusal")?.data as { code: string; body: { en: string } } | undefined;
  check("without a model: a weekday question says a model could answer it", ref?.code === "planner_unknown" && ref.body.en.startsWith("This is outside the metric set. With a model added, an exploratory answer is possible."), ref);
  check("without a model: exploratory is off", (await driver.state()).agent.exploratory === false);
  const offTr = (await ask("Hangi hafta günü en çok ciro getiriyor?", "tr", "new")).find((e) => e.event === "refusal")?.data as { code: string } | undefined;
  check("without a model: the Turkish weekday question gets the same refusal", offTr?.code === "planner_unknown", offTr);
  if (!(await driver.simulateModelKey(true))) skip("exploratory answers with a model");
  else {
  check("simulated key: a model is set and exploratory is on", (await driver.state()).agent.mode === "model" && (await driver.state()).agent.exploratory === true);
  const sug = (await driver.act("list_suggestions", {}, "en"));
  check("with a model: four exploratory chips and one across the demo shop's tables on Ask", sug.filter((x) => x.tag === "exploratory").length === 5 && sug.some((x) => x.text.en === "Which product categories are returned most often?"));
  const qs = ["Which weekday brings the most revenue?", "Revenue by channel and device in the last 28 days", "Average order value by device by week", "Which channel’s ad spend grew most this month?", "Sessions by weekday"];
  const shapes: string[] = [];
  let explore: import("../src/api/types").Answer | undefined;
  for (const q of qs) {
    const a = answerOf(await ask(q, "en", "new"))?.answer;
    shapes.push(a ? `${a.kind}:${a.explore?.shape}:${a.explore?.rows.length}` : "none");
    if (a?.kind === "explore" && a.check === null && !explore) explore = a;
    if (a && (a.check || a.metrics.length)) shapes.push("HAS CHECK OR DEFINITION");
  }
  check("exploratory answers from the mart: category, table, table, category, category; no check, no definition", shapes.join(",") === "explore:category:7,explore:table:12,explore:table:28,explore:category:3,explore:category:7", shapes);
  // The weekday totals are sums of the real mart rows.
  const total = (explore!.explore!.rows as [string, number][]).reduce((s, r) => s + r[1], 0);
  const direct = (await driver.act("run_query", { metric: "revenue", group_by: "none", from: explore!.explore!.spec.from, to: explore!.explore!.spec.to }, "en")).total!;
  check("weekday revenue adds up to the same period's revenue metric", Math.abs(total - direct) < 0.5, { total, direct });
  check("exploratory follow-ups offer Turn this into a metric", explore!.followups.some((x) => x.en === "Turn this into a metric"));
  const qc = createQueryClient();
  qc.setQueryData(keys.state(), (await driver.state()));
  const html = renderToString(
    <QueryClientProvider client={qc}>
      <LanguageProvider lang="en">
        <TooltipProvider>
          <MemoryRouter>
            <AnswerCard answer={explore!} />
          </MemoryRouter>
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
  check("exploratory badge shown, no verdict, SQL written by the model", html.includes("Exploratory · not checked") && html.includes("Written by the model") && !/adds up|does not add up/.test(html), html.slice(0, 200));
  // Across tables: refused while only the mart is on the list; answered, with the tables it read, once the shop tables are.
  const cross = "Which product categories are returned most often?";
  const crossOff = (await ask(cross, "en", "new")).find((e) => e.event === "refusal")?.data as { code: string; body: { en: string } } | undefined;
  check("cross-table question with only the mart allowed: refused, pointing at Settings › Sources", crossOff?.code === "explore_failed" && /Settings › Sources/.test(crossOff.body.en), crossOff);
  const allowed = await driver.act("set_explore_tables", { allow: [{ project: null, dataset: "demo", table: null }] }, "en");
  check("set_explore_tables adds the demo shop tables", allowed.data_source.explore.allow.length === 1 && allowed.data_source.explore.allow[0]!.table === null);
  const described = await driver.act("describe_tables", {}, "en");
  check("describe_tables lists the mart and the four shop tables, customer_id proposed as protected", described.tables.length === 5 && described.tables.find((x) => x.table === "orders")?.protected_columns.includes("customer_id") === true);
  const crossA = answerOf(await ask(cross, "en", "new"))?.answer;
  check("cross-table answer: exploratory, by category, lists the tables it read", crossA?.kind === "explore" && crossA.explore?.shape === "category" && (crossA.explore?.tables ?? []).includes("returns"), crossA?.explore?.tables);
  const crossHtml = renderToString(
    <QueryClientProvider client={qc}>
      <LanguageProvider lang="en">
        <TooltipProvider>
          <MemoryRouter>
            <AnswerCard answer={crossA!} />
          </MemoryRouter>
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
  check("the answer card names the tables read under the SQL", crossHtml.includes("Tables read: ") && crossHtml.includes("order_items"), crossHtml.slice(0, 200));
  await driver.act("set_explore_tables", { allow: [] }, "en");
  const trShapes: string[] = [];
  for (const q of ["Hangi hafta günü en çok ciro getiriyor?", "Son 28 günde kanal ve cihaza göre ciro", "Haftalık, cihaza göre sepet ortalaması", "Bu ay hangi kanalın reklam harcaması en çok arttı?"]) {
    const a = answerOf(await ask(q, "tr", "new"))?.answer;
    trShapes.push(a ? `${a.kind}:${a.explore?.shape}` : "none");
  }
  check("Turkish exploratory chips map to the same queries", trShapes.join(",") === "explore:category,explore:table,explore:table,explore:category", trShapes);
  const failed = await ask("Which products sell most?", "en", "new");
  check("with a model: a question the mart cannot hold gets the columns card", (failed.find((e) => e.event === "refusal")?.data as { code: string })?.code === "explore_failed");
  const pin = (await driver.act("pin_answer", { answer_id: explore!.id }, "en"));
  const dash = (await driver.act("get_dashboard", { dashboard_id: pin.tile.dashboard_id }, "en"));
  const tile = dash.tiles.find((x) => x.tile_id === pin.tile.id);
  check("a pinned exploratory answer is an exploratory tile with no verdict", pin.tile.query.type === "explore" && !!tile?.explore && !tile.check);
  (await driver.act("set_preference", { key: "exploratory", value: "off" }, "en"));
  const offAgain = await ask("Which weekday brings the most revenue?", "en", "new");
  check("switch off: back to the planner's answer", !answerOf(offAgain) || answerOf(offAgain)!.answer.kind !== "explore");
  }
  (await driver.reset());
}

// ---------------------------------------------------------------- owner round 5: metrics page, events, audits
{
  (await driver.reset());
  const evs = (await driver.state()).events;
  const need = ["ev_v412", "ev_sale"];
  const has = (keys: string[], grain: "day" | "week" | "month" = "day") => {
    const ids = groupEvents(evs, keys, grain).flatMap((g) => g.events.map((e) => e.id));
    return need.every((id) => ids.includes(id));
  };
  const surfaces: Record<string, boolean> = {};
  const rev = answerOf(await ask("Revenue by day in the last 28 days", "en", "new"))!.answer;
  surfaces["answer: revenue by day"] = has(rev.query.rows.map((r) => r.key));
  check("a revenue answer over 10–13 Oct names the Autumn sale", rev.sentence.en.includes("Autumn sale starts") && rev.sentence.tr.includes("Sonbahar indirimi"), rev.sentence.en);
  const ga4a = answerOf(await ask("Do GA4 purchases match orders in the last 14 days?", "en", "new"))!.answer;
  surfaces["answer: GA4 tracking check"] = has(ga4a.check!.series!.map((p) => p.date));
  const dash = (await driver.act("get_dashboard", { dashboard_id: "db_example" }, "en"));
  surfaces["tile: revenue by day"] = has(dash.tiles.find((x) => x.tile_id === "pin_rev_day")!.query!.rows.map((r) => r.key));
  const sheet = (await driver.act("get_check", { check: "ga4_vs_orders", from: dash.from, to: dash.to }, "en"));
  surfaces["check sheet: GA4"] = has(sheet.result.series!.map((p) => p.date));
  const mp = (await driver.act("get_metric", { metric: "orders" }, "en"));
  surfaces["metric page: orders"] = has(mp.series!.rows.map((r) => r.key));
  const wk = (await driver.act("run_query", { metric: "revenue", group_by: "week", from: "2026-09-28", to: "2026-10-18" }, "en"));
  surfaces["weekly revenue"] = has(wk.rows.map((r) => r.key), "week");
  check("every time chart over 9–13 Oct shows the v4.12 and Autumn sale markers", Object.values(surfaces).every(Boolean), surfaces);
  check("metrics page: 11 pack metrics, Orders used by three tracking checks, v3 history", (await driver.act("list_metric_entries", {}, "en")).length === 11 && mp.checks.length === 3 && mp.history[0]!.version === 3 && mp.history[0]!.change.en.startsWith("Cancelled orders no longer excluded"));
  // A proposed metric from an exploratory answer, accepted, stays not checked.
  if (!(await driver.simulateModelKey(true))) skip("a metric proposed from an exploratory answer");
  else {
  const ex = await ask("Which weekday brings the most revenue?", "en", "new");
  const conv = (ex.find((e) => e.event === "turn")!.data as { conversation_id: string }).conversation_id;
  const prop = (await ask("Turn this into a metric", "en", conv)).find((e) => e.event === "refusal")?.data as { code: string; metric_id?: string } | undefined;
  check("Turn this into a metric proposes a metric on the Metrics page", prop?.code === "metric_proposed" && !!prop.metric_id, prop);
  (await driver.act("decide_metric", { metric: prop!.metric_id!, accept: true }, "en"));
  const accepted = (await driver.act("list_metric_entries", {}, "en")).find((e) => e.id === prop!.metric_id);
  const accPage = (await driver.act("get_metric", { metric: prop!.metric_id! }, "en"));
  check("an accepted proposal is in the list as accepted and not checked, with its history and an Activity row", accepted?.status === "accepted" && accepted.checks.length === 0 && accPage.history[0]!.change.en.startsWith("Accepted from an exploratory answer") && (await driver.state()).activity.some((a) => a.action === "decide_metric"));
  }
  // The audit from a failing tracking check ends with the finding linked on the check sheet.
  const run = (await driver.act("start_tracking_audit", { check: "ga4_vs_orders", url: "ornekmoda.example", device: "mobile_safari", platforms: ["ga4", "meta"] }, "en"));
  const thankYou = run.steps[run.steps.length - 1]!;
  check("the audit finds purchase missing on the thank-you page", !run.result.ok && thankYou.hits.some((h) => h.platform === "ga4" && h.event === "purchase" && h.status === "missing") && thankYou.hits.some((h) => h.platform === "meta" && h.status === "sent"));
  const after = (await driver.act("get_check", { check: "ga4_vs_orders", from: dash.from, to: dash.to }, "en"));
  check("the finding on the check sheet links the audit", after.result.findings[0]?.confirmed?.audit_id === run.id && (await driver.state()).activity.some((a) => a.action === "start_tracking_audit"));
  if (!(await driver.simulateAuditFix(true))) skip("the audit after the simulated fix");
  else {
    const again = (await driver.act("start_tracking_audit", { check: "ga4_vs_orders", url: "ornekmoda.example", device: "mobile_safari", platforms: ["ga4"] }, "en"));
    check("after the simulated fix the audit passes", again.result.ok && again.fixed);
  }
  // Events: add, delete with Undo (the GTM import is gone; events are added by hand or proposed by the agent).
  const added = (await driver.act("save_event", { event: { date: "2026-10-20", title: { en: "Test", tr: "Test" }, type: "other", note: null } }, "en"));
  const del = (await driver.act("delete_event", { id: added.event.id }, "en"));
  (await driver.act("undo", { activity_id: del.activity_id }, "en"));
  check("events: add, delete with Undo", (await driver.state()).events.some((e) => e.id === added.event.id));
  let gtmGone = false;
  try {
    await driver.act("import_gtm_events" as never, {} as never, "en");
  } catch (err) {
    gtmGone = (err as { code?: string }).code === "unknown_action" || (err as { status?: number }).status === 404;
  }
  check("the GTM import action is gone", gtmGone);

  // Sources: the connectors, the waitlist, and the orders file flow (simulated in the fixtures build).
  if (HTTP) {
    if (!driver.noCloud) skip("connector tests (start the server with --no-cloud)");
    else {
      let refused = "";
      let local: Awaited<ReturnType<typeof driver.act<"test_ga4">>> | null = null;
      try {
        local = await driver.act("test_ga4", { property_id: "123456789", auth: { kind: "adc" } }, "en");
      } catch (err) {
        refused = (err as { code?: string }).code ?? "";
      }
      check("no-cloud server: the GA4 test is refused (no_cloud) or stops at local credentials", refused === "no_cloud" || (!!local && local.steps[0]?.status === "failed" && local.steps.slice(1).every((x) => x.status === "skipped")), refused || local?.steps[0]);
      let shop = "";
      try {
        const r = await driver.act("test_shopify", { shop: "ornek-moda.myshopify.com", token: "shpat_smoke" }, "en");
        shop = r.steps.find((x) => x.status === "failed")?.error?.code ?? "passed";
      } catch (err) {
        shop = (err as { code?: string }).code ?? "";
      }
      check("no-cloud server: the Shopify test makes no call (no_cloud)", shop === "no_cloud", shop);
    }
    const st = await driver.state();
    check("state lists the four connectors and the seven waitlist items", st.connectors.length === 4 && st.waitlist.length === 7, { connectors: st.connectors.length, waitlist: st.waitlist.length });
  } else {
    const st0 = await driver.state();
    check("Sources: four connectors, all not connected; seven waitlist items", st0.connectors.map((c) => `${c.id}:${c.status}`).join(",") === "ga4:not_connected,orders_file:not_connected,shopify:not_connected,woocommerce:not_connected" && st0.waitlist.length === 7);
    check("waitlist: each a mailto to hello@analitikisler.com with the Cloud waitlist subject", st0.waitlist.every((w) => w.mailto.startsWith("mailto:hello@analitikisler.com?subject=") && decodeURIComponent(w.mailto.split("subject=")[1]!) === `ai cloud waitlist: ${w.name.en}`), st0.waitlist[0]);
    const badGa4 = await driver.act("test_ga4", { property_id: "G-ABC123", auth: { kind: "adc" } }, "en");
    check("GA4 test: a measurement id instead of a property id fails at step 2 with property_not_found", !badGa4.ok && badGa4.steps[1]?.error?.code === "property_not_found" && badGa4.steps.slice(2).every((x) => x.status === "skipped"));
    const ga4 = await driver.act("test_ga4", { property_id: "412345678", auth: { kind: "adc" } }, "en");
    check("GA4 test passes six steps", ga4.ok && ga4.steps.length === 6);
    const conn = await driver.act("connect_ga4", { test_id: ga4.test_id, history_days: 90 }, "en");
    const st1 = await driver.state();
    check("GA4 connected over 90 days; the active source becomes the shop's", conn.status === "connected" && conn.last_sync?.days === 90 && st1.source.kind === "local", { conn, kind: st1.source.kind });
    const write = await driver.act("test_shopify", { shop: "ornek-moda.myshopify.com", token: "shpat_write_x" }, "en");
    check("Shopify test: a write scope is refused with scope_write", !write.ok && write.steps[1]?.error?.code === "scope_write");
    const host = await driver.act("test_woocommerce", { url: "http://192.168.1.4", key: "ck_x", secret: "cs_x" }, "en");
    check("WooCommerce test: a private http address is refused with host_not_allowed", !host.ok && host.steps[0]?.error?.code === "host_not_allowed");
    // The orders mapping flow on the sample export (Turkish ikas-style headers).
    const mock = await import("../src/api/mock/server");
    const up = mock.uploadOrders("ornek-moda-siparisler.csv", "csv", mock.sampleOrdersFile(), 50_000);
    const m = up.mapping;
    check("orders file: the mapping is guessed from Turkish headers", m.created_at === "Sipariş Tarihi" && m.total === "Toplam Tutar" && m.status === "Sipariş Durumu" && m.channel === "Kaynak" && m.device === "Cihaz" && m.currency === "Para Birimi", m);
    check("orders file: only test orders are left out by default, cancelled ones are counted", m.exclude_statuses.join(",") === "Test Siparişi" && up.statuses.some((x) => x.value === "İptal Edildi"), m.exclude_statuses);
    const testCount = up.statuses.find((x) => x.value === "Test Siparişi")?.count ?? 0;
    check("orders file: the preview holds daily totals over 60 days, the test orders counted as left out", up.preview.days === 60 && up.preview.daily.length === 60 && up.preview.excluded.status === testCount && up.preview.orders > 0 && up.preview.devices.some((d) => d.key === "mobile"), { days: up.preview.days, excluded: up.preview.excluded });
    const cancelled = up.statuses.find((x) => x.value === "İptal Edildi")?.count ?? 0;
    const narrower = await driver.act("preview_orders_file", { upload_id: up.upload_id, mapping: { ...m, exclude_statuses: [...m.exclude_statuses, "İptal Edildi"] } }, "en");
    check("orders file: leaving cancelled orders out too lowers the count by exactly those", narrower.preview.orders === up.preview.orders - cancelled && narrower.preview.excluded.status === testCount + cancelled);
    let bad = "";
    try {
      await driver.act("preview_orders_file", { upload_id: up.upload_id, mapping: { ...m, total: "No such column" } }, "en");
    } catch (err) {
      bad = (err as { code?: string }).code ?? "";
    }
    check("orders file: a mapping to a missing column is refused with mapping_invalid", bad === "mapping_invalid", bad);
    const imported = await driver.act("import_orders_file", { upload_id: up.upload_id, mapping: m, time_zone: "Europe/Istanbul" }, "en");
    check("orders file imported: connected with its range", imported.status === "connected" && imported.last_sync?.days === 60);
    let gone = "";
    try {
      await driver.act("preview_orders_file", { upload_id: up.upload_id }, "en");
    } catch (err) {
      gone = (err as { code?: string }).code ?? "";
    }
    check("orders file: the upload is forgotten after the import", gone === "upload_not_found", gone);
    (await driver.act("disconnect_source", { connector: "ga4" }, "en"));
    const st2 = await driver.state();
    check("disconnecting GA4 keeps the shop's data active while the file is connected", st2.source.kind === "local" && st2.connectors.find((c) => c.id === "ga4")?.status === "not_connected");
    (await driver.act("save_data_source", { kind: "demo" }, "en"));
    check("one action back to demo data", (await driver.state()).source.kind === "demo");
  }
  (await driver.reset());
}

if (process.env.WRITE_HANDMADE) {
  (await driver.reset());
  const { mkdir, writeFile } = await import("node:fs/promises");
  const dir = new URL("../src/api/fixtures/handmade/", import.meta.url);
  await mkdir(dir, { recursive: true });
  (await driver.reset());
  const cases: [string, Lang, string, string?][] = [
    ["mobile-follow-up.en", "en", "Is the gap only on mobile?", "Do GA4 purchases match orders in the last 14 days?"],
    ["mobile-follow-up.tr", "tr", "Fark yalnızca mobilde mi?", "Son 14 günde GA4 satın almaları siparişlerle tutuyor mu?"],
    ["why.en", "en", "Why do GA4 purchases not match back-office orders for 9–22 Oct?"],
    ["yesterday.en", "en", "How many orders did we get yesterday?"],
    ["yesterday.tr", "tr", "Dün kaç sipariş geldi?"],
    ["last-week.en", "en", "Revenue last week against the week before"],
    ["last-week.tr", "tr", "Geçen hafta ciro, bir önceki haftaya göre"],
    ["revenue-by-channel.en", "en", "Which channel brings the most revenue?"],
    ["revenue-by-channel.tr", "tr", "Hangi kanal daha çok ciro getiriyor?"],
    ["mobile-converting.en", "en", "Is mobile converting worse than desktop?"],
    ["ad-spend-this-month.tr", "tr", "Bu ay reklama ne kadar harcandı?"],
    ["refusal-unknown.en", "en", "Compare email and Google Ads last month"],
    ["refusal-not-in-data.en", "en", "Which products sell most?"],
    ["watch-proposal.en", "en", "Watch the Meta tracking check"],
  ];
  for (const [name, lang, q, before] of cases) {
    let conv: string | undefined = "new";
    if (before) {
      const first = await ask(before, lang, "new");
      conv = (first.find((e) => e.event === "turn")?.data as { conversation_id: string }).conversation_id;
    }
    const events = await ask(q, lang, conv);
    await writeFile(new URL(`${name}.json`, dir), JSON.stringify({ handmade: true, question: q, lang, after: before ?? null, events }, null, 2) + "\n");
  }
  console.log(`wrote ${cases.length} handmade fixtures`);
}

// Real-connector codes: api_disabled with its console link (only console.cloud.google.com), property_api_denied.
{
  const { connErrText, enableLink } = await import("../src/components/settings/Connectors");
  const enCopy = (await import("../src/i18n/en")).en;
  const trCopy = (await import("../src/i18n/tr")).tr;
  const dis = { code: "api_disabled", params: { service: "Google Analytics Data API", project: "my-project", link: "https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com?project=my-project" } };
  check("api_disabled: the sentence names the service and the project, en and tr", connErrText(enCopy, dis) === "Google Analytics Data API is not enabled in the Google Cloud project that signs in (my-project). Enable it, wait a minute, then test again." && connErrText(trCopy, dis).startsWith("Google Analytics Data API, oturum açan Google Cloud projesinde (my-project) etkin değil."), connErrText(enCopy, dis));
  check("api_disabled: the Enable it link only for a console.cloud.google.com address", enableLink(dis) === dis.params.link && enableLink({ ...dis, params: { ...dis.params, link: "https://evil.example/console.cloud.google.com/" } }) === null);
  check("property_api_denied has its own sentence, en and tr", connErrText(enCopy, { code: "property_api_denied" }).startsWith("Google does not allow this property") && connErrText(trCopy, { code: "property_api_denied" }).includes("Google’ın demo mülkleri"));
  // A number answer with no data for the period: the words, no value, no 0.
  const num = answerOf(await ask("How many orders did we get yesterday?", "en", "new"))?.answer;
  if (num) {
    const qcN = createQueryClient();
    qcN.setQueryData(keys.state(), await driver.state());
    const empty = { ...num, query: { ...num.query, total: null, comparison: null } };
    const html = renderToString(
      <QueryClientProvider client={qcN}>
        <LanguageProvider lang="en">
          <TooltipProvider>
            <MemoryRouter>
              <AnswerCard answer={empty} />
            </MemoryRouter>
          </TooltipProvider>
        </LanguageProvider>
      </QueryClientProvider>,
    );
    check("a number answer whose total is null says No data for this period", num.kind === "number" && html.includes("No data for this period") && !/>0<\/span>/.test(html), num.kind);
  } else skip("number answer with no data");
}

// A source with no device split (all unknown): the check runs on totals and says so instead of a device table.
{
  const st = await driver.state();
  const base = st.checks[0];
  if (base) {
    const html = renderToString(
      <LanguageProvider lang="en">
        <CheckBars result={{ ...base, breakdown: [], breakdown_available: false }} />
      </LanguageProvider>,
    );
    check("a check without a device split says No device split from this source", html.includes("No device split from this source"), html.slice(0, 200));
  }
  const tr = (await import("../src/i18n/tr")).tr;
  const en = (await import("../src/i18n/en")).en;
  check("labels for the other and unknown channel and the unknown device, en and tr", !!en.dimensions.channel.other && !!en.dimensions.channel.unknown && !!en.dimensions.device.unknown && !!tr.dimensions.channel.unknown && !!tr.dimensions.device.unknown);
}

// A model turn that ends in text only (no card), as it comes back after a reload: the reply is the text, with its
// bold and list rendered, no HTML from the model; the tokens show only in the steps trace; no_answer has its copy.
{
  const qc2 = createQueryClient();
  qc2.setQueryData(keys.state(), await driver.state());
  const stored = {
    id: "turn_text_only", conversation_id: "conv_text_only", question: "What should I look at first?", question_text: null, lang: "en" as const, context: null,
    steps: [{ tool: "list_metrics", summary: { en: "Read the metric list", tr: "Metrik listesi okundu" }, ok: true }],
    answers: [], approvals: [], refusal: null,
    text: { en: "Start with **GA4 purchases**.\n- the gap is on mobile\n- <b>it began</b> on 9 Oct", tr: "Önce **GA4 satın almaları**." },
    usage: { provider: "anthropic" as const, model: "claude-opus-5-5", rounds: 2, input: 41200, output: 2100, cache_read: 38000, cache_write: 0 },
    error: null, created_by: "agent" as const, status: "done" as const, seconds: 2.4, created_at: "2026-10-25T09:00:00.000Z",
  };
  const view = (turn: typeof stored | (typeof stored & { status: "error"; error: { code: string } })) =>
    renderToString(
      <QueryClientProvider client={qc2}>
        <LanguageProvider lang="en">
          <TooltipProvider>
            <MemoryRouter>
              <MessageScrollerProvider>
                <MessageScroller>
                  <MessageScrollerViewport>
                    <MessageScrollerContent>
                      <TurnView turn={turn as never} last actions={{ onAsk: () => {} }} />
                    </MessageScrollerContent>
                  </MessageScrollerViewport>
                </MessageScroller>
              </MessageScrollerProvider>
            </MemoryRouter>
          </TooltipProvider>
        </LanguageProvider>
      </QueryClientProvider>,
    );
  const html = view(stored);
  check(
    "a text-only model turn renders its text after reload: bold, a list, no model HTML, no tokens in the reply",
    html.includes("<strong") && html.includes("GA4 purchases</strong>") && (html.match(/<li/g) ?? []).length >= 2 && !html.includes("<b>it began") && !html.includes("41,200 tokens"),
    html.slice(0, 300),
  );
  const failed = view({ ...stored, text: null, status: "error", error: { code: "no_answer" } });
  check("a no_answer turn says no answer came back", failed.includes("No answer came back. Nothing was changed."), failed.slice(0, 300));
}

(await driver.reset());
if (!HTTP) await renderSmoke(check);
else skip("render every route (needs the in-process mock)");
console.log(failures ? `\n${failures} failed${skipped ? `, ${skipped} skipped` : ""}` : `\nall passed${skipped ? `, ${skipped} skipped` : ""}`);
process.exit(failures ? 1 : 0);
