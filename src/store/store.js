// The app database (node:sqlite, <data_dir>/app.db). Each record is a JSON body plus the few columns it is
// looked up or ordered by; seq keeps insertion order when timestamps tie. The MCP server (another process)
// opens the same file, so WAL and a busy timeout let both write.
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const newId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const now = () => new Date().toISOString();

const TABLES = {
  queries: ["kind TEXT NOT NULL"], // kind: query | check (one reconcile result)
  check_runs: [],
  answers: ["turn_id TEXT"],
  activity: [],
  undo: [], // id = the activity id the undo belongs to
  conversations: [],
  turns: ["conversation_id TEXT NOT NULL"],
  findings: [],
  meta: [],
  dashboards: [],
  proposals: [],
  watches: [],
  events: [],
  metric_proposals: [],
  audits: [],
  chat_calls: [],
  bq_tests: [],
};
const COLLECTIONS = new Set(Object.keys(TABLES));

export class Store {
  /** @param {string} file a path, or ":memory:" */
  constructor(file) {
    // The data dir holds conversations, figures and keys: only the person's own account may read it.
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.file = file;
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") chmodSync(file, 0o600);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
    for (const [name, cols] of Object.entries(TABLES)) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${name} (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, body TEXT NOT NULL${cols.map((c) => `, ${c}`).join("")})`);
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS turns_conversation ON turns (conversation_id, seq)");
  }

  close() {
    this.db.close();
  }

  /** Empties everything a workspace holds; keeps preferences (meta) when asked. */
  reset({ keepMeta = [] } = {}) {
    const kept = keepMeta.map((k) => [k, this.getMeta(k)]);
    for (const name of Object.keys(TABLES)) this.db.exec(`DELETE FROM ${name}`);
    for (const [k, v] of kept) if (v != null) this.setMeta(k, v);
  }

  // --- generic -----------------------------------------------------------------

  #table(t) {
    if (!COLLECTIONS.has(t)) throw new Error(`Unknown table ${t}`);
    return t;
  }
  put(table, body, cols = {}) {
    const names = ["id", "created_at", "body", ...Object.keys(cols)];
    const created = body.created_at ?? body.at ?? body.ran_at ?? now();
    const sql = `INSERT INTO ${this.#table(table)} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})
      ON CONFLICT(id) DO UPDATE SET body = excluded.body${Object.keys(cols).map((c) => `, ${c} = excluded.${c}`).join("")}`;
    this.db.prepare(sql).run(body.id, created, JSON.stringify(body), ...Object.values(cols));
    return body;
  }
  get(table, id) {
    const row = this.db.prepare(`SELECT body FROM ${this.#table(table)} WHERE id = ?`).get(id);
    return row ? JSON.parse(row.body) : null;
  }
  /** Newest first unless order is "ASC". */
  list(table, { where = "", args = [], limit = 1000, order = "DESC" } = {}) {
    const rows = this.db.prepare(`SELECT body FROM ${this.#table(table)} ${where ? `WHERE ${where}` : ""} ORDER BY seq ${order === "ASC" ? "ASC" : "DESC"} LIMIT ?`).all(...args, limit);
    return rows.map((r) => JSON.parse(r.body));
  }
  remove(table, id) {
    return this.db.prepare(`DELETE FROM ${this.#table(table)} WHERE id = ?`).run(id).changes > 0;
  }
  /** Runs fn in one transaction, so a multi-record write is all or nothing. */
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // --- meta --------------------------------------------------------------------

  getMeta(key) {
    return this.get("meta", key)?.value ?? null;
  }
  setMeta(key, value) {
    this.put("meta", { id: key, value });
  }

  // --- queries and checks --------------------------------------------------------

  saveQuery(q) {
    return this.put("queries", q, { kind: "query" });
  }
  getQuery(id) {
    const q = this.get("queries", id);
    return q && !q.check ? q : null;
  }
  saveCheck(c) {
    return this.put("queries", c, { kind: "check" });
  }
  getCheck(id) {
    const c = this.get("queries", id);
    return c?.check ? c : null;
  }
  saveCheckRun(run) {
    return this.put("check_runs", run);
  }
  latestCheckRun() {
    return this.list("check_runs", { limit: 1 })[0] ?? null;
  }
  listCheckRuns(limit = 20) {
    return this.list("check_runs", { limit });
  }

  // --- answers ---------------------------------------------------------------------

  saveAnswer(a) {
    return this.put("answers", a, { turn_id: a.turn_id ?? null });
  }
  getAnswer(id) {
    return this.get("answers", id);
  }

  // --- activity ----------------------------------------------------------------------

  /**
   * @param {{ actor: string, action: string, detail: {en: string, tr: string}, undo?: object|null, client?: string, proposal_id?: string }} e
   *   undo: the record that reverses this change; it is kept apart and the entry carries { type, id }.
   */
  logActivity({ actor, action, detail, undo = null, client, proposal_id }) {
    const id = newId("act");
    const entry = { id, at: now(), actor, ...(client ? { client } : {}), action, detail, undo: undo ? { type: undo.kind, id } : null, undone: false, ...(proposal_id ? { proposal_id } : {}) };
    if (undo) this.put("undo", { id, ...undo });
    return this.put("activity", entry);
  }
  getActivity(id) {
    return this.get("activity", id);
  }
  getUndo(id) {
    return this.get("undo", id);
  }
  saveActivity(e) {
    return this.put("activity", e);
  }
  listActivity(limit = 100) {
    return this.list("activity", { limit });
  }

  // --- conversations and turns --------------------------------------------------------

  saveConversation(c) {
    return this.put("conversations", c);
  }
  getConversation(id) {
    return this.get("conversations", id);
  }
  listConversations() {
    return this.list("conversations").sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  }
  saveTurn(t) {
    return this.put("turns", t, { conversation_id: t.conversation_id });
  }
  getTurn(id) {
    return this.get("turns", id);
  }
  /** Oldest first. */
  listTurns(conversationId, limit = 1000) {
    return this.list("turns", { where: "conversation_id = ?", args: [conversationId], limit }).reverse();
  }
  /** A turn as the API shows it: answers in full. */
  hydrateTurn(t) {
    if (!t) return null;
    const { failedPublishes, ...rest } = t;
    return { ...rest, answers: (t.answers ?? []).map((a) => (typeof a === "string" ? this.getAnswer(a) : a)).filter(Boolean) };
  }

  // --- findings ----------------------------------------------------------------------

  saveFinding(f) {
    return this.put("findings", f);
  }
  findingsFor(checkId) {
    return this.list("findings", { order: "ASC" }).filter((f) => (f.checks ?? []).includes(checkId));
  }
}
