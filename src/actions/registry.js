// One registry of actions. The web app calls them over HTTP as a person, the agent calls them as tools, the
// MCP server exposes the chat-app ones. Who may call what is enforced here, once.
import { z } from "zod";
import { AppError } from "../errors.js";

/** @type {Map<string, ReturnType<typeof defineAction>>} */
export const registry = new Map();

/**
 * @param {{ name: string, description: string, input: import("zod").ZodType | ((pack: any) => import("zod").ZodType),
 *   kind: "read"|"write", agent?: boolean, person?: boolean, mcp?: boolean, settings?: boolean,
 *   run: (ctx: object, input: any) => Promise<any>|any,
 *   forModel?: (result: any, lang: string) => any, summary?: (result: any, input: any) => {en: string, tr: string} }} def
 *   input: a zod schema, or a function of the pack when the schema lists pack ids (metric and check enums).
 *   agent: the model may call it as a tool (default false: a person's action unless said otherwise).
 *   mcp: a chat app may call it over MCP (default: read actions).
 *   settings: changes settings or reaches outside systems; refused unless the request comes from this machine.
 *   forModel: what the model sees of the result (default: the result).
 *   summary: the step shown in the turn, in both languages.
 */
export function defineAction(def) {
  for (const k of ["name", "description", "input", "kind", "run"]) if (!def[k]) throw new Error(`Action ${def.name ?? "?"} needs ${k}.`);
  if (!/^[a-z_]+$/.test(def.name)) throw new Error(`Action name "${def.name}" must be lowercase with _.`);
  if (registry.has(def.name)) throw new Error(`Action "${def.name}" is defined twice.`);
  const action = { agent: false, person: true, mcp: def.kind === "read" && def.agent !== false, settings: false, ...def };
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
  return [...registry.values()].filter((a) => (actor === "agent" ? a.agent : actor === "chat_app" ? a.mcp : a.person));
}

/** Tool definitions for the Claude API. */
export function toolDefinitions(pack, { eager = false, only } = {}) {
  return actionsFor("agent")
    .filter((a) => !only || only(a))
    .map((a) => ({
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
 * @param {{ actor: "person"|"agent"|"chat_app"|"system", lang: "en"|"tr", app: object, turn?: any, client?: string, loopback?: boolean }} ctx
 */
export async function callAction(name, input, ctx) {
  const action = registry.get(name);
  if (!action) throw new AppError("unknown_action", `Unknown action "${name}".`);
  if (ctx.actor === "agent" && !action.agent) throw new AppError("forbidden", `${name} is for people only. Ask the person to do it.`);
  if (ctx.actor === "chat_app" && !action.mcp) throw new AppError("forbidden", `${name} is not available to chat apps.`);
  if (ctx.actor === "person" && !action.person) throw new AppError("forbidden", `${name} is for the agent only.`);
  if (action.settings && ctx.loopback === false) throw new AppError("loopback_only", "Settings can only be changed from this machine.");
  const parsed = schemaFor(action, ctx.app.pack).safeParse(input ?? {});
  if (!parsed.success) throw new AppError("invalid_input", `Invalid input for ${name}:\n${z.prettifyError(parsed.error)}`);
  return action.run(contextFor(name, ctx), parsed.data);
}

/** The ctx an action runs with: the live app parts (they change when the data source changes) and log(). */
export function contextFor(name, ctx) {
  const app = ctx.app;
  const actor = ctx.actor;
  return {
    ...ctx,
    lang: ctx.lang === "tr" ? "tr" : "en",
    get store() {
      return app.store;
    },
    get warehouse() {
      return app.warehouse;
    },
    get pack() {
      return app.pack;
    },
    get config() {
      return app.config;
    },
    /** Logs this action to Activity. undo: the record that reverses it ({ kind, … }). */
    log(detail, undo = null, extra = {}) {
      return app.store.logActivity({ actor, action: extra.action ?? name, detail, undo, ...(ctx.client ? { client: ctx.client } : {}), ...(extra.proposal_id ? { proposal_id: extra.proposal_id } : {}) });
    },
  };
}
