// The demo workspace's first view, made the way the prototype's seedWorkspace() made it:
// a check run, one answered question, and three pins (one by a person, two by the agent).
import { callAction } from "../actions/index.js";
import { createAnswer } from "../actions/answers.js";
import { runQuery, runReconcile } from "../actions/data.js";
import { runTurn } from "../agent/agent.js";
import { followupsFor, plannerSentence, SUGGEST } from "../agent/planner.js";
import { addDays } from "../format.js";
import { seedFindings } from "./seed.js";

const TITLES = {
  en: { revenue: "Weekly revenue · complete weeks", roas: "ROAS by channel · last 28 days", ga4: "GA4 check · last 14 days" },
  tr: { revenue: "Haftalık ciro · tam haftalar", roas: "Kanala göre ROAS · son 28 gün", ga4: "GA4 kontrolü · son 14 gün" },
};

/** Seeds once per app database. Returns true when it seeded. */
export async function seedWorkspace({ store, warehouse, pack, config }) {
  if (store.getMeta("seeded_at")) return false;
  seedFindings(store);
  const lang = config.language === "tr" ? "tr" : "en";
  const agent = { actor: "agent", lang, store, warehouse, pack, config, mode: "planner", turn: null };
  const person = { ...agent, actor: "person" };
  const range = await warehouse.range();
  const lastN = (n) => ({ from: addDays(range.to, -(n - 1)), to: range.to });

  await callAction("run_all_checks", { days: 14 }, agent);

  // The worked example, answered by the planner with the same tools as any question.
  const turn = await runTurn({ question: SUGGEST[lang][0], lang, store, warehouse, pack, config: { ...config, anthropicApiKey: null } });
  const ga4Answer = turn.answers[0];

  const roas = await runQuery(agent, { metric: "roas", group_by: "channel", ...lastN(28) });
  const roasAnswer = createAnswer(agent, { sentence: plannerSentence(pack, roas, null, lang), query: roas, question: SUGGEST[lang][1], followups: followupsFor(SUGGEST[lang][1], lang), createdBy: "planner" });

  const revenue = await runQuery(agent, { metric: "revenue", group_by: "week", ...lastN(90) });
  const revCheck = await runReconcile(agent, { check: "ga4_rev_vs_revenue", from: revenue.from, to: revenue.to });
  const revAnswer = createAnswer(agent, {
    sentence: plannerSentence(pack, revenue, revCheck, lang),
    query: revenue,
    check: revCheck,
    question: SUGGEST[lang][3],
    followups: followupsFor(SUGGEST[lang][3], lang),
    createdBy: "planner",
  });

  const titles = TITLES[lang];
  await callAction("pin_answer", { answer_id: revAnswer.id, title: titles.revenue }, person);
  await callAction("pin_answer", { answer_id: roasAnswer.id, title: titles.roas }, agent);
  if (ga4Answer) await callAction("pin_answer", { answer_id: ga4Answer.id, title: titles.ga4 }, agent);
  store.setMeta("seeded_at", new Date().toISOString());
  return true;
}
