// The guard for exploratory SQL: a model may write one read-only query against the tables the person allowed, and
// this decides, in code, whether it runs. It does not trust the prompt. It is the first of three fences: the
// warehouse checks again (BigQuery: every table the dry run reports must be on the list; DuckDB: the query runs in
// a database that holds nothing but copies of the allowed tables), so a gap here does not expose another table.
//
// The checks:
//   the query is read the way the warehouse reads it; anything whose reading could differ is refused: block
//   comments (DuckDB nests them, BigQuery does not), backslash escapes, prefixed, triple-quoted or $ strings, @;
//   one statement (a single trailing ; is allowed); it starts with SELECT or WITH;
//   no keyword that writes, loads, changes settings or names another statement form (TABLE, PIVOT) anywhere;
//   every function called is on an allowlist of aggregate, window, math, date, string and conditional functions
//   (so no file, URL, system, AI, identity or cost function, in either dialect);
//   every table after FROM, JOIN, a comma in a FROM list, or an opening parenthesis of a FROM item is on the
//   allowlist (BigQuery: written in full, project.dataset.table), or a CTE defined in the top-level WITH;
//   no string literal used as a table (DuckDB reads files that way), no LATERAL or UNNEST;
//   protected columns (contact data, person ids) never reach the output: not selected, not through *, an alias, a
//   CTE, a subquery or an expression, not grouped, ordered or filtered by; only a join key (a.col = b.col, USING) or
//   COUNT(DISTINCT col) may use them.
// The statement runs wrapped in an outer LIMIT 1000.
import { AppError } from "../errors.js";

export const MAX_SQL_CHARS = 8000;
export const ROW_LIMIT = 1000;

const FORBIDDEN_KEYWORDS = new Set([
  "insert", "update", "delete", "merge", "upsert", "create", "drop", "alter", "truncate", "rename", "replace_table",
  "copy", "attach", "detach", "install", "load", "pragma", "set", "reset", "call", "export", "import", "grant", "revoke",
  "execute", "exec", "declare", "begin", "commit", "rollback", "transaction", "vacuum", "checkpoint", "use", "into",
  "explain", "describe", "show", "summarize", "assert", "external_query", "information_schema", "__tables__", "__tables_summary__",
  // Statement forms and table operators the walk below does not read: refused rather than guessed.
  "table", "pivot", "unpivot", "pivot_longer", "pivot_wider", "tablesample", "sample", "model", "connection", "session_user", "current_user",
]);

/** The functions an exploratory query may call (both dialects). Anything else followed by "(" is refused. */
export const ALLOWED_FUNCTIONS = new Set([
  // aggregates and windows
  "sum", "count", "avg", "min", "max", "any_value", "median", "mode", "stddev", "stddev_samp", "stddev_pop", "variance", "var_samp", "var_pop",
  "quantile", "quantile_cont", "quantile_disc", "approx_quantiles", "percentile_cont", "percentile_disc", "corr", "covar_pop", "covar_samp",
  "string_agg", "array_agg", "countif", "count_if", "logical_and", "logical_or", "bool_and", "bool_or", "first", "last", "first_value",
  "last_value", "nth_value", "lag", "lead", "row_number", "rank", "dense_rank", "percent_rank", "cume_dist", "ntile",
  // math
  "abs", "round", "floor", "ceil", "ceiling", "trunc", "sign", "sqrt", "power", "pow", "exp", "ln", "log", "log10", "log2", "mod",
  "greatest", "least", "div", "safe_divide", "ieee_divide", "safe_multiply", "safe_add", "safe_subtract", "safe_negate",
  // conditional and casts
  "coalesce", "ifnull", "nullif", "if", "iif", "cast", "safe_cast", "try_cast",
  // dates
  "date", "datetime", "timestamp", "date_trunc", "datetime_trunc", "timestamp_trunc", "date_add", "date_sub", "date_diff", "datediff",
  "date_part", "datepart", "extract", "strftime", "format_date", "parse_date", "last_day", "dayofweek", "dayname", "monthname", "week",
  "isoweek", "year", "month", "day", "quarter", "weekday", "make_date", "current_date", "time_bucket", "date_bucket",
  // strings
  "concat", "lower", "upper", "length", "substr", "substring", "left", "right", "trim", "ltrim", "rtrim", "replace", "split_part",
  "starts_with", "ends_with", "contains", "strpos", "lpad", "rpad", "format", "printf", "initcap", "reverse",
]);
/** Words that are followed by "(" in ordinary SQL without being function calls. */
const PAREN_KEYWORDS = new Set([
  "in", "exists", "as", "over", "values", "using", "on", "and", "or", "not", "where", "select", "from", "join", "any", "all", "some",
  "filter", "within", "by", "then", "else", "when", "case", "between", "like", "ilike", "is", "interval", "distinct", "array", "struct",
  "rollup", "cube", "sets", "grouping", "qualify", "having", "union", "except", "intersect", "with", "end", "safe",
]);
const SUBQUERY_START = new Set(["select", "with", "from", "values"]);
const CLAUSE_END = new Set(["where", "group", "having", "order", "limit", "qualify", "window", "union", "except", "intersect", "select", "on", "using", "offset", "fetch"]);
/** Clauses that hold one condition: a comma at their own depth is not SQL the guard reads. */
const CONDITION = new Set(["where", "having", "qualify", "on"]);

/** Plain words for each refusal code. */
export const GUARD_MESSAGES = {
  sql_empty: "There is no query to run.",
  sql_too_long: `The query is longer than ${MAX_SQL_CHARS} characters.`,
  sql_unterminated: "The query has a string or identifier that is not closed.",
  sql_multiple_statements: "Only one statement can run. Remove the semicolons between statements.",
  sql_not_select: "Only a read-only query can run: it must start with SELECT or WITH.",
  sql_forbidden_keyword: "The query uses a word that writes, loads, changes settings or reads another statement form, so it does not run.",
  sql_forbidden_function: "The query calls a function that exploratory queries may not use (only aggregate, window, math, date, string and conditional functions), so it does not run.",
  sql_table_not_allowed: "The query reads a table that is not on the list of tables the agent may read (Settings › Sources). On BigQuery every table is written in full, project.dataset.table.",
  sql_protected_column: "The query uses a protected column outside the two places it may appear, so it does not run. A protected column can only be a join key compared with another column (a.col = b.col, or USING) or sit alone inside COUNT(DISTINCT …).",
  sql_location_mismatch: "The query reads a dataset in another location than the mart. A BigQuery query runs in one location.",
  sql_unsupported_syntax: "The query uses a form the guard does not read the same way as the warehouse (block comments, backslashes, prefixed or dollar-quoted strings, @ variables), so it does not run.",
};
const refuse = (code, detail, extra = {}) => {
  throw new AppError(code, detail ? `${GUARD_MESSAGES[code]} (${detail})` : GUARD_MESSAGES[code], { params: { ...(detail ? { detail } : {}), ...extra } });
};
const refuseTable = (name) => refuse("sql_table_not_allowed", name, { table: name });

/**
 * Splits SQL into tokens, dropping line comments. Strings and quoted identifiers stay whole. The guard must read a
 * query exactly as the warehouse does, so anything whose rules differ between dialects or versions is refused.
 * @param {"duckdb"|"bigquery"} dialect
 */
export function tokenize(sql, dialect = "duckdb") {
  const tokens = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
    } else if (c === "#" && dialect === "bigquery") {
      // A line comment in BigQuery only; in DuckDB # falls through to punctuation.
      while (i < n && sql[i] !== "\n") i++;
    } else if (c === "/" && sql[i + 1] === "*") {
      // DuckDB nests block comments and BigQuery does not: one reading cannot be right for both.
      refuse("sql_unsupported_syntax", "block comment");
    } else if (c === "'" || c === '"' || c === "`") {
      if (sql.startsWith(c.repeat(3), i) && c !== "`") refuse("sql_unsupported_syntax", "triple quotes");
      const prev = tokens.at(-1);
      if (prev?.type === "word" && /^(e|r|b|rb|br|x|u&)$/i.test(prev.value) && prev.end === i) refuse("sql_unsupported_syntax", `${prev.value}${c}…${c}`);
      let j = i + 1;
      let text = "";
      for (;;) {
        if (j >= n) refuse("sql_unterminated");
        if (sql[j] === "\\") refuse("sql_unsupported_syntax", "backslash");
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            text += c;
            j += 2;
            continue;
          }
          break;
        }
        text += sql[j++];
      }
      // In BigQuery "…" is a string, not an identifier.
      tokens.push({ type: c === "'" || (c === '"' && dialect === "bigquery") ? "string" : "quoted", value: text });
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++;
      tokens.push({ type: "word", value: sql.slice(i, j), end: j });
      i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9.eE]/.test(sql[j])) j++;
      tokens.push({ type: "number", value: sql.slice(i, j) });
      i = j;
    } else {
      if (c === "$" || c === "@" || c === "?") refuse("sql_unsupported_syntax", c);
      if (c.charCodeAt(0) > 127) refuse("sql_unsupported_syntax", `character ${c}`);
      tokens.push({ type: "punct", value: c });
      i++;
    }
  }
  return tokens;
}

/** Reads a possibly dotted name (a.b.c, `p.d.t`, "x") starting at tokens[k]; returns { parts, next }. */
function readName(tokens, k) {
  const parts = [];
  let j = k;
  for (;;) {
    const t = tokens[j];
    if (!t || (t.type !== "word" && t.type !== "quoted")) break;
    parts.push(...(t.type === "quoted" ? t.value.split(".") : [t.value]));
    if (tokens[j + 1]?.value === "." && tokens[j + 2] && ["word", "quoted"].includes(tokens[j + 2].type)) j += 2;
    else {
      j += 1;
      break;
    }
  }
  return { parts, next: j };
}

/** The mart alone, as the warehouse writes it: the policy when the caller passes none. */
function martPolicy(warehouse) {
  const full = warehouse.table.replace(/`/g, "");
  if (warehouse.dialect === "bigquery") {
    const [project, dataset, table] = full.split(".");
    const key = `${project.toLowerCase()}.${dataset}.${table}`;
    return { match: (p) => (p.length === 3 && `${p[0].toLowerCase()}.${p[1]}.${p[2]}` === key ? key : null) };
  }
  const name = full.toLowerCase();
  return { match: (p) => (p.map((x) => x.toLowerCase()).join(".") === name || p.map((x) => x.toLowerCase()).join(".") === `main.${name}` ? name : null) };
}

/** Words after a table name that are not its alias. */
const NOT_ALIAS = new Set([...CLAUSE_END, "join", "inner", "left", "right", "full", "outer", "cross", "natural", "positional", "asof", "anti", "semi", "for", "as", "union", "except", "intersect", "lateral", "unnest", "window"]);
/** Clause words that set where a token stands inside one SELECT. */
const CLAUSES = new Set(["select", "from", "join", "where", "group", "having", "order", "qualify", "window", "on", "limit", "offset", "fetch", "union", "except", "intersect"]);
/** Words before "*" that make it a star (every column), not a multiplication. */
const STAR_BEFORE = new Set(["select", "distinct", "all", "struct", "value"]);

/**
 * Checks one exploratory query and returns it ready to run, wrapped in the outer LIMIT.
 * @param {string} sql
 * @param {{ table: string, dialect: "duckdb"|"bigquery" }} warehouse table: the mart as the warehouse writes it.
 * @param {{ policy?: { match: (parts: string[]) => string|null }, protectedCols?: (key: string) => Set<string>|null }} [opts]
 *   policy: which tables may be read (src/explore/allow.js policyFor); default: the mart alone.
 *   protectedCols: the protected columns of one allowed table, lower case.
 * @returns {{ sql: string, wrapped: string, tables: string[] }} tables: the allowed tables read, by canonical key.
 */
export function guardSql(sql, warehouse, opts = {}) {
  if (typeof sql !== "string" || !sql.trim()) refuse("sql_empty");
  if (sql.length > MAX_SQL_CHARS) refuse("sql_too_long");
  const tokens = tokenize(sql, warehouse.dialect);
  if (!tokens.length) refuse("sql_empty");
  // One statement: a single ; at the very end is dropped, any other is a chain.
  while (tokens.length && tokens.at(-1).value === ";") tokens.pop();
  if (tokens.some((t) => t.type === "punct" && t.value === ";")) refuse("sql_multiple_statements");
  const first = tokens[0];
  if (first.type !== "word" || !["select", "with"].includes(first.value.toLowerCase())) refuse("sql_not_select");
  const policy = opts.policy ?? martPolicy(warehouse);

  // CTE names count only when defined in the top-level WITH (depth 0), so a CTE inside a subquery cannot make a
  // real table's name look allowed elsewhere.
  const ctes = new Set();
  const lastParts = new Set([...(policy.allowed ?? []), ...(policy.entries ?? []).map((e) => e?.table).filter(Boolean), warehouse.table.replace(/`/g, "")].map((k) => String(k).split(".").at(-1).toLowerCase()));
  const shadowsTable = (name) => lastParts.has(name) || policy.match([name]) !== null || policy.match(["main", name]) !== null;
  {
    let depth = 0;
    let inWith = first.value.toLowerCase() === "with";
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.value === "(" && t.type === "punct") depth++;
      else if (t.value === ")" && t.type === "punct") depth = Math.max(0, depth - 1);
      if (depth !== 0 || !inWith) continue;
      const lower = t.type === "word" ? t.value.toLowerCase() : null;
      if (lower === "select") inWith = false;
      if (lower === "with" || lower === "recursive" || (t.type === "punct" && t.value === ",")) {
        const nameTok = tokens[k + 1];
        if (nameTok && ["word", "quoted"].includes(nameTok.type) && tokens[k + 2]?.value?.toLowerCase() === "as" && tokens[k + 3]?.value === "(") {
          const cte = nameTok.value.toLowerCase();
          // A CTE named like an allowed table would shadow it in one reading and not in another (DuckDB resolves the
          // name inside the CTE's own body, or before it is defined, to the table): refused in both dialects.
          if (shadowsTable(cte)) refuse("sql_table_not_allowed", `a WITH name equal to the table ${nameTok.value}`);
          ctes.add(cte);
        }
      }
    }
  }

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const lower = t.type === "word" ? t.value.toLowerCase() : null;
    if (lower && FORBIDDEN_KEYWORDS.has(lower)) refuse("sql_forbidden_keyword", t.value.toUpperCase());
    if (t.type === "quoted" && /information_schema|__tables__/i.test(t.value)) refuseTable(t.value);
    // A function call: a name followed by "(". Only allowlisted names, and only BigQuery's SAFE. prefix.
    if ((t.type === "word" || t.type === "quoted") && tokens[k + 1]?.value === "(") {
      const name = t.value.toLowerCase();
      const qualifier = tokens[k - 1]?.value === "." ? tokens[k - 2] : null;
      if (qualifier && !(qualifier.type === "word" && qualifier.value.toLowerCase() === "safe")) refuse("sql_forbidden_function", `${qualifier.value}.${t.value}`);
      if (qualifier && !ALLOWED_FUNCTIONS.has(name)) refuse("sql_forbidden_function", `SAFE.${t.value}`);
      if (t.type === "quoted" || (!ALLOWED_FUNCTIONS.has(name) && !PAREN_KEYWORDS.has(name))) refuse("sql_forbidden_function", t.value);
    }
  }

  // Tables: walk with a clause state per parenthesis depth.
  const state = [null];
  let depth = 0;
  let fromParen = false; // the next "(" opens a FROM item: its first token is a table or a subquery
  const tables = [];
  let reads = 0; // tables and CTEs read
  /** Alias (and the table's own names) → canonical key, for qualified column references. */
  const aliases = new Map();
  const checkTableAt = (k) => {
    const t = tokens[k];
    if (!t) return k;
    if (t.type === "punct" && t.value === "(") {
      fromParen = true;
      return k - 1; // the main loop opens the parenthesis
    }
    if (t.type === "string") refuseTable(`'${t.value}'`);
    if (t.type === "word" && ["lateral", "unnest"].includes(t.value.toLowerCase())) refuse("sql_table_not_allowed", t.value.toUpperCase());
    if (t.type !== "word" && t.type !== "quoted") refuseTable(t.value);
    const { parts, next } = readName(tokens, k);
    const name = parts.join(".");
    if (tokens[next]?.value === "(") refuse("sql_forbidden_function", name);
    const cte = parts.length === 1 && ctes.has(name.toLowerCase());
    const key = cte ? null : policy.match(parts);
    if (!cte && !key) refuseTable(name);
    reads++;
    if (key) {
      tables.push(key);
      aliases.set(parts.at(-1).toLowerCase(), key);
      // The alias: AS x, or a bare word that is not a keyword.
      let a = next;
      if (tokens[a]?.type === "word" && tokens[a].value.toLowerCase() === "as") a++;
      const at = tokens[a];
      if (at && (at.type === "quoted" || (at.type === "word" && !NOT_ALIAS.has(at.value.toLowerCase())))) aliases.set(at.value.toLowerCase(), key);
    }
    return next - 1;
  };
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const lower = t.type === "word" ? t.value.toLowerCase() : null;
    if (t.value === "(" && t.type === "punct") {
      depth++;
      state[depth] = null;
      if (fromParen) {
        fromParen = false;
        const next = tokens[k + 1];
        // A subquery is read by the walk as it goes; anything else is a parenthesised FROM item or join.
        if (!(next?.type === "word" && SUBQUERY_START.has(next.value.toLowerCase()))) {
          state[depth] = "from";
          k = checkTableAt(k + 1);
        }
      }
      continue;
    }
    if (t.value === ")" && t.type === "punct") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (lower === "from" || lower === "join") {
      state[depth] = "from";
      k = checkTableAt(k + 1);
      continue;
    }
    if (lower && CLAUSE_END.has(lower)) {
      state[depth] = CONDITION.has(lower) ? "condition" : null;
      continue;
    }
    if (state[depth] === "condition" && t.value === "," && t.type === "punct") refuse("sql_unsupported_syntax", "a comma after a condition");
    if (state[depth] === "from" && t.value === "," && t.type === "punct") {
      k = checkTableAt(k + 1);
      continue;
    }
  }
  if (!reads) refuseTable("no table");

  if (opts.protectedCols) checkProtected(tokens, [...new Set(tables)], aliases, opts.protectedCols, ctes);

  // A WITH name equal to a table the query reads (a dataset entry's tables are only known by being read).
  for (const key of tables) {
    const last = String(key).split(".").at(-1).toLowerCase();
    if (ctes.has(last)) refuse("sql_table_not_allowed", `a WITH name equal to the table ${last}`);
  }
  const body = sql.trim().replace(/;\s*$/, "");
  const wrapped = `SELECT * FROM (\n${body}\n) AS q\nLIMIT ${ROW_LIMIT}`;
  return { sql: body, wrapped, tables: [...new Set(tables)] };
}

/**
 * Protected columns may be used in two places only, and nowhere else (security review 2, H2):
 *   - as a join key compared with another column: JOIN … ON a.col = b.col (each side a bare column), or USING (col);
 *   - inside COUNT(DISTINCT col), with nothing around the column.
 * Anywhere else, a protected column is refused: in the select list, GROUP BY, ORDER BY, WINDOW, WHERE, HAVING,
 * QUALIFY, an ON condition against a literal, CASE, LIKE, IN, any function, COUNTIF, any comparison with a
 * constant. So what can leave is the number of distinct values, never a value or a property of one. A *, or a whole
 * row (a table alias alone, which both warehouses return as a struct), over a table with a protected column is
 * refused in the select list. Unqualified names are protected when any table read has a protected column of that
 * name; qualified ones by their own table.
 */
function checkProtected(tokens, tables, aliases, protectedCols, ctes = new Set()) {
  const byTable = new Map(tables.map((k) => [k, protectedCols(k) ?? new Set()]));
  const any = new Set([...byTable.values()].flatMap((s) => [...s]));
  if (!any.size) return;
  const rowAliases = new Set([...aliases].filter(([, key]) => byTable.get(key)?.size).map(([a]) => a));
  const frames = [{ sub: true, clause: null, using: false, fromItem: false }];
  // Names that stand for rows the query computes (a CTE, a derived table, and their aliases): a protected join key
  // may not be compared with their columns, which could hold chosen values (security review 2, V2).
  const derived = new Set(ctes);
  // A query that uses a protected column may not contain a CTE or a subquery anywhere: then a protected column can
  // only ever meet base-table columns, whatever the nesting (security review 2, V2).
  const nested = ctes.size > 0 || tokens.some((x, i) => x.type === "punct" && x.value === "(" && tokens[i + 1]?.type === "word" && SUBQUERY_START.has(tokens[i + 1].value.toLowerCase()));
  const allowUse = (what) => {
    if (nested) refuse("sql_protected_column", `${what} in a query with a WITH or a subquery`, { column: what });
  };
  const aliasAt = (i) => {
    let a = i;
    if (val(tokens[a]) === "as") a++;
    const at = tokens[a];
    return at && (at.type === "quoted" || (at.type === "word" && !NOT_ALIAS.has(val(at)))) ? val(at) : null;
  };
  const deny = (what) => refuse("sql_protected_column", what, { column: what });
  const isName = (t) => t && (t.type === "word" || t.type === "quoted");
  const val = (t) => (t ? String(t.value).toLowerCase() : null);
  /** The first token of a column reference that ends at j (a, a.b, a.b.c). */
  const refStart = (j) => {
    let i = j;
    while (tokens[i - 1]?.value === "." && tokens[i - 1].type === "punct" && isName(tokens[i - 2])) i -= 2;
    return i;
  };
  /** The last token of a column reference that starts at i, or -1 when i does not start a plain column reference. */
  const refEnd = (i) => {
    if (!isName(tokens[i])) return -1;
    let j = i;
    while (tokens[j + 1]?.value === "." && tokens[j + 1].type === "punct" && isName(tokens[j + 2])) j += 2;
    if (tokens[j + 1]?.value === "(") return -1; // a function call
    return j;
  };
  const BOUNDARY_AFTER = new Set(["and", "or", "where", "join", "inner", "left", "right", "full", "cross", "natural", "group", "order", "having", "qualify", "window", "limit", "union", "except", "intersect"]);
  const endsOperand = (j) => {
    const n = tokens[j + 1];
    return !n || (n.type === "punct" && [")", ","].includes(n.value)) || (n.type === "word" && BOUNDARY_AFTER.has(val(n)));
  };
  const startsOperand = (i) => {
    const p = tokens[i - 1];
    return p && ((p.type === "punct" && p.value === "(") || (p.type === "word" && ["on", "and", "or"].includes(val(p))));
  };
  /** A column of an allowed base table, qualified by its alias: the reference spanning [i, j]. */
  const baseColumn = (i, j) => {
    const t = tokens[j];
    const q = t.type === "quoted" && t.value.includes(".") ? t.value.split(".").at(-2).toLowerCase() : i < j ? val(tokens[j - 2]) : null;
    return q !== null && aliases.has(q) && !derived.has(q);
  };
  /** a.col = b.col in an ON clause, the protected reference spanning [start, end]; b a base table's column. */
  const joinKey = (start, end) => {
    if (tokens[end + 1]?.value === "=" && startsOperand(start)) {
      const rEnd = refEnd(end + 2);
      return rEnd > 0 && endsOperand(rEnd) && baseColumn(end + 2, rEnd);
    }
    if (tokens[start - 1]?.value === "=" && endsOperand(end)) {
      const lEnd = start - 2;
      if (!isName(tokens[lEnd]) || tokens[lEnd + 1]?.value === "(") return false;
      const lStart = refStart(lEnd);
      return startsOperand(lStart) && baseColumn(lStart, lEnd);
    }
    return false;
  };
  /** COUNT(DISTINCT col) with nothing else inside. */
  const countDistinct = (start, end) => val(tokens[start - 1]) === "distinct" && tokens[start - 2]?.value === "(" && val(tokens[start - 3]) === "count" && tokens[end + 1]?.value === ")";

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const lower = t.type === "word" ? t.value.toLowerCase() : null;
    const top = frames.at(-1);
    if (t.type === "punct" && t.value === "(") {
      const next = tokens[k + 1];
      const sub = next?.type === "word" && SUBQUERY_START.has(next.value.toLowerCase());
      // A parenthesis in a FROM list is a FROM item (a parenthesised join): its JOIN, ON and USING are read as in a
      // SELECT, so its conditions are checked too (security review 2, V1).
      frames.push(sub ? { sub: true, clause: null, using: false, fromItem: false } : { sub: false, clause: top.clause, using: val(tokens[k - 1]) === "using", fromItem: top.clause === "from" });
      continue;
    }
    if (t.type === "punct" && t.value === ")") {
      if (frames.length > 1) {
        const closed = frames.pop();
        // A derived table in a FROM list: its alias names computed rows.
        if (closed.sub && frames.at(-1).clause === "from") {
          const a = aliasAt(k + 1);
          if (a) derived.add(a);
        }
      }
      continue;
    }
    if (lower && CLAUSES.has(lower) && (top.sub || top.fromItem)) {
      top.clause = lower === "join" ? "from" : ["union", "except", "intersect"].includes(lower) ? null : lower;
      continue;
    }
    const prev = tokens[k - 1];
    if (t.type === "punct" && t.value === "*" && top.clause === "select") {
      if ((prev?.type === "word" && STAR_BEFORE.has(prev.value.toLowerCase())) || (prev?.type === "punct" && [",", "."].includes(prev.value))) deny("*");
      continue;
    }
    if (!isName(t)) continue;
    // JOIN … USING (col): a join key, when every row source of the query is a base table (no CTE, no derived table).
    if (top.using) {
      if (any.has(val(t))) {
        if (derived.size) deny(t.value);
        allowUse(t.value);
      }
      continue;
    }
    if (top.clause === "from") {
      // Table names and aliases. A CTE read here, and its alias, name computed rows.
      if (isName(t) && ctes.has(val(t)) && tokens[k - 1]?.value !== ".") {
        const a = aliasAt(k + 1);
        if (a) derived.add(a);
      }
      continue;
    }
    if (tokens[k + 1]?.value === "(") continue; // a function name, checked by the allowlist
    if (tokens[k + 1]?.value === "." && isName(tokens[k + 2])) continue; // a qualifier: checked at the column
    if (prev?.type === "word" && prev.value.toLowerCase() === "as") continue; // an output name or a type, not data
    const parts = t.type === "quoted" ? t.value.split(".") : [t.value];
    const name = parts.at(-1).toLowerCase();
    const start = refStart(k);
    const qualifier = parts.length > 1 ? parts.at(-2).toLowerCase() : start < k ? val(tokens[k - 2]) : null;
    if (top.clause === "select" && start === k && rowAliases.has(name)) deny(t.value); // a whole row
    if (top.clause === "select" && parts.length > 1 && rowAliases.has(name)) deny(parts.join("."));
    const key = qualifier !== null ? aliases.get(qualifier) : null;
    const isProtected = key ? byTable.get(key)?.has(name) : any.has(name);
    if (!isProtected) continue;
    if ((top.clause === "on" && joinKey(start, k)) || countDistinct(start, k)) {
      allowUse(t.value);
      continue;
    }
    deny(parts.length > 1 || start === k ? (start < k ? tokens.slice(start, k + 1).map((x) => x.value).join("") : t.value) : t.value);
  }
}
