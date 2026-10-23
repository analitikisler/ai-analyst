// The app database (node:sqlite, data/app.db). Each record is a JSON body plus the few
// columns it is looked up or ordered by. seq keeps insertion order when timestamps tie.
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const newId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const now = () => new Date().toISOString();

const TABLES = {
  queries: ["kind TEXT NOT NULL"], // kind: query | check (one reconcile result)
  check_runs: [],
  answers: ["turn_id TEXT"],
  pins: ["answer_id TEXT NOT NULL"],
  alerts: [],
  activity: [],
  conversations: [],
  turns: ["conversation_id TEXT NOT NULL"],
  findings: [],
  meta: [],
};

export class Store {
  /** @param {string} file a path, or ":memory:" */
  constructor(file) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
    for (const [name, cols] of Object.entries(TABLES)) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${name} (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, body TEXT NOT NULL${cols.map((c) => `, ${c}`).join("")})`);
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS turns_conversation ON turns (conversation_id, seq)");
    this.db.exec("CREATE INDEX IF NOT EXISTS pins_answer ON pins (answer_id)");
  }

  close() {
    this.db.close();
  }

  // --- generic -----------------------------------------------------------------

  #put(table, body, cols = {}) {
    const names = ["id", "created_at", "body", ...Object.keys(cols)];
    const created = body.created_at ?? body.at ?? body.ran_at ?? now();
    const sql = `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})
      ON CONFLICT(id) DO UPDATE SET body = excluded.body${Object.keys(cols).map((c) => `, ${c} = excluded.${c}`).join("")}`;
    this.db.prepare(sql).run(body.id, created, JSON.stringify(body), ...Object.values(cols));
    return body;
  }
  #get(table, id) {
    const row = this.db.prepare(`SELECT body FROM ${table} WHERE id = ?`).get(id);
    return row ? JSON.parse(row.body) : null;
  }
  #list(table, { where = "", args = [], limit = 1000, order = "DESC" } = {}) {
    const rows = this.db.prepare(`SELECT body FROM ${table} ${where ? `WHERE ${where}` : ""} ORDER BY seq ${order} LIMIT ?`).all(...args, limit);
    return rows.map((r) => JSON.parse(r.body));
  }
  #delete(table, id) {
    return this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0;
  }

  // --- meta --------------------------------------------------------------------

  getMeta(key) {
    return this.#get("meta", key)?.value ?? null;
  }
  setMeta(key, value) {
    this.#put("meta", { id: key, value });
  }

  // --- queries and checks --------------------------------------------------------

  saveQuery(q) {
    return this.#put("queries", q, { kind: "query" });
  }
  getQuery(id) {
    const q = this.#get("queries", id);
    return q && !q.check ? q : null;
  }
  saveCheck(c) {
    return this.#put("queries", c, { kind: "check" });
  }
  getCheck(id) {
    const c = this.#get("queries", id);
    return c?.check ? c : null;
  }
  saveCheckRun(run) {
    return this.#put("check_runs", run);
  }
  latestCheckRun() {
    return this.#list("check_runs", { limit: 1 })[0] ?? null;
  }

  // --- answers, pins -------------------------------------------------------------

  saveAnswer(a) {
    return this.#put("answers", a, { turn_id: a.turn_id ?? null });
  }
  getAnswer(id) {
    return this.#get("answers", id);
  }
  savePin(p) {
    return this.#put("pins", p, { answer_id: p.answer_id });
  }
  getPin(id) {
    return this.#hydratePin(this.#get("pins", id));
  }
  pinForAnswer(answerId) {
    return this.#hydratePin(this.#list("pins", { where: "answer_id = ?", args: [answerId], limit: 1 })[0] ?? null);
  }
  removePin(id) {
    return this.#delete("pins", id);
  }
  listPins() {
    return this.#list("pins").map((p) => this.#hydratePin(p));
  }
  #hydratePin(p) {
    return p ? { ...p, answer: this.getAnswer(p.answer_id) } : null;
  }

  // --- alerts --------------------------------------------------------------------

  saveAlert(a) {
    return this.#put("alerts", a);
  }
  getAlert(id) {
    return this.#get("alerts", id);
  }
  removeAlert(id) {
    return this.#delete("alerts", id);
  }
  listAlerts() {
    return this.#list("alerts");
  }

  // --- activity --------------------------------------------------------------------

  /** @param {{ actor: "person"|"agent", action: string, detail: string, undo?: { type: string, id: string }|null }} e */
  logActivity({ actor, action, detail, undo = null }) {
    return this.#put("activity", { id: newId("act"), at: now(), actor, action, detail, undo, undone: false });
  }
  getActivity(id) {
    return this.#get("activity", id);
  }
  saveActivity(e) {
    return this.#put("activity", e);
  }
  listActivity(limit = 100) {
    return this.#list("activity", { limit });
  }

  // --- conversations and turns --------------------------------------------------------

  createConversation() {
    return this.#put("conversations", { id: newId("conv"), created_at: now() });
  }
  getConversation(id) {
    return this.#get("conversations", id);
  }
  latestConversation() {
    return this.#list("conversations", { limit: 1 })[0] ?? null;
  }
  saveTurn(t) {
    return this.#put("turns", t, { conversation_id: t.conversation_id });
  }
  getTurn(id) {
    return this.#get("turns", id);
  }
  /** Oldest first. */
  listTurns(conversationId, limit = 1000) {
    return this.#list("turns", { where: "conversation_id = ?", args: [conversationId], limit, order: "DESC" }).reverse();
  }
  /** A turn as the API shows it: answers and approvals in full. Declined alerts drop out of approvals. */
  hydrateTurn(t) {
    if (!t) return null;
    return {
      ...t,
      answers: (t.answers ?? []).map((id) => this.getAnswer(id)).filter(Boolean),
      approvals: (t.approvals ?? []).map((id) => this.getAlert(id)).filter(Boolean),
    };
  }

  // --- findings ----------------------------------------------------------------------

  saveFinding(f) {
    return this.#put("findings", f);
  }
  findingsFor(checkId) {
    return this.#list("findings", { order: "ASC" }).filter((f) => (f.checks ?? []).includes(checkId));
  }
}
