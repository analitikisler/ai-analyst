// The guard for exploratory SQL: a model may write one read-only query against the mart, and this decides, in
// code, whether it runs. It does not trust the prompt. It is the first of three fences: the warehouse checks
// again (BigQuery: the dry run's referenced tables must be exactly the mart; DuckDB: the query runs in a database
// that holds nothing but a copy of the mart), so a gap here does not expose another table.
//
// The checks:
//   the query is read the way the warehouse reads it; anything whose reading could differ is refused: block
//   comments (DuckDB nests them, BigQuery does not), backslash escapes, prefixed, triple-quoted or $ strings, @;
//   one statement (a single trailing ; is allowed); it starts with SELECT or WITH;
//   no keyword that writes, loads, changes settings or names another statement form (TABLE, PIVOT) anywhere;
//   every function called is on an allowlist of aggregate, window, math, date, string and conditional functions
//   (so no file, URL, system, AI, identity or cost function, in either dialect);
//   every table after FROM, JOIN, a comma in a FROM list, or an opening parenthesis of a FROM item is the mart,
//   or a CTE defined in the top-level WITH;
//   no string literal used as a table (DuckDB reads files that way), no LATERAL or UNNEST.
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
  sql_table_not_allowed: "Only the mart table, daily_channel_device, can be read.",
  sql_unsupported_syntax: "The query uses a form the guard does not read the same way as the warehouse (block comments, backslashes, prefixed or dollar-quoted strings, @ variables), so it does not run.",
};
const refuse = (code, detail) => {
  throw new AppError(code, detail ? `${GUARD_MESSAGES[code]} (${detail})` : GUARD_MESSAGES[code], { params: detail ? { detail } : {} });
};

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

/**
 * Checks one exploratory query and returns it ready to run, wrapped in the outer LIMIT.
 * @param {string} sql
 * @param {{ table: string, dialect: "duckdb"|"bigquery" }} warehouse table: the mart as the warehouse writes it.
 * @returns {{ sql: string, wrapped: string, tables: string[] }}
 */
export function guardSql(sql, warehouse) {
  if (typeof sql !== "string" || !sql.trim()) refuse("sql_empty");
  if (sql.length > MAX_SQL_CHARS) refuse("sql_too_long");
  const tokens = tokenize(sql, warehouse.dialect);
  if (!tokens.length) refuse("sql_empty");
  // One statement: a single ; at the very end is dropped, any other is a chain.
  while (tokens.length && tokens.at(-1).value === ";") tokens.pop();
  if (tokens.some((t) => t.type === "punct" && t.value === ";")) refuse("sql_multiple_statements");
  const first = tokens[0];
  if (first.type !== "word" || !["select", "with"].includes(first.value.toLowerCase())) refuse("sql_not_select");

  // The allowed table names: the mart's last part, and its full name as the warehouse writes it.
  const full = warehouse.table.replace(/`/g, "").toLowerCase();
  const allowed = new Set([full, full.split(".").at(-1)]);
  if (warehouse.dialect === "duckdb") allowed.add(`main.${full}`);

  // CTE names count only when defined in the top-level WITH (depth 0), so a CTE inside a subquery cannot make a
  // real table's name look allowed elsewhere.
  const ctes = new Set();
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
        if (nameTok && ["word", "quoted"].includes(nameTok.type) && tokens[k + 2]?.value?.toLowerCase() === "as" && tokens[k + 3]?.value === "(") ctes.add(nameTok.value.toLowerCase());
      }
    }
  }

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const lower = t.type === "word" ? t.value.toLowerCase() : null;
    if (lower && FORBIDDEN_KEYWORDS.has(lower)) refuse("sql_forbidden_keyword", t.value.toUpperCase());
    if (t.type === "quoted" && /information_schema|__tables__/i.test(t.value)) refuse("sql_table_not_allowed", t.value);
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
  const checkTableAt = (k) => {
    const t = tokens[k];
    if (!t) return k;
    if (t.type === "punct" && t.value === "(") {
      fromParen = true;
      return k - 1; // the main loop opens the parenthesis
    }
    if (t.type === "string") refuse("sql_table_not_allowed", `'${t.value}'`);
    if (t.type === "word" && ["lateral", "unnest"].includes(t.value.toLowerCase())) refuse("sql_table_not_allowed", t.value.toUpperCase());
    if (t.type !== "word" && t.type !== "quoted") refuse("sql_table_not_allowed", t.value);
    const { parts, next } = readName(tokens, k);
    const name = parts.join(".").toLowerCase();
    if (tokens[next]?.value === "(") refuse("sql_forbidden_function", name);
    if (!allowed.has(name) && !(parts.length === 1 && ctes.has(name))) refuse("sql_table_not_allowed", parts.join("."));
    tables.push(name);
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
  if (!tables.length) refuse("sql_table_not_allowed", "no table");

  const body = sql.trim().replace(/;\s*$/, "");
  const wrapped = `SELECT * FROM (\n${body}\n) AS q\nLIMIT ${ROW_LIMIT}`;
  return { sql: body, wrapped, tables };
}
