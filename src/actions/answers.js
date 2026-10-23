// Answers and the dashboard: publish_answer (agent), pin_answer, unpin.
import { z } from "zod";
import { validateSentence } from "../agent/validate.js";
import { AppError } from "../errors.js";
import { newId } from "../store/store.js";
import { defineAction } from "./registry.js";
import { defaultTitle } from "./text.js";

// The model gets two chances to fix ungrounded numbers; the third attempt publishes, flagged.
export const MAX_FAILED_PUBLISHES = 2;

/** Builds and stores an Answer from a stored query and an optional stored check. */
export function createAnswer(ctx, { sentence, query, check = null, title = null, followups = [], question = null, createdBy, validation }) {
  const metric = ctx.pack.metrics[query.metric];
  const answer = {
    id: newId("ans"),
    turn_id: ctx.turn?.id ?? null,
    question: question ?? ctx.turn?.question ?? null,
    sentence,
    title: title || defaultTitle(metric, query, ctx.lang),
    followups,
    query,
    check,
    metric: { id: metric.id, label: metric.label, version: metric.version, description: metric.description, source: metric.source },
    validation: validation ?? validateSentence(sentence, { query, check }),
    created_by: createdBy ?? (ctx.mode === "planner" ? "planner" : "agent"),
    created_at: new Date().toISOString(),
  };
  return ctx.store.saveAnswer(answer);
}

defineAction({
  name: "publish_answer",
  description:
    "Shows the answer card to the person: your sentence, the chart of one query and, if you ran one, the check. Call it once per question, after the queries. Every number in the sentence must come from that query or check, rounded as written; if one does not, this fails and lists the numbers to fix. Returns answer_id for pin_answer and create_alert.",
  kind: "write",
  agent: true,
  person: false,
  input: z
    .object({
      sentence: z.string().min(1).max(600).describe("One or two short sentences in the person's language: the figure first, then what it is compared with."),
      query_id: z.string().describe("The query_id run_query returned."),
      check_id: z.string().optional().describe("The check_id reconcile returned, if you ran one."),
      title: z.string().max(80).optional().describe("A short tile title, under 50 characters."),
      followups: z.array(z.string().max(160)).max(3).optional().describe("Two or three follow-up questions in the person's language."),
    })
    .strict(),
  run(ctx, input) {
    const query = ctx.store.getQuery(input.query_id);
    if (!query) throw new AppError("not_found", `Unknown query_id "${input.query_id}". Run run_query first and pass the query_id it returned.`);
    const check = input.check_id ? ctx.store.getCheck(input.check_id) : null;
    if (input.check_id && !check) throw new AppError("not_found", `Unknown check_id "${input.check_id}". Pass the check_id reconcile returned.`);
    const validation = validateSentence(input.sentence, { query, check });
    if (!validation.ok && ctx.mode !== "planner") {
      const turn = ctx.turn ?? {};
      turn.failedPublishes = (turn.failedPublishes ?? 0) + 1;
      if (turn.failedPublishes <= MAX_FAILED_PUBLISHES) {
        throw new AppError(
          "ungrounded_numbers",
          `These numbers are not in query ${query.id}${check ? ` or check ${check.id}` : ""}: ${validation.unmatched.join(", ")}. Use only figures the tools returned, rounded as written, or run another query that returns them, then call publish_answer again.`,
          { unmatched: validation.unmatched },
        );
      }
    }
    const answer = createAnswer(ctx, { sentence: input.sentence, query, check, title: input.title, followups: input.followups ?? [], validation });
    if (ctx.turn) ctx.turn.answers.push(answer.id);
    ctx.log(answer.title);
    return answer;
  },
  forModel: (a) => ({ answer_id: a.id, title: a.title, validation: a.validation }),
  summary: (a) => `${a.id}${a.validation.ok ? "" : ` · unmatched ${a.validation.unmatched.join(", ")}`}`,
});

defineAction({
  name: "pin_answer",
  description: "Pins a published answer to the workspace dashboard. Use only when the person asks to pin or keep it. The person can undo it.",
  kind: "write",
  input: z.object({ answer_id: z.string(), title: z.string().max(80).optional() }).strict(),
  run(ctx, { answer_id, title }) {
    const answer = ctx.store.getAnswer(answer_id);
    if (!answer) throw new AppError("not_found", `Unknown answer_id "${answer_id}".`);
    const existing = ctx.store.pinForAnswer(answer_id);
    if (existing) return { ...existing, already: true };
    const pin = ctx.store.savePin({ id: newId("pin"), answer_id, title: title ?? null, created_by: ctx.actor, created_at: new Date().toISOString() });
    ctx.log(pin.title ?? answer.title, { type: "pin", id: pin.id });
    return { ...pin, answer };
  },
  forModel: (p) => ({ pin_id: p.id, answer_id: p.answer_id, already: Boolean(p.already) }),
  summary: (p) => `${p.answer_id} → ${p.id}`,
});

defineAction({
  name: "unpin",
  description: "Removes a tile from the dashboard.",
  kind: "write",
  agent: false,
  input: z.object({ pin_id: z.string() }).strict(),
  run(ctx, { pin_id }) {
    const pin = ctx.store.getPin(pin_id);
    if (!pin) throw new AppError("not_found", `Unknown pin_id "${pin_id}".`);
    ctx.store.removePin(pin_id);
    ctx.log(pin.title ?? pin.answer?.title ?? pin.answer_id);
    return { removed: true, pin_id };
  },
});
