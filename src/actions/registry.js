// One registry of actions. The UI calls them over HTTP as a person, the agent calls them as
// tools, the MCP server exposes the read ones. Who may call what is enforced here, once.
import { z } from "zod";
import { AppError } from "../errors.js";

/** @type {Map<string, ReturnType<typeof defineAction>>} */
export const registry = new Map();

/**
 * @param {{ name: string, description: string, input: import("zod").ZodType | ((pack: any) => import("zod").ZodType),
 *   kind: "read"|"write", agent: boolean, person: boolean, run: (ctx: object, input: any) => Promise<any>|any,
 *   forModel?: (result: any, lang: string) => any, summary?: (result: any, lang: string) => string }} def
 *   input: a zod schema, or a function of the pack when the schema lists pack ids (metric and check enums).
 *   forModel: what the model sees of the result (default: the result).
 *   summary: the one-line step shown in the turn.
 */
export function defineAction(def) {
  for (const k of ["name", "description", "input", "kind", "run"]) if (!def[k]) throw new Error(`Action ${def.name ?? "?"} needs ${k}.`);
  if (!/^[a-z_]+$/.test(def.name)) throw new Error(`Action name "${def.name}" must be lowercase with _.`);
  if (registry.has(def.name)) throw new Error(`Action "${def.name}" is defined twice.`);
  const action = { agent: true, person: true, ...def };
  registry.set(def.name, action);
  return action;
}

const schemaFor = (action, pack) => (typeof action.input === "function" ? action.input(pack) : action.input);

/** JSON Schema for an action's input, as a tool input_schema. */
export function inputJsonSchema(action, pack) {
  const { $schema, ...schema } = z.toJSONSchema(schemaFor(action, pack), { io: "input" });
  return schema;
}

/** The actions an actor may call. */
export function actionsFor(actor) {
  return [...registry.values()].filter((a) => (actor === "agent" ? a.agent : a.person));
}

/** Tool definitions for the Claude API. */
export function toolDefinitions(pack, { eager = false } = {}) {
  return actionsFor("agent").map((a) => ({
    name: a.name,
    description: a.description,
    input_schema: inputJsonSchema(a, pack),
    ...(eager ? { eager_input_streaming: true } : {}),
  }));
}

/**
 * Runs an action as ctx.actor. Writes record their own activity through ctx.log.
 * @param {string} name
 * @param {unknown} input
 * @param {{ actor: "person"|"agent", lang: "en"|"tr", store: any, warehouse: any, pack: any, turn?: any, mode?: string }} ctx
 */
export async function callAction(name, input, ctx) {
  const action = registry.get(name);
  if (!action) throw new AppError("unknown_action", `Unknown action "${name}".`);
  if (ctx.actor === "agent" && !action.agent) throw new AppError("forbidden", `${name} is for people only. Ask the person to do it.`);
  if (ctx.actor === "person" && !action.person) throw new AppError("forbidden", `${name} is for the agent only.`);
  const parsed = schemaFor(action, ctx.pack).safeParse(input ?? {});
  if (!parsed.success) throw new AppError("invalid_input", `Invalid input for ${name}:\n${z.prettifyError(parsed.error)}`);
  const log = (detail, undo = null) => ctx.store.logActivity({ actor: ctx.actor, action: name, detail, undo });
  return action.run({ ...ctx, lang: ctx.lang === "tr" ? "tr" : "en", log }, parsed.data);
}
