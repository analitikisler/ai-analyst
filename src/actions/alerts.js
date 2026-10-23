// Alerts and undo. An alert the agent creates waits for a person's approval.
import { z } from "zod";
import { AppError } from "../errors.js";
import { newId } from "../store/store.js";
import { defineAction } from "./registry.js";
import { T } from "./text.js";

defineAction({
  name: "create_alert",
  description:
    "Creates a scheduled alert on a check (or a metric). When the agent creates one it is pending until a person approves it. Use only when the person asks to be told about something or to watch it.",
  kind: "write",
  input: (pack) =>
    z
      .object({
        check: z.enum(Object.keys(pack.checks)).optional(),
        metric: z.enum(Object.keys(pack.metrics)).optional(),
        title: z.string().min(1).max(120),
        rule: z.string().max(200).optional().describe("When it fires. Default: when the check does not add up."),
        schedule: z.string().max(120).optional().describe("Default: every morning at 08:00."),
      })
      .strict()
      .refine((a) => a.check || a.metric, { message: "Name a check or a metric to watch." }),
  run(ctx, input) {
    const t = T[ctx.lang];
    const alert = ctx.store.saveAlert({
      id: newId("al"),
      check: input.check ?? null,
      metric: input.metric ?? null,
      title: input.title,
      rule: input.rule ?? (input.check ? t.rule_check : t.rule_metric),
      schedule: input.schedule ?? t.schedule,
      status: ctx.actor === "agent" ? "pending" : "active",
      created_by: ctx.actor,
      created_at: new Date().toISOString(),
    });
    if (ctx.actor === "agent" && ctx.turn) ctx.turn.approvals.push(alert.id);
    ctx.log(alert.title, { type: "alert", id: alert.id });
    return alert;
  },
  forModel: (a) => ({ alert_id: a.id, status: a.status, note: a.status === "pending" ? "A person must approve this alert before it runs." : undefined }),
  summary: (a) => `${a.id} · ${a.status}`,
});

defineAction({
  name: "decide_alert",
  description: "Approves or declines an alert the agent proposed.",
  kind: "write",
  agent: false,
  input: z.object({ alert_id: z.string(), approve: z.boolean() }).strict(),
  run(ctx, { alert_id, approve }) {
    const alert = ctx.store.getAlert(alert_id);
    if (!alert) throw new AppError("not_found", `Unknown alert_id "${alert_id}".`);
    if (alert.status !== "pending") throw new AppError("not_pending", "This alert is already active.");
    if (approve) {
      const updated = ctx.store.saveAlert({ ...alert, status: "active", decided_at: new Date().toISOString() });
      ctx.log(T[ctx.lang].approved(alert.title));
      return { approved: true, alert: updated };
    }
    ctx.store.removeAlert(alert_id);
    ctx.log(T[ctx.lang].declined(alert.title));
    return { approved: false, alert: null };
  },
});

defineAction({
  name: "remove_alert",
  description: "Removes an alert.",
  kind: "write",
  agent: false,
  input: z.object({ alert_id: z.string() }).strict(),
  run(ctx, { alert_id }) {
    const alert = ctx.store.getAlert(alert_id);
    if (!alert) throw new AppError("not_found", `Unknown alert_id "${alert_id}".`);
    ctx.store.removeAlert(alert_id);
    ctx.log(alert.title);
    return { removed: true, alert_id };
  },
});

defineAction({
  name: "undo",
  description: "Undoes a pin or an alert from the activity log.",
  kind: "write",
  agent: false,
  input: z.object({ activity_id: z.string() }).strict(),
  run(ctx, { activity_id }) {
    const entry = ctx.store.getActivity(activity_id);
    if (!entry) throw new AppError("not_found", `Unknown activity_id "${activity_id}".`);
    if (!entry.undo) throw new AppError("not_undoable", "Only pins and alerts can be undone.");
    if (entry.undone) throw new AppError("already_undone", "This was already undone.");
    if (entry.undo.type === "pin") ctx.store.removePin(entry.undo.id);
    else if (entry.undo.type === "alert") ctx.store.removeAlert(entry.undo.id);
    const updated = ctx.store.saveActivity({ ...entry, undone: true });
    ctx.log(`${entry.action} · ${entry.detail}`);
    return { undone: true, activity: updated };
  },
});
