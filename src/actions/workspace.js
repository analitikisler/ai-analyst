// Conversations, proposals (what the agent asks a person to approve), undo, and preferences.
import { z } from "zod";
import { findTile, getDashboard, insertDashboard, lastDashboardId, listDashboards, removeDashboard, saveDashboard, tileFromAnswer, touch } from "../dashboards.js";
import { AppError } from "../errors.js";
import { preferences } from "../settings.js";
import { newId } from "../store/store.js";
import { ACT } from "../text.js";
import { addWatch } from "./data.js";
import { defineAction } from "./registry.js";

export const conversationSummary = (store, c) => ({ id: c.id, title: c.title ?? "", title_text: c.title_text ?? null, created_at: c.created_at, updated_at: c.updated_at, turns: store.listTurns(c.id).length });

defineAction({
  name: "list_conversations",
  description: "The conversations on Ask, newest first.",
  kind: "read",
  mcp: false,
  input: z.object({}).strict(),
  run: (ctx) => ctx.store.listConversations().map((c) => conversationSummary(ctx.store, c)),
});

defineAction({
  name: "get_conversation",
  description: "One conversation with its turns.",
  kind: "read",
  mcp: false,
  input: z.object({ conversation_id: z.string().min(1).max(64) }).strict(),
  run(ctx, { conversation_id }) {
    const c = ctx.store.getConversation(conversation_id);
    if (!c) throw new AppError("not_found", "This conversation is not here any more.");
    return { ...conversationSummary(ctx.store, c), turn_list: ctx.store.listTurns(c.id).map((t) => ctx.store.hydrateTurn(t)) };
  },
});

/** Pins an answer to a dashboard (or returns the tile it already is). */
export function pinAnswer(ctx, answer_id, dashboard_id, actor = "person") {
  const a = ctx.store.getAnswer(answer_id);
  if (!a) throw new AppError("not_found", `Unknown answer "${answer_id}".`);
  const dash = getDashboard(ctx.store, dashboard_id ?? lastDashboardId(ctx.store));
  const existing = dash.tiles.find((t) => t.answer_id === answer_id);
  if (existing) {
    const act = ctx.store.listActivity(200).find((x) => x.undo?.type === "tile_add" && ctx.store.getUndo(x.id)?.tile_id === existing.id);
    return { tile: existing, activity_id: act?.id ?? "" };
  }
  const tile = tileFromAnswer(ctx.pack, a, dash.id, actor === "agent" ? "agent" : "person");
  dash.tiles.push(tile);
  touch(dash);
  saveDashboard(ctx.store, dash);
  const act = ctx.store.logActivity({ actor, action: "pin_answer", detail: ACT.pinned(tile.title, dash.name), undo: { kind: "tile_add", tile_id: tile.id } });
  return { tile, activity_id: act.id };
}

defineAction({
  name: "decide_proposal",
  description: "Approves or declines what the agent proposed (a watch, a pin, an event).",
  kind: "write",
  input: z.object({ proposal_id: z.string().min(1).max(64), approve: z.boolean(), where: z.enum(["ask", "activity"]) }).strict(),
  run(ctx, { proposal_id, approve, where }) {
    const p = ctx.store.get("proposals", proposal_id);
    if (!p) throw new AppError("not_found", "Unknown proposal.");
    if (p.status !== "pending") throw new AppError("not_pending", "This was already decided.");
    const next = { ...p, status: approve ? "approved" : "declined", decided_at: new Date().toISOString(), decided_in: where };
    if (approve) {
      if (p.kind === "watch" && p.payload.check) addWatch(ctx, p.payload.check, "agent");
      if (p.kind === "pin" && p.payload.answer_id) pinAnswer(ctx, p.payload.answer_id, p.payload.dashboard_id, "person");
      if (p.kind === "event" && p.payload.event) {
        const ev = ctx.store.put("events", { ...p.payload.event, id: newId("ev"), source: "agent" });
        ctx.log(ACT.event_added(ev.title), { kind: "event_add", event_id: ev.id }, { action: "save_event" });
      }
    }
    ctx.store.put("proposals", next);
    ctx.log(approve ? ACT.approved(p.title) : ACT.declined(p.title), null, { proposal_id: p.id });
    return next;
  },
});

/** Reverses one change. Throws undo_gone (and marks the entry) when what it changed was removed since. */
function applyUndo(ctx, entry, rec) {
  const { store } = ctx;
  const gone = () => {
    throw new AppError("undo_gone", "What it changed was removed since.");
  };
  const tileHome = (id) => listDashboards(store).find((d) => d.tiles.some((t) => t.id === id));
  switch (rec.kind) {
    case "tile_add": {
      const d = tileHome(rec.tile_id);
      if (!d) gone();
      d.tiles = d.tiles.filter((t) => t.id !== rec.tile_id);
      touch(d);
      return saveDashboard(store, d);
    }
    case "tile_update": {
      const d = tileHome(rec.tile.id);
      if (!d) gone();
      d.tiles = d.tiles.map((t) => (t.id === rec.tile.id ? rec.tile : t));
      touch(d);
      return saveDashboard(store, d);
    }
    case "tile_remove": {
      const d = store.get("dashboards", rec.tile.dashboard_id);
      if (!d) gone();
      d.tiles.splice(Math.min(rec.index, d.tiles.length), 0, rec.tile);
      touch(d);
      return saveDashboard(store, d);
    }
    case "tile_order": {
      const d = store.get("dashboards", rec.dashboard_id);
      if (!d) gone();
      const byId = new Map(d.tiles.map((t) => [t.id, t]));
      d.tiles = [...rec.order.map((id) => byId.get(id)).filter(Boolean), ...d.tiles.filter((t) => !rec.order.includes(t.id))];
      touch(d);
      return saveDashboard(store, d);
    }
    case "period": {
      const d = store.get("dashboards", rec.dashboard_id);
      if (!d) gone();
      Object.assign(d, { period: rec.period, compare: rec.compare });
      touch(d);
      return saveDashboard(store, d);
    }
    case "watch":
      if (!store.get("watches", rec.watch_id)) gone();
      return store.remove("watches", rec.watch_id);
    case "unwatch":
      return store.put("watches", rec.watch);
    case "dashboard_create":
      if (listDashboards(store).length <= 1 || !store.get("dashboards", rec.dashboard_id)) gone();
      return removeDashboard(store, rec.dashboard_id);
    case "dashboard_delete":
      return insertDashboard(store, rec.dashboard, rec.index);
    case "dashboard_rename": {
      const d = store.get("dashboards", rec.dashboard_id);
      if (!d) gone();
      d.name = rec.name;
      touch(d);
      return saveDashboard(store, d);
    }
    case "event_add":
      if (!store.get("events", rec.event_id)) gone();
      return store.remove("events", rec.event_id);
    case "event_update":
      if (!store.get("events", rec.event.id)) gone();
      return store.put("events", rec.event);
    case "event_delete":
      return store.put("events", rec.event);
    case "events_import":
      for (const id of rec.ids) store.remove("events", id);
      return null;
    default:
      throw new AppError("not_undoable", "Only changes with an undo can be undone.");
  }
}

defineAction({
  name: "undo",
  description: "Undoes a change from the activity log.",
  kind: "write",
  input: z.object({ activity_id: z.string().min(1).max(64) }).strict(),
  run(ctx, { activity_id }) {
    const entry = ctx.store.getActivity(activity_id);
    if (!entry) throw new AppError("not_found", "Unknown activity.");
    if (entry.undone) throw new AppError("already_undone", "This was already undone.");
    const rec = entry.undo ? ctx.store.getUndo(entry.id) : null;
    if (!rec) throw new AppError("not_undoable", "Only changes with an undo can be undone.");
    try {
      ctx.store.transaction(() => applyUndo(ctx, entry, rec));
    } catch (err) {
      // Marked outside the rolled-back transaction, so the Activity row can say Undo no longer applies.
      if (err.code === "undo_gone") ctx.store.saveActivity({ ...entry, undo_gone: true });
      throw err;
    }
    const updated = ctx.store.saveActivity({ ...entry, undone: true });
    ctx.log(ACT.undid(entry.detail));
    return { undone: true, activity: updated };
  },
});

defineAction({
  name: "set_preference",
  description: "Saves one preference: the Make it yours card, a dismissed note, or exploratory answers on or off.",
  kind: "write",
  input: z.discriminatedUnion("key", [
    z.object({ key: z.literal("make_it_yours"), value: z.enum(["shown", "hidden"]) }).strict(),
    z.object({ key: z.literal("not_now"), value: z.string().min(1).max(64) }).strict(),
    z.object({ key: z.literal("exploratory"), value: z.enum(["on", "off"]) }).strict(),
  ]),
  run(ctx, input) {
    const prefs = preferences(ctx.store);
    if (input.key === "not_now") {
      if (!prefs.not_now.includes(input.value)) prefs.not_now = [...prefs.not_now, input.value];
    } else prefs[input.key] = input.value;
    ctx.store.setMeta("preferences", prefs);
    return prefs;
  },
});

export { findTile };
