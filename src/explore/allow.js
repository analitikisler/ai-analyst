// The tables the agent may read (design: multi-table queries, 25 Oct 2026). The person chooses them in Settings ›
// Data source; AI_ANALYST_EXPLORE_ALLOW sets them on the server and locks the list. The mart is always on it, and an
// empty list (the default) means the mart alone. An entry is a dataset (every table in it, also ones added later)
// or one table. The demo has its own list over its shop tables, so switching sources never widens the other.
//
// Names: BigQuery tables are written project.dataset.table; the project is compared in lower case (project ids
// are lower case), the dataset and table exactly (BigQuery treats them as case-sensitive). Demo tables are bare
// names, compared in lower case as DuckDB does.
import { MART } from "../metrics/load.js";

export const DEMO_DATASET = "demo";
/** The demo shop's tables next to the mart, generated from the same seed (src/demo/seed.js). */
export const DEMO_TABLES = ["orders", "order_items", "products", "returns"];
export const DESCRIBE_TTL_MS = 10 * 60 * 1000;
export const GB = 1024 ** 3;
export const QUESTION_CAP_DEFAULT = 5 * GB;

const PROJECT = /^([a-z0-9.-]+:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATASET = /^[A-Za-z_][A-Za-z0-9_]{0,1023}$/;
/** A table name the guard accepts: no wildcard, no meta-table (__TABLES__), no INFORMATION_SCHEMA. */
const TABLE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,1023}$/;
export const isTableName = (t) => typeof t === "string" && TABLE.test(t) && !t.startsWith("__") && !/^information_schema$/i.test(t);

/** One entry as stored: { project, dataset, table|null } (BigQuery) or { project: null, dataset: "demo", table|null }. */
export function normalizeEntry(e) {
  if (!e || typeof e !== "object") return null;
  const table = e.table == null || e.table === "" ? null : String(e.table);
  if (e.project == null || e.project === "") {
    if (e.dataset !== DEMO_DATASET) return null;
    if (table !== null && !DEMO_TABLES.includes(table.toLowerCase())) return null;
    return { project: null, dataset: DEMO_DATASET, table: table?.toLowerCase() ?? null, ...(e.meta && typeof e.meta === "object" ? { meta: e.meta } : {}) };
  }
  const project = String(e.project).toLowerCase();
  if (!PROJECT.test(project) || !DATASET.test(String(e.dataset ?? ""))) return null;
  if (table !== null && !isTableName(table)) return null;
  return { project, dataset: String(e.dataset), table, ...(e.meta && typeof e.meta === "object" ? { meta: e.meta } : {}) };
}

export const entryKey = (e) => (e.project ? [e.project, e.dataset, e.table].filter(Boolean).join(".") : e.table ?? DEMO_DATASET);

/**
 * AI_ANALYST_EXPLORE_ALLOW: comma separated. project.dataset or project.dataset.table for BigQuery; demo (every
 * demo table) or demo.orders for the demo. Anything else stops the server with a plain message.
 */
export function parseAllowEnv(value) {
  const out = [];
  for (const raw of String(value).split(",").map((s) => s.trim()).filter(Boolean)) {
    if (raw === DEMO_DATASET) out.push({ project: null, dataset: DEMO_DATASET, table: null });
    else if (raw.startsWith(`${DEMO_DATASET}.`) && !PROJECT.test(raw.split(".")[0])) out.push(normalizeEntry({ project: null, dataset: DEMO_DATASET, table: raw.slice(DEMO_DATASET.length + 1) }));
    else {
      // A domain-scoped project ("example.com:proj") has a dot of its own.
      const m = raw.match(/^((?:[a-z0-9.-]+:)?[a-z][a-z0-9-]{4,28}[a-z0-9])\.([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z0-9_][A-Za-z0-9_-]*))?$/);
      out.push(m ? normalizeEntry({ project: m[1], dataset: m[2], table: m[3] ?? null }) : null);
    }
    if (!out.at(-1)) throw new Error(`AI_ANALYST_EXPLORE_ALLOW: "${raw}" is not a dataset or table. Write project.dataset, project.dataset.table, demo or demo.orders, separated by commas.`);
  }
  return out;
}

/** The explore part of the config: entries for both sources, protected columns, descriptions, the question cap. */
export function loadExploreConfig(env, fromFile) {
  const file = fromFile.explore && typeof fromFile.explore === "object" ? fromFile.explore : {};
  const has = env.AI_ANALYST_EXPLORE_ALLOW !== undefined && env.AI_ANALYST_EXPLORE_ALLOW !== "";
  const fromEnv = has ? parseAllowEnv(env.AI_ANALYST_EXPLORE_ALLOW) : null;
  const clean = (list) => (Array.isArray(list) ? list.map(normalizeEntry).filter(Boolean) : []);
  const all = fromEnv ?? [...clean(file.allow), ...clean(file.demoAllow)];
  const protectedCols = {};
  for (const [k, v] of Object.entries(file.protected ?? {})) {
    if (!v || !Array.isArray(v.columns)) continue;
    protectedCols[k] = { columns: [...new Set(v.columns.filter((c) => typeof c === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,299}$/.test(c)).map((c) => c.toLowerCase()))], confirmed: v.confirmed === true };
  }
  const descriptions = {};
  for (const [k, v] of Object.entries(file.descriptions ?? {})) if (typeof v === "string" && v.trim()) descriptions[k] = v.trim().slice(0, 200);
  const cap = Number(file.maxBytesPerQuestion);
  return {
    allow: all.filter((e) => e.project),
    demoAllow: all.filter((e) => !e.project),
    source: has ? "env" : file.allow?.length || file.demoAllow?.length ? "file" : "default",
    locked: has,
    ...(has ? { env: "AI_ANALYST_EXPLORE_ALLOW" } : {}),
    protected: protectedCols,
    descriptions,
    maxBytesPerQuestion: cap > 0 ? cap : QUESTION_CAP_DEFAULT,
  };
}

/** The mart's key: project.dataset.daily_channel_device, or daily_channel_device on the demo. */
export function martKey(config, demo) {
  return demo ? MART.model : `${String(config.bigquery.project).toLowerCase()}.${config.bigquery.dataset}.${MART.model}`;
}

/**
 * What the agent may read on this warehouse.
 * @returns {{ demo: boolean, mart: string, entries: object[], match: (parts: string[]) => string|null, keys: () => string[]|null }}
 *   match: the canonical key of a table name as written in SQL, or null when it is not allowed.
 */
export function policyFor(config, warehouse) {
  const demo = warehouse.demo !== false;
  const ex = config.explore ?? { allow: [], demoAllow: [] };
  const mart = martKey(config, demo);
  if (demo) {
    const tables = new Set([MART.model]);
    for (const e of ex.demoAllow ?? []) for (const t of e.table ? [e.table] : DEMO_TABLES) tables.add(t);
    // Only tables the demo file holds are there to read (an older demo file has the mart alone).
    const present = warehouse.tables ? new Set(warehouse.tables()) : null;
    const allowed = [...tables].filter((t) => !present || present.has(t));
    return {
      demo,
      mart,
      entries: ex.demoAllow ?? [],
      allowed,
      match(parts) {
        const p = parts.map((x) => x.toLowerCase());
        const name = p.length === 1 ? p[0] : p.length === 2 && p[0] === "main" ? p[1] : null;
        return name && allowed.includes(name) ? name : null;
      },
    };
  }
  const entries = ex.allow ?? [];
  const tableKeys = new Set([mart, ...entries.filter((e) => e.table).map(entryKey)]);
  const datasets = new Set(entries.filter((e) => !e.table).map((e) => `${e.project}.${e.dataset}`));
  return {
    demo,
    mart,
    entries,
    allowed: [...tableKeys],
    datasets: [...datasets],
    match(parts) {
      let p = parts;
      // `example.com:proj.d.t` splits into four parts.
      if (p.length === 4 && p[1].includes(":")) p = [`${p[0]}.${p[1]}`, p[2], p[3]];
      if (p.length !== 3) return null; // BigQuery names must be fully qualified
      const [project, dataset, table] = [p[0].toLowerCase(), p[1], p[2]];
      if (!PROJECT.test(project) || !DATASET.test(dataset) || !isTableName(table)) return null;
      const key = `${project}.${dataset}.${table}`;
      if (tableKeys.has(key)) return key;
      return datasets.has(`${project}.${dataset}`) ? key : null;
    },
  };
}

/** Is a referenced table (as the dry run reports it) on the list? */
export function refAllowed(policy, ref) {
  return policy.match([String(ref.projectId ?? ""), String(ref.datasetId ?? ""), String(ref.tableId ?? "")]) !== null;
}

// ---------------------------------------------------------------- protected columns

/**
 * Column names split into lower-case tokens: on _, -, ., spaces, digits and camelCase ("customerEmail",
 * "contact_phone2" → ["customer", "email"], ["contact", "phone"]).
 */
export function nameTokens(name) {
  return String(name)
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .split(/[^a-z]+/)
    .filter(Boolean);
}

const PERSON_TABLE = /customer|user|member|person|people|contact|client|musteri|uye|kisi|recipient|alici/i;
const PERSON_WORD = new Set(["customer", "user", "member", "person", "contact", "client", "recipient", "billing", "shipping", "buyer", "musteri", "uye", "kisi", "alici", "first", "last", "full", "given", "family", "middle", "sur", "nick", "display"]);
const has = (tokens, ...words) => words.some((w) => tokens.includes(w));
const pair = (tokens, a, b) => tokens.some((t, i) => t === a && tokens[i + 1] === b);
// Turkish adds case and possessive endings (telefonu, adresi, soyadı): match these roots as prefixes.
const root = (tokens, ...roots) => tokens.some((t) => roots.some((r) => t.startsWith(r)));

/** Contact, identity and precise-location data: always proposed. Returns the reason, or null. */
function contactGroup(tokens, compact, personTable) {
  if (root(tokens, "eposta", "telefon", "soyad", "soyisim", "adres", "dogum", "kimlik")) return root(tokens, "eposta") ? "email" : root(tokens, "telefon") ? "phone" : root(tokens, "adres") ? "address" : root(tokens, "dogum") ? "birth" : root(tokens, "kimlik") ? "national_id" : "name";
  if (has(tokens, "email", "mail", "eposta", "emailaddress") || pair(tokens, "e", "mail") || pair(tokens, "e", "posta")) return "email";
  if (has(tokens, "phone", "telephone", "tel", "telefon", "gsm", "msisdn", "cellphone", "mobilephone", "fax") || (has(tokens, "mobile", "cell") && has(tokens, "number", "no", "num", "phone")) || (personTable && tokens.length === 1 && ["mobile", "cell"].includes(tokens[0]))) return "phone";
  if (has(tokens, "firstname", "lastname", "fullname", "surname", "soyad", "soyadi", "soyisim", "isim", "adsoyad", "givenname", "familyname")) return "name";
  if (has(tokens, "name", "adi") && (personTable || tokens.some((t) => PERSON_WORD.has(t)))) return "name";
  if (tokens.length === 1 && ["ad", "adi"].includes(tokens[0])) return "name";
  if (tokens.at(-1) === "ad" && (personTable || tokens.some((t) => PERSON_WORD.has(t)))) return "name";
  if (has(tokens, "address", "adres", "street", "sokak", "cadde", "mahalle", "addressline")) return "address";
  if (has(tokens, "postcode", "postal", "zip", "zipcode", "postakodu") || pair(tokens, "posta", "kodu")) return "postcode";
  if (has(tokens, "ip", "ipv4", "ipv6", "ipaddress") || pair(tokens, "user", "agent")) return "ip";
  if (has(tokens, "birth", "birthday", "birthdate", "dob", "dogum")) return "birth";
  if (has(tokens, "tckn", "kimlik", "ssn", "passport", "pasaport", "vkn", "nationalid") || pair(tokens, "national", "id") || pair(tokens, "tax", "id") || (tokens[0] === "tc" && (tokens.length === 1 || has(tokens, "no", "kimlik", "number")))) return "national_id";
  if (has(tokens, "iban")) return "iban";
  if (has(tokens, "cvv", "cvc", "pan") || compact === "card" || pair(tokens, "credit", "card") || pair(tokens, "debit", "card") || (has(tokens, "card", "kart") && has(tokens, "number", "no", "num", "last", "pan"))) return "card";
  if (has(tokens, "password", "passwd", "secret", "token", "sifre")) return "secret";
  if (has(tokens, "idfa", "gaid", "idfv", "advertising") || pair(tokens, "device", "id")) return "device_id";
  if (has(tokens, "latitude", "longitude", "lat", "lng", "lon", "geo", "geom", "geopoint", "geography", "geolocation") || (tokens.at(-1) === "location" && has(tokens, "home", "user", "customer"))) return "location";
  return null;
}

/** The owner's optional groups (protection.yaml). */
function optionalGroup(tokens, personTable) {
  if (has(tokens, "city", "town", "district", "ilce", "sehir") || (tokens.length === 1 && tokens[0] === "il")) return "city";
  if (has(tokens, "age", "yas")) return "age";
  if (has(tokens, "gender", "sex", "cinsiyet")) return "gender";
  const idLike = tokens.at(-1) === "id" || tokens.at(-1) === "key";
  if (idLike && (tokens.some((t) => PERSON_WORD.has(t) && !["first", "last", "full", "given", "family", "middle", "sur", "nick", "display", "billing", "shipping"].includes(t)) || pair(tokens, "user", "pseudo"))) return "person_ids";
  if (personTable && tokens.length === 1 && tokens[0] === "id") return "person_ids";
  return null;
}

/** The default list: which optional groups are proposed too. Read from <pack>/protection.yaml when it exists. */
export const DEFAULT_OPTIONAL = { person_ids: false, city: false, age: false, gender: false };

/**
 * Proposed protected columns for one table, by name: compound names count (customer_email, contactPhone, phone_no,
 * client_ip), in English and Turkish (eposta, telefon, ad, soyad, adres, dogum). The type does not matter: a phone
 * stored as a number is still a phone. The person confirms (or changes) the list in Settings; until then the
 * proposal is what the guard enforces.
 * @param {string} table the table's last name part
 * @param {{ name: string, type?: string }[]} columns
 * @param {{ person_ids?: boolean, city?: boolean, age?: boolean, gender?: boolean }} [optional] the default list
 */
export function proposeProtected(table, columns, optional = DEFAULT_OPTIONAL) {
  const personTable = PERSON_TABLE.test(String(table));
  const out = [];
  for (const c of columns ?? []) {
    const name = String(c.name);
    const tokens = nameTokens(name);
    const compact = tokens.join("");
    if (contactGroup(tokens, compact, personTable)) out.push(name.toLowerCase());
    else {
      const g = optionalGroup(tokens, personTable);
      if (g && optional?.[g]) out.push(name.toLowerCase());
    }
  }
  return [...new Set(out)];
}

/**
 * The protected columns of one table: the person's confirmed (or edited) list, else the proposal from its schema.
 * @param {object} config
 * @param {string} key the table's canonical key
 * @param {{ name: string, type?: string }[]|null} columns the schema, when known
 * @returns {{ columns: string[], confirmed: boolean } | null} null: no stored list and no schema to propose from
 */
export function protectedFor(config, key, columns) {
  const stored = config.explore?.protected?.[key];
  if (stored) return { columns: stored.columns, confirmed: stored.confirmed };
  if (!columns) return null;
  return { columns: proposeProtected(key.split(".").at(-1), columns, config.protection ?? DEFAULT_OPTIONAL), confirmed: false };
}
