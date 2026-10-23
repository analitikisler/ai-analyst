/* AI Analyst · the browser client. Everything on screen comes from the HTTP API (docs/CONTRACT.md):
   GET /api/state for the workspace, POST /api/actions/:name for every button (the same actions the agent
   uses as tools), POST /api/ask for the agent's server-sent events. The browser formats figures; it never
   computes them. */
import {
  t, tAct, L, nameOf, sourceName, setLang, getLang,
  fmtInt, fmtPct, fmtVal, shortVal, fmtDate, fmtMonth, fmtRange, fmtWhen
} from './i18n.js';

const S = {
  state: null,        // the latest GET /api/state
  metrics: null,      // list_metrics, for labels and units
  checks: null,       // list_checks, for check labels
  sources: null,      // list_sources, fetched when the view opens
  sourcesError: '',
  explain: {},        // explain_metric results by metric id
  explainError: {},
  series: {},         // run_query results for the dashed measured line, by key
  view: 'ask',
  live: null,         // the turn being streamed
  ctl: null,          // AbortController of the stream
  conversationId: null,
  turnErrors: {},     // stream errors the stored turn may not carry
  sql: {}             // copy buttons: key -> SQL text
};
const VIEWS = ['ask', 'dashboard', 'checks', 'metrics', 'sources', 'alerts', 'activity'];
const $ = (id) => document.getElementById(id);
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- preferences: language and theme ---------- */
function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
function stored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
setLang(stored('aia-lang') || ((navigator.language || '').toLowerCase().startsWith('tr') ? 'tr' : 'en'));
document.documentElement.lang = getLang();
const savedTheme = stored('aia-theme');
if (savedTheme === 'dark' || savedTheme === 'light') document.documentElement.setAttribute('data-theme', savedTheme);

/* ---------- HTTP ---------- */
class UIError extends Error { constructor(msg, code) { super(msg); this.code = code; } }
const headers = () => ({ 'content-type': 'application/json', 'accept-language': getLang() });

async function getState() {
  let res;
  try { res = await fetch('/api/state', { headers: { accept: 'application/json', 'accept-language': getLang() } }); }
  catch (e) { throw new UIError(t('err_network'), 'network'); }
  if (!res.ok) throw new UIError('HTTP ' + res.status);
  S.state = await res.json();
  if (!S.conversationId && S.state.conversations && S.state.conversations[0]) S.conversationId = S.state.conversations[0].id;
  return S.state;
}
async function action(name, input = {}) {
  let res;
  try { res = await fetch('/api/actions/' + encodeURIComponent(name), { method: 'POST', headers: headers(), body: JSON.stringify(input) }); }
  catch (e) { throw new UIError(t('err_network'), 'network'); }
  let body = null;
  try { body = await res.json(); } catch (e) { throw new UIError('HTTP ' + res.status); }
  if (!body || body.ok !== true) {
    const err = (body && body.error) || {};
    throw new UIError(err.message || err.code || 'HTTP ' + res.status, err.code);
  }
  return body.result;
}
const list = (x, key) => (Array.isArray(x) ? x : x && Array.isArray(x[key]) ? x[key] : []);

/* ---------- lookups over the API's data ---------- */
function metricInfo(id) { return (S.metrics || []).find((m) => m.id === id) || null; }
function metricLabel(id) { const m = metricInfo(id); return m ? L(m.label) : String(id || ''); }
function checkInfo(id) { return (S.checks || []).find((c) => c.id === id) || null; }
function checkLabel(id, r) { if (r && r.label) return L(r.label); const c = checkInfo(id); return c ? L(c.label) : String(id || ''); }
function checkUnit(r) {
  if (r.unit) return r.unit;
  const m = metricInfo(r.expected && r.expected.metric);
  if (m && m.unit) return m.unit;
  return /revenue|spend/.test(String(r.expected && r.expected.metric)) ? 'try' : 'count';
}
function dimName(dim, key) {
  if (dim === 'channel' || dim === 'device') return nameOf(dim, key);
  if (dim === 'day' || dim === 'week') return fmtDate(key);
  if (dim === 'month') return fmtMonth(key);
  return nameOf('device', key) !== String(key) ? nameOf('device', key) : nameOf('channel', key);
}
function filtersText(f) {
  if (!f) return '';
  return ['channel', 'device'].filter((k) => f[k] != null && f[k] !== '').map((k) => [].concat(f[k]).map((v) => nameOf(k, v)).join(', ')).join(' · ');
}
function allAnswers() {
  const out = new Map();
  const st = S.state || {};
  (st.pins || []).forEach((p) => { if (p.answer) out.set(p.answer.id, p.answer); });
  (st.conversations || []).forEach((c) => (c.turns || []).forEach((tu) => (tu.answers || []).forEach((a) => out.set(a.id, a))));
  if (S.live) S.live.answers.forEach((a) => out.set(a.id, a));
  return out;
}
function pinFor(answerId) { return ((S.state && S.state.pins) || []).find((p) => p.answer_id === answerId || (p.answer && p.answer.id === answerId)) || null; }
function autoTitle(a) {
  const q = a.query || {};
  const f = filtersText(q.filters);
  return [L(a.metric && a.metric.label) || metricLabel(q.metric), f, fmtRange(q.from, q.to)].filter(Boolean).join(' · ');
}
function aTitle(a) { return L(a.title) || autoTitle(a); }

/* ---------- small markup helpers ---------- */
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function ico(id, cls) { return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#' + id + '"/></svg>'; }
function status(tone, word) {
  const g = { ok: 'i-st-ok', bad: 'i-st-bad', risk: 'i-st-risk', warn: 'i-st-warn', info: 'i-check' }[tone];
  return '<span class="status" data-tone="' + tone + '">' + ico(g) + '<span>' + esc(word) + '</span></span>';
}
function verdictStatus(r) {
  if (r.verdict === 'adds_up') return status('ok', t('adds'));
  if (r.verdict === 'insufficient_data') return status('warn', t('insufficient'));
  return status('bad', t('notadds'));
}
function errLine(msg) { return '<p class="err" role="alert">' + ico('i-st-bad') + esc(msg) + '</p>'; }
function who(actor) {
  const w = actor === 'agent' || actor === 'planner' ? 'agent' : actor === 'system' ? 'system' : 'person';
  return '<span class="who" data-who="' + (w === 'agent' ? 'agent' : 'you') + '">' + esc(w === 'agent' ? t('agent') : w === 'system' ? t('system') : t('you')) + '</span>';
}
function head(title, lead, extra) {
  return '<header class="vhead"><div class="vhead__row"><h1>' + esc(title) + '</h1>' + (extra || '') + '</div><p>' + esc(lead) + '</p></header>';
}
function hlSQL(sql) {
  return esc(sql)
    .replace(/\b(SELECT|FROM|WHERE|AND|OR|NOT|NULL|IS|GROUP BY|ORDER BY|AS|BETWEEN|IN|DESC|ASC|TRUE|FALSE|COUNT|DISTINCT|SUM|SAFE_DIVIDE|NULLIF|COALESCE|DATE_TRUNC|WEEK|MONTH|MONDAY|CAST|DATE|WITH|CASE|WHEN|THEN|ELSE|END|LIMIT|JOIN|LEFT|ON|ROUND)\b/g, '<span class="k">$1</span>')
    .replace(/(&#39;[^&]*?&#39;)/g, '<span class="s">$1</span>')
    .replace(/(--[^\n]*)/g, '<span class="c">$1</span>');
}
function codeblock(key, path, sql, label) {
  S.sql[key] = sql;
  return '<div class="codeblock"><div class="codeblock__bar"><span class="codeblock__path">' + esc(path) + '</span>' +
    '<button type="button" class="copy-button" data-copy="' + esc(key) + '" data-k="copy:' + esc(key) + '" aria-label="' + esc(t('copy_sql') + (label ? ', ' + label : '')) + '">' + ico('i-copy') + '<span>' + esc(t('copy_sql')) + '</span></button></div>' +
    '<pre tabindex="0" aria-label="' + esc('SQL' + (label ? ', ' + label : '')) + '"><code>' + hlSQL(sql) + '</code></pre></div>';
}

/* ---------- charts ---------- */
function niceCeil(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function lineChart(q, label, opts = {}) {
  const W = opts.w || 640, H = opts.h || 220, Lm = 52, R = 64, T = 12, B = 26;
  const pts = (q.rows || []).filter((r) => r.value != null);
  if (pts.length < 2) return barsChart(q);
  const vals = pts.map((r) => +r.value).concat((opts.series2 || []).filter((v) => v != null));
  const max = Math.max(...vals), min = Math.min(...vals);
  const lo = q.unit === 'pct' || q.unit === 'ratio' ? min * 0.9 : 0;
  const hi = niceCeil(max);
  const x = (i) => Lm + (W - Lm - R) * (i / (pts.length - 1));
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">';
  if (opts.band) {
    const bi = pts.findIndex((r) => r.key >= opts.band.from);
    if (bi > 0) s += '<rect class="band" x="' + x(bi - 0.5) + '" y="' + T + '" width="' + (x(pts.length - 1) - x(bi - 0.5)) + '" height="' + (H - T - B) + '"/><text class="bandlabel" x="' + (x(bi - 0.5) + 4) + '" y="' + (T + 12) + '">' + esc(opts.band.label) + '</text>';
  }
  s += '<g class="grid">' + ticks.map((tv) => '<line x1="' + Lm + '" x2="' + (W - R) + '" y1="' + y(tv) + '" y2="' + y(tv) + '"/>').join('') + '</g>';
  s += '<g class="axis">' + ticks.map((tv) => '<text x="' + (Lm - 8) + '" y="' + (y(tv) + 4) + '" text-anchor="end">' + esc(shortVal(tv, q.unit)) + '</text>').join('');
  const every = Math.ceil(pts.length / 6);
  pts.forEach((r, i) => {
    if ((i % every === 0 && (pts.length - 1 - i >= every * 0.6 || i === 0)) || i === pts.length - 1) s += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(dimName(q.group_by, r.key)) + '</text>';
  });
  s += '</g>';
  const d = pts.map((r, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(+r.value).toFixed(1)).join(' ');
  s += '<path class="area" d="' + d + ' L' + x(pts.length - 1).toFixed(1) + ' ' + y(lo) + ' L' + x(0) + ' ' + y(lo) + ' Z"/>';
  s += '<path class="line" d="' + d + '"/>';
  if (opts.series2) {
    const d2 = opts.series2.map((v, i) => (v == null ? null : (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1))).filter(Boolean).join(' ').replace(/^L/, 'M');
    s += '<path class="line" data-series="2" d="' + d2 + '"/>';
  }
  const last = pts[pts.length - 1];
  s += '<circle class="dot" cx="' + x(pts.length - 1) + '" cy="' + y(+last.value) + '" r="4"/><text class="endlabel" x="' + (x(pts.length - 1) + 8) + '" y="' + (y(+last.value) + 4) + '">' + esc(shortVal(+last.value, q.unit)) + '</text>';
  s += '</svg>';
  const legend = opts.series2 ? '<div class="legend"><span><i></i>' + esc(opts.l1) + '</span><span><i data-series="2"></i>' + esc(opts.l2) + '</span></div>' : '';
  return '<div class="chart">' + s + legend + '</div>';
}
function barsChart(q) {
  const rows = q.rows || [];
  const max = Math.max(...rows.map((r) => +r.value || 0)) || 1;
  return '<div class="hbars" role="list">' + rows.map((r) => {
    const v = fmtVal(r.value, q.unit);
    return '<span class="hbars__label" role="listitem">' + esc(dimName(q.group_by, r.key)) + '<span class="sr"> · ' + esc(v) + '</span></span><span class="hbars__track" aria-hidden="true"><span class="hbars__fill" style="--v:' + ((+r.value || 0) / max * 100).toFixed(1) + '%"></span></span><span class="hbars__v" aria-hidden="true">' + esc(v) + '</span>';
  }).join('') + '</div>';
}
function seriesKey(metric, q) { return [metric, q.from, q.to, JSON.stringify(q.filters || {})].join('|'); }
/** The GA4-vs-orders daily answer draws both sides: the source solid, the measured dashed. The second
    series comes from the API (run_query), never from arithmetic here. */
function pairedSeries(q, r) {
  if (!r || r.check !== 'ga4_vs_orders' || q.group_by !== 'day' || !r.expected || !r.measured) return null;
  const qIsExpected = q.metric === r.expected.metric;
  if (!qIsExpected && q.metric !== r.measured.metric) return null;
  const other = qIsExpected ? r.measured.metric : r.expected.metric;
  return { key: seriesKey(other, q), other, qIsExpected };
}
function chartFor(q, r, mLabel, opts = {}) {
  const label = mLabel + ', ' + fmtRange(q.from, q.to);
  if (q.group_by === 'none') {
    return '<div class="metric"' + (opts.highlight ? ' data-variant="highlight"' : '') + '><span class="metric__value">' + esc(fmtVal(q.total, q.unit)) + '</span><span class="metric__label">' + esc(label.replace(', ', ' · ')) + '</span></div>';
  }
  if (q.group_by === 'channel' || q.group_by === 'device') return barsChart(q);
  const o = {};
  const pair = opts.pair !== false ? pairedSeries(q, r) : null;
  let qq = q;
  if (pair) {
    const got = S.series[pair.key];
    if (got && got.rows) {
      const byKey = new Map(got.rows.map((x) => [x.key, x.value]));
      if (pair.qIsExpected) o.series2 = q.rows.map((x) => (byKey.has(x.key) ? +byKey.get(x.key) : null));
      else { qq = Object.assign({}, q, { rows: q.rows.map((x) => ({ key: x.key, value: byKey.has(x.key) ? byKey.get(x.key) : null })) }); o.series2 = q.rows.map((x) => +x.value); }
      o.l1 = L(r.expected.label) || metricLabel(r.expected.metric);
      o.l2 = L(r.measured.label) || metricLabel(r.measured.metric);
    } else if (!got) {
      S.series[pair.key] = { pending: true };
      action('run_query', { metric: pair.other, group_by: 'day', from: q.from, to: q.to, ...(q.filters && Object.keys(q.filters).length ? { filters: q.filters } : {}) })
        .then((res) => { S.series[pair.key] = res || { rows: [] }; render(); })
        .catch(() => { S.series[pair.key] = { failed: true }; });
    }
    if (r.out_of_tolerance_since && r.out_of_tolerance_since >= q.from) {
      const rel = (r.findings || []).map((f) => /\bv\d+(?:\.\d+)+\b/.exec(L(f.text)) || /\bv\d+(?:\.\d+)+\b/.exec((f.text && f.text.en) || '')).find(Boolean);
      o.band = { from: r.out_of_tolerance_since, label: rel ? rel[0] : fmtDate(r.out_of_tolerance_since) };
    }
  }
  return lineChart(qq, label, Object.assign(o, opts.size || {}));
}

/* ---------- the tally ---------- */
// Outline = the source of truth, blue = measured, hatch = the gap. Tracks are sized to their value.
function tally(r, withMark) {
  const unit = checkUnit(r);
  const e = +((r.expected && r.expected.value) || 0), mm = +((r.measured && r.measured.value) || 0);
  const max = Math.max(e, mm) || 1;
  const under = mm <= e;
  const we = (e / max * 100).toFixed(1), wm = (mm / max * 100).toFixed(1);
  const vM = under ? (e ? mm / e : 0) : 1;
  const fv = (v) => fmtVal(v, unit === 'try' ? 'try' : 'count');
  const dp = r.delta_pct;
  const diffWord = dp == null ? '' : dp === 0 ? t('same') : under ? t('under', { p: fmtPct(Math.abs(dp), 1) }) : t('over', { p: fmtPct(Math.abs(dp), 1) });
  const eL = L(r.expected && r.expected.label) || metricLabel(r.expected && r.expected.metric);
  const mL = L(r.measured && r.measured.label) || metricLabel(r.measured && r.measured.metric);
  return '<div class="tally-bars">' +
    '<span class="tally-bars__label">' + esc(eL) + '</span><span class="tally-bars__track" aria-hidden="true" style="width:' + we + '%"></span><span class="tally-bars__value">' + esc(fv(e)) + '</span>' +
    '<span class="tally-bars__label">' + esc(mL) + '</span><span class="tally-bars__track" aria-hidden="true" style="width:' + (under ? we : wm) + '%;--v:' + vM.toFixed(4) + '"></span><span class="tally-bars__value">' + esc(fv(mm)) + '</span>' +
    '</div>' +
    '<div class="tally__sum" style="display:flex"><span class="tally__label">' + esc(t('diff')) + '</span><span class="tally__answer"' + (withMark ? '' : ' data-mark="none"') + '><span class="tally__delta">Δ</span> ' + esc(fmtPct(dp, 1, true)) + '</span>' + verdictStatus(r) + '</div>' +
    '<p class="text" data-variant="meta">' + esc([diffWord, t('tol', { p: fmtPct(r.tolerance, 0) }), fmtRange(r.from, r.to)].filter(Boolean).join(' · ')) + '</p>';
}
function breakdownTable(r) {
  const unit = checkUnit(r);
  const dim = r.breakdown_by || (checkInfo(r.check) && checkInfo(r.check).breakdown) || 'device';
  const cap = dim === 'device' ? t('a_split') : dim;
  return '<div class="table" role="region" tabindex="0" aria-label="' + esc(cap) + '"><table style="min-width:0"><thead><tr><th scope="col">' + esc(cap) + '</th><th scope="col" data-num>' + esc(t('plan')) + '</th><th scope="col" data-num>' + esc(t('sent')) + '</th><th scope="col" data-num>Δ</th></tr></thead><tbody>' +
    (r.breakdown || []).map((b) => {
      const bad = b.verdict ? b.verdict === 'does_not_add_up' : Math.abs(b.delta_pct) > r.tolerance;
      const warn = b.verdict === 'insufficient_data';
      const pct = fmtPct(b.delta_pct, 1, true);
      return '<tr><th scope="row">' + esc(dimName(dim, b.key)) + '</th><td data-num>' + esc(fmtVal(b.expected, unit)) + '</td><td data-num>' + esc(fmtVal(b.measured, unit)) + '</td><td data-num>' + (warn ? status('warn', pct) : bad ? status('bad', pct) : status('ok', pct)) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}
function findingsHTML(r) {
  return (r.findings || []).map((f) => '<div class="finding"><span class="finding__by">' + esc(t('finding') + ' · ' + (sourceName(f.source) || 'AI Tag Debugger')) + '</span><span>' + esc(L(f.text)) + '</span></div>').join('');
}

/* ---------- the answer card ---------- */
function answerCard(a) {
  const q = a.query || { rows: [] }, r = a.check || null, m = a.metric || {};
  const mLabel = L(m.label) || metricLabel(q.metric);
  const pin = pinFor(a.id);
  const title = aTitle(a);
  let h = '<article class="answer" id="ans-' + esc(a.id) + '" aria-label="' + esc(title) + '">';
  h += '<div class="answer__top"><span class="answer__label">' + esc(title) + '</span>' + (a.created_by === 'planner' ? '<span class="tag" data-variant="plain">' + esc(t('steps_offline')) + '</span>' : '') + '</div>';
  h += '<div class="answer__says"><p class="answer__lead">' + esc(a.sentence) + '</p>';
  if (a.validation && a.validation.ok === false) {
    const um = (a.validation.unmatched || []).join(', ');
    h += '<span class="answer__unchecked">' + status('warn', t('not_checked')) + (um ? '<span class="text" data-variant="meta">' + esc(t('not_checked_why', { n: um })) + '</span>' : '') + '</span>';
  }
  h += '</div>';
  h += '<div class="answer__grid"' + (r ? ' data-split' : '') + '>';
  h += '<section class="answer__panel" aria-label="' + esc(t('a_chart')) + '"><span class="answer__label">' + esc([t('a_chart'), mLabel, filtersText(q.filters), fmtRange(q.from, q.to)].filter(Boolean).join(' · ')) + '</span>' + chartFor(q, r, mLabel, { highlight: !r }) + '</section>';
  if (r) {
    h += '<section class="answer__panel" aria-label="' + esc(t('a_check')) + '"><span class="answer__label">' + esc(t('a_check')) + '</span>' + tally(r, true) +
      (r.verdict === 'does_not_add_up' && (r.breakdown || []).length ? breakdownTable(r) : '') + findingsHTML(r) + '</section>';
  }
  h += '</div>';
  const ws = (S.state && S.state.workspace) || {};
  h += '<dl class="answer__def"><dt>' + esc(t('a_def') + ' · ' + mLabel + (m.version != null ? ' v' + m.version : (q.metric_version != null ? ' v' + q.metric_version : ''))) + '</dt><dd>' + esc(L(m.description)) + '</dd>' +
    '<dd class="answer__meta"><span class="text" data-variant="meta">' + esc(t('a_src') + ': ' + sourceName(m.source)) + '</span><span class="text" data-variant="meta">' + esc(freshText(ws)) + '</span></dd></dl>';
  const engine = (q.dialect || 'sql') + (q.dialect === 'duckdb' ? ' · demo warehouse' : '');
  h += '<details class="disclosure" data-k="sql:' + esc(a.id) + '"><summary><span>' + esc(t('a_sql')) + '</span>' + ico('i-chevron', 'disclosure__icon') + '</summary><div class="answer__sql">' +
    (q.sql ? codeblock(a.id + ':q', engine + ' · ' + t('a_query'), q.sql, t('a_query')) : '') +
    (r && r.sql && r.sql.expected ? codeblock(a.id + ':e', engine + ' · ' + t('a_expected'), r.sql.expected, t('a_expected')) : '') +
    (r && r.sql && r.sql.measured ? codeblock(a.id + ':m', engine + ' · ' + t('a_measured'), r.sql.measured, t('a_measured')) : '') + '</div></details>';
  h += '<div class="answer__actions" data-err-host>' +
    '<button type="button" class="button" data-variant="' + (pin ? 'secondary' : 'primary') + '" data-size="sm" data-pin="' + esc(a.id) + '" data-k="pin:' + esc(a.id) + '" aria-pressed="' + (pin ? 'true' : 'false') + '">' + (pin ? ico('i-check', 'button__icon') : ico('i-dashboards', 'button__icon')) + '<span>' + esc(pin ? t('pinned') : t('pin')) + '</span></button>' +
    (r ? '<button type="button" class="button" data-variant="secondary" data-size="sm" data-alert="' + esc(a.id) + '" data-k="alert:' + esc(a.id) + '">' + ico('i-mail', 'button__icon') + '<span>' + esc(t('alert')) + '</span></button>' : '') + '</div>';
  const fu = a.followups || [];
  if (fu.length) h += '<div class="stack" data-gap="2"><span class="answer__label">' + esc(t('followups')) + '</span><div class="followups">' + fu.map((f) => '<button type="button" class="chip" data-ask="' + esc(f) + '" data-answer="' + esc(a.id) + '">' + esc(f) + '</button>').join('') + '</div></div>';
  return h + '</article>';
}
function approvalCard(al, turnLive) {
  const cur = ((S.state && S.state.alerts) || []).find((x) => x.id === al.id);
  if (!cur && !turnLive) return '<div class="approve">' + status('info', t('declined')) + '<span class="text" data-variant="meta">' + esc(L(al.title)) + '</span></div>';
  const a = cur || al;
  const desc = [L(a.title), L(a.rule), L(a.schedule)].filter(Boolean).join(' · ');
  return '<div class="approve" role="group" aria-label="' + esc(t('approve_title')) + '"><strong>' + esc(t('approve_title')) + '</strong><span>' + esc(desc) + '</span>' +
    (a.status === 'active' ? status('ok', t('approved')) : '<div class="approve__row" data-err-host><button type="button" class="button" data-variant="primary" data-size="sm" data-approve="' + esc(a.id) + '" data-k="approve:' + esc(a.id) + '">' + esc(t('approve')) + '</button><button type="button" class="button" data-variant="secondary" data-size="sm" data-decline="' + esc(a.id) + '" data-k="decline:' + esc(a.id) + '">' + esc(t('decline')) + '</button></div>') + '</div>';
}
function freshText(ws) {
  if (!ws || !ws.data_to) return '';
  return ws.refreshed_at ? t('fresh', { d: fmtDate(ws.data_to, true), t: fmtWhen(ws.refreshed_at) }) : t('fresh_short', { d: fmtDate(ws.data_to, true) });
}

/* ---------- Ask ---------- */
const SUGGEST = {
  en: ['Do GA4 purchases match our orders in the last 14 days?', 'Which channel has the highest ROAS in the last 28 days?', 'Do Meta conversions match our orders this month?', 'Revenue by week for the last 90 days'],
  tr: ['Son 14 günde GA4 satın almaları siparişlerle tutuyor mu?', 'Son 28 günde en yüksek ROAS hangi kanalda?', 'Bu ay Meta dönüşümleri siparişlerle tutuyor mu?', 'Son 90 günün haftalık cirosu']
};
function turnsToShow() {
  const conv = ((S.state && S.state.conversations) || []).find((c) => c.id === S.conversationId) || ((S.state && S.state.conversations) || [])[0];
  const turns = (conv && conv.turns) || [];
  if (S.live && !turns.some((x) => x.id === S.live.id)) return turns.concat([S.live]);
  return turns.map((x) => (S.live && x.id === S.live.id ? S.live : x));
}
function paintAsk() {
  const mode = S.state && S.state.agent && S.state.agent.mode;
  const running = !!(S.live && S.live.running);
  let h = '<div class="ask">' + head(t('ask_title'), t('ask_lead')) + '<div class="thread" id="thread">';
  turnsToShow().forEach((tu) => { h += '<div class="stack" data-gap="4" id="turn-' + esc(tu.id || 'live') + '">' + turnHTML(tu) + '</div>'; });
  h += '</div>';
  h += '<div class="composer"><div class="stack" data-gap="2"><span class="answer__label">' + esc(t('suggest')) + '</span><div class="followups">' +
    SUGGEST[getLang()].map((s) => '<button type="button" class="chip" data-ask="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div></div>' +
    '<form class="composer__box" id="ask-form"><label class="sr" for="q">' + esc(t('ask_title')) + '</label><textarea id="q" data-k="q" rows="1" placeholder="' + esc(t('ask_ph')) + '"></textarea>' +
    '<div class="cluster" data-gap="2"><button type="submit" class="button" data-variant="primary" id="ask-btn" data-k="ask-btn"' + (running ? ' disabled' : '') + '>' + esc(t('ask_btn')) + ico('i-arrow', 'button__icon') + '</button>' +
    '<button type="button" class="button" data-variant="secondary" id="stop-btn" data-k="stop-btn"' + (running ? '' : ' hidden') + (S.live && S.live.stopping ? ' disabled' : '') + '>' + esc(S.live && S.live.stopping ? t('stopping') : t('stop_btn')) + '</button></div></form>' +
    '<div class="composer__foot"><span class="text" data-variant="meta">' + esc(t('ask_hint')) + '</span><span class="text" data-variant="meta">' + esc(mode === 'model' ? t('steps_model') + (S.state.agent.model ? ' · ' + S.state.agent.model : '') : t('steps_offline')) + '</span></div></div></div>';
  return h;
}
function turnHTML(tu) {
  const live = !!(S.live && tu === S.live);
  const planner = tu.created_by ? tu.created_by === 'planner' : !(S.state && S.state.agent && S.state.agent.mode === 'model');
  let h = '<p class="q-bubble">' + esc(tu.question) + '</p>';
  h += '<div class="steps" role="region" tabindex="0" aria-label="' + esc(t('steps')) + '"><div class="steps__head"><span>' + esc(t('steps')) + '</span><span>' + esc(planner ? t('steps_offline') : t('steps_model')) + '</span></div>' +
    '<ol role="log" aria-label="' + esc(t('steps')) + '" id="steps-' + esc(tu.id || 'live') + '">' + stepsHTML(tu) + '</ol></div>';
  (tu.answers || []).forEach((a) => { h += answerCard(a); });
  (tu.approvals || []).forEach((al) => { h += approvalCard(typeof al === 'string' ? { id: al } : al, live); });
  const err = tu.error ? errText(tu.error) : S.turnErrors[tu.id];
  if (err) h += errLine(err);
  if (tu.text) h += '<p class="answer__note">' + esc(tu.text) + '</p>';
  return h;
}
function stepsHTML(tu) {
  return (tu.steps || []).map((s) => '<li>' + (s.ok === false ? '<span class="r">' + esc(s.tool) + '</span> ' : '<span class="k">' + esc(s.tool) + '</span> ') + '<span class="w">' + esc(s.summary || '') + '</span></li>').join('') +
    (tu.running ? '<li><span class="busy">' + esc((tu.steps || []).length ? t('working') : t('thinking')) + '</span></li>' : '');
}
function errText(e) {
  if (!e) return '';
  const code = typeof e === 'object' ? e.code : null;
  const msg = typeof e === 'object' ? e.message : String(e);
  if (code === 'rate_limited') return t('err_rate');
  if (code === 'stopped' || code === 'cancelled' || code === 'aborted') return t('err_stopped');
  if (code === 'network') return t('err_network');
  return msg ? t('err_generic') + ' (' + msg + ')' : t('err_generic');
}
function paintLiveTurn() {
  const tu = S.live;
  if (!tu || S.view !== 'ask') return;
  const el = $('turn-' + (tu.id || 'live')) || $('turn-live');
  if (!el) return render();
  if (tu.id && el.id !== 'turn-' + tu.id) el.id = 'turn-' + tu.id;
  el.innerHTML = turnHTML(tu);
}
function paintLiveSteps() {
  const tu = S.live;
  const ol = tu && ($('steps-' + (tu.id || 'live')) || $('steps-live'));
  if (ol) ol.innerHTML = stepsHTML(tu); else paintLiveTurn();
}
function announce(msg) { const el = $('announce'); el.textContent = ''; setTimeout(() => { el.textContent = msg; }, 30); }

async function ask(question, answerId) {
  question = String(question || '').trim();
  if (!question || (S.live && S.live.running)) return;
  const context = { view: S.view };
  const aid = answerId || lastAnswerId();
  if (aid) context.answer_id = aid;
  S.live = { id: null, question, steps: [], answers: [], approvals: [], text: '', error: null, running: true, created_by: null };
  if (S.view !== 'ask') { location.hash = '#ask'; S.view = 'ask'; markNav(); }
  render();
  const input = $('q'); if (input) { input.value = ''; input.focus({ preventScroll: true }); }
  const last = $('turn-live'); if (last) last.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
  announce(t('working_sr'));
  const live = S.live;
  const ctl = new AbortController(); S.ctl = ctl;
  try {
    const res = await fetch('/api/ask', { method: 'POST', headers: { ...headers(), accept: 'text/event-stream' }, signal: ctl.signal,
      body: JSON.stringify({ question, lang: getLang(), ...(S.conversationId ? { conversation_id: S.conversationId } : {}), context }) });
    if (!res.ok || !res.body) {
      let err = { code: 'http_' + res.status, message: 'HTTP ' + res.status };
      try { const b = await res.json(); if (b && b.error) err = b.error; } catch (e) { /* not JSON */ }
      live.error = err;
    } else {
      await readStream(res.body, live);
    }
  } catch (e) {
    live.error = ctl.signal.aborted ? { code: 'stopped' } : { code: 'network' };
  }
  live.running = false;
  if (live.id && live.error) S.turnErrors[live.id] = errText(live.error);
  try { await getState(); } catch (e) { /* keep what the stream gave */ }
  const stored = turnsToShow().some((x) => x !== live && x.id === live.id);
  if (stored) S.live = null;
  paintChrome();
  if (S.view === 'ask') {
    render();
    const el = live.id && $('turn-' + live.id);
    if (el) el.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
  }
  const ans = live.answers[live.answers.length - 1];
  announce(ans ? t('ready_sr', { s: ans.sentence }) : live.error ? errText(live.error) : t('done_sr'));
}
async function readStream(body, live) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const sep = /\r?\n\r?\n/;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let m;
    while ((m = sep.exec(buf))) {
      const block = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      onEvent(block, live);
    }
  }
  if (buf.trim()) onEvent(buf, live);
}
function onEvent(block, live) {
  let type = 'message';
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  let d = {};
  try { d = data.length ? JSON.parse(data.join('\n')) : {}; } catch (e) { return; }
  if (S.live !== live) return;
  if (type === 'turn') {
    const old = live.id;
    live.id = d.turn_id || live.id;
    if (d.conversation_id) S.conversationId = d.conversation_id;
    const el = $('turn-' + (old || 'live')); if (el) el.id = 'turn-' + live.id;
    const ol = $('steps-' + (old || 'live')); if (ol) ol.id = 'steps-' + live.id;
  } else if (type === 'step') { live.steps.push(d); paintLiveSteps(); }
  else if (type === 'answer' && d.answer) { live.answers.push(d.answer); if (d.answer.created_by) live.created_by = d.answer.created_by; paintLiveTurn(); }
  else if (type === 'approval' && d.alert) { live.approvals.push(d.alert); paintLiveTurn(); announce(t('approval_sr', { s: L(d.alert.title) })); }
  else if (type === 'text') {
    const s = String(d.text || '');
    live.text = s.startsWith(live.text) ? s : live.text + s;
    paintLiveTurn();
  } else if (type === 'error') { live.error = d; paintLiveTurn(); }
}
function lastAnswerId() {
  const turns = turnsToShow();
  for (let i = turns.length - 1; i >= 0; i--) { const a = turns[i].answers || []; if (a.length) return a[a.length - 1].id; }
  return null;
}
async function stop() {
  const live = S.live;
  if (!live || !live.running) return;
  live.stopping = true;
  const sb = $('stop-btn'); if (sb) { sb.disabled = true; sb.textContent = t('stopping'); }
  if (live.id) { try { await fetch('/api/turns/' + encodeURIComponent(live.id) + '/stop', { method: 'POST', headers: headers(), body: '{}' }); } catch (e) { /* abort below */ } }
  // If the server does not close the stream soon, stop reading it.
  setTimeout(() => { if (live.running && S.ctl) S.ctl.abort(); }, live.id ? 4000 : 0);
}

/* ---------- Dashboard ---------- */
function paintDashboard() {
  const pins = (S.state && S.state.pins) || [];
  let h = head(t('dash_title'), t('dash_lead'));
  if (!pins.length) return h + '<div class="empty"><p>' + esc(t('dash_empty')) + '</p><a class="button" data-variant="primary" href="#ask">' + esc(t('open_ask')) + ico('i-arrow', 'button__icon') + '</a></div>';
  h += '<div class="tiles">' + pins.map((p) => {
    const a = p.answer || {}, q = a.query || { rows: [] }, r = a.check;
    const top = q.group_by === 'channel' && q.rows && q.rows[0];
    const fig = top ? fmtVal(top.value, q.unit) : fmtVal(q.total, q.unit);
    const mLabel = L(a.metric && a.metric.label) || metricLabel(q.metric);
    const figLabel = top ? nameOf('channel', top.key) : mLabel;
    const pt = L(p.title) || aTitle(a);
    return '<article class="tile" aria-label="' + esc(pt) + '"><div class="tile__head" data-err-host><span class="tile__title">' + esc(pt) + '</span><button type="button" class="icon-button" data-unpin="' + esc(p.id) + '" data-k="unpin:' + esc(p.id) + '" aria-label="' + esc(t('unpin') + ': ' + pt) + '">' + ico('i-close') + '</button></div>' +
      '<div class="metric"><span class="tile__fig">' + esc(fig) + '</span><span class="metric__label">' + esc(figLabel + ' · ' + fmtRange(q.from, q.to)) + '</span></div>' +
      (['day', 'week', 'month'].includes(q.group_by) ? chartFor(q, r, mLabel, { pair: false, size: { w: 420, h: 150 } }) : q.group_by === 'none' ? '' : barsChart(q)) +
      '<div class="tile__foot">' + (r ? verdictStatus(r) + '<span class="text" data-variant="meta">Δ ' + esc(fmtPct(r.delta_pct, 1, true)) + '</span>' : '<span class="text" data-variant="meta">' + esc(t('no_check')) + '</span>') +
      who(p.created_by) + '</div></article>';
  }).join('') + '</div>';
  return h;
}

/* ---------- Checks ---------- */
function whyQ(r) {
  const fixed = {
    ga4_vs_orders: ['Why do GA4 purchases not match orders in the last 14 days?', 'Son 14 günde GA4 satın almaları neden siparişlerle tutmuyor?'],
    ga4_rev_vs_revenue: ['Does GA4 revenue match back-office revenue in the last 14 days?', 'Son 14 günde GA4 geliri arka ofis cirosuyla tutuyor mu?'],
    gads_vs_orders: ['Do Google Ads conversions match our orders in the last 14 days?', 'Son 14 günde Google Ads dönüşümleri siparişlerle tutuyor mu?'],
    meta_vs_orders: ['Why do Meta conversions not match our orders in the last 14 days?', 'Son 14 günde Meta dönüşümleri neden siparişlerle tutmuyor?']
  }[r.check];
  if (fixed) return fixed[getLang() === 'tr' ? 1 : 0];
  const range = fmtRange(r.from, r.to);
  return getLang() === 'tr' ? checkLabel(r.check, r) + ': ' + range + ' döneminde neden ' + (r.verdict === 'adds_up' ? 'tutuyor' : 'tutmuyor') + '?' : checkLabel(r.check, r) + ': why does it ' + (r.verdict === 'adds_up' ? 'add up' : 'not add up') + ' for ' + range + '?';
}
function paintChecks() {
  const checks = (S.state && S.state.checks) || [];
  let h = head(t('checks_title'), t('checks_lead'), '<span data-err-host class="cluster" data-gap="2"><button type="button" class="button" data-variant="secondary" data-size="sm" id="run-checks" data-k="run-checks">' + esc(t('run_all')) + '</button></span>');
  if (!checks.length) return h + '<div class="empty"><p>' + esc(t('never_run')) + '</p></div>';
  const ran = (S.state.check_run && S.state.check_run.created_at) || checks.map((c) => c.ran_at).filter(Boolean).sort().pop();
  h += '<p class="text" data-variant="meta" style="margin-bottom:var(--space-4)">' + esc([ran ? t('last_run', { t: fmtWhen(ran) }) : '', fmtRange(checks[0].from, checks[0].to)].filter(Boolean).join(' · ')) + '</p><div class="rows">';
  checks.forEach((r) => {
    h += '<div class="row" data-cols="check"><div class="stack" data-gap="2"><span class="row__title">' + esc(checkLabel(r.check, r)) + '</span><span class="row__sub">' + esc(t('tol', { p: fmtPct(r.tolerance, 0) })) + '</span>' + verdictStatus(r) +
      (r.verdict !== 'adds_up' && r.out_of_tolerance_since ? '<span class="row__sub">' + esc(t('first_out', { d: fmtDate(r.out_of_tolerance_since, true) })) + '</span>' : '') + '</div>' +
      '<div class="stack" data-gap="3">' + tally(r, false) + '</div>' +
      '<div class="stack" data-gap="3">' + findingsHTML(r) +
      '<div class="row__end" data-err-host><button type="button" class="button" data-variant="text" data-ask="' + esc(whyQ(r)) + '">' + esc(t('ask_why')) + ico('i-arrow', 'button__icon') + '</button><button type="button" class="button" data-variant="secondary" data-size="sm" data-alert-check="' + esc(r.check) + '" data-title="' + esc(checkLabel(r.check, r)) + '" data-k="alert-check:' + esc(r.check) + '">' + esc(t('alert')) + '</button></div></div></div>';
  });
  return h + '</div>';
}

/* ---------- Metrics ---------- */
function paintMetrics() {
  let h = head(t('metrics_title'), t('metrics_lead'));
  if (S.metrics == null) return h + (S.metricsError ? errLine(t('err_load', { m: S.metricsError })) : '<p class="busy load">' + esc(t('loading')) + '</p>');
  h += '<div class="metric-list" style="max-width:60rem;border-top:var(--border-width-hair) solid var(--color-border)">';
  S.metrics.forEach((m) => {
    const ex = S.explain[m.id];
    h += '<details class="disclosure" data-k="metric:' + esc(m.id) + '" data-metric="' + esc(m.id) + '"><summary><span>' + esc(L(m.label)) + ' <code class="text" data-variant="meta">' + esc(m.id) + '</code></span><span class="cluster" data-gap="3"><span class="text" data-variant="meta">' +
      esc([m.version != null ? 'v' + m.version : '', m.unit ? nameOf('unit', m.unit) : ''].filter(Boolean).join(' · ')) + '</span>' + ico('i-chevron', 'disclosure__icon') + '</span></summary>' +
      '<div class="disclosure__body">' + (ex ? explainBody(m, ex) : S.explainError[m.id] ? errLine(t('err_action', { m: S.explainError[m.id] })) : '<p>' + esc(L(m.description)) + '</p><p class="busy">' + esc(t('loading')) + '</p>') + '</div></details>';
  });
  return h + '</div>';
}
function explainBody(m, ex) {
  const d = Object.assign({}, m, ex && ex.metric && typeof ex.metric === 'object' ? ex.metric : {}, ex && typeof ex === 'object' ? ex : {});
  if (ex && ex.metric && typeof ex.metric === 'object') d.metric = ex.metric.id;
  const sql = [d.sql, d.sql_example, d.example_sql, d.compiled_sql, d.example && d.example.sql].find((x) => typeof x === 'string');
  const checkId = typeof d.check === 'string' ? d.check : d.check && d.check.id;
  const def = d.definition && typeof d.definition === 'object' ? d.definition : d;
  const formula = def.sum ? 'SUM(' + def.sum + ')' : def.ratio ? 'SUM(' + def.ratio.numerator + ') / SUM(' + def.ratio.denominator + ')' : '';
  const where = d.where && typeof d.where === 'object' ? Object.keys(d.where).map((k) => k + ' ∈ ' + [].concat(d.where[k]).join(', ')).join(' · ') : '';
  const kv = [
    [t('m_source'), sourceName(d.source)], [t('m_unit'), d.unit ? nameOf('unit', d.unit) : ''], [t('m_version'), d.version != null ? 'v' + d.version : ''],
    [t('m_owner'), d.owner || ''], [t('m_check'), checkId ? checkLabel(checkId) : t('m_none')],
    [t('m_dims'), Array.isArray(d.dimensions) ? d.dimensions.join(', ') : ''], [t('m_formula'), formula, true], [t('m_filter'), where, true]
  ].filter((x) => x[1]);
  return '<p>' + esc(L(d.description)) + '</p><dl class="kv">' + kv.map(([k, v, code]) => '<dt>' + esc(k) + '</dt><dd>' + (code ? '<code>' + esc(v) + '</code>' : esc(v)) + '</dd>').join('') + '</dl>' +
    (sql ? codeblock('metric:' + m.id, (d.dialect || 'sql') + ' · metrics/' + m.id + '.yaml', sql, L(m.label)) : '');
}
async function loadExplain(id) {
  if (S.explain[id] || S.explainError[id] === 'loading') return;
  S.explainError[id] = 'loading';
  try { S.explain[id] = await action('explain_metric', { metric: id }); delete S.explainError[id]; }
  catch (e) { S.explainError[id] = e.message; }
  if (S.view === 'metrics') render();
}

/* ---------- Sources ---------- */
function paintSources() {
  let h = head(t('sources_title'), t('sources_lead'));
  if (S.sources == null) return h + (S.sourcesError ? errLine(t('err_load', { m: S.sourcesError })) : '<p class="busy load">' + esc(t('loading')) + '</p>');
  if (!S.sources.length) return h + '<div class="empty"><p>' + esc(t('sources_empty')) + '</p></div>';
  h += '<div class="rows" style="max-width:64rem">';
  S.sources.forEach((s) => {
    const name = L(s.label) || L(s.name) || sourceName(s.id) || s.id;
    const detail = L(s.description) || L(s.detail) || (Array.isArray(s.tables) ? s.tables.join(', ') : s.table || s.kind || '');
    const ok = s.connected != null ? !!s.connected : s.status ? /^(connected|ok|active)$/.test(s.status) : true;
    const rows = s.rows ?? s.row_count;
    const synced = s.last_sync ?? s.synced_at ?? s.refreshed_at;
    const meta = [rows != null ? fmtInt(rows) + ' ' + t('rows') : '', synced ? t('synced', { t: fmtWhen(synced) }) : ''].filter(Boolean).join(' · ');
    h += '<div class="row" data-cols="source"><div class="stack" data-gap="1"><span class="row__title">' + esc(name) + '</span>' + (detail ? '<span class="row__sub">' + esc(detail) + '</span>' : '') + '</div>' +
      '<div>' + (ok ? status('ok', t('connected')) : status('warn', t('not_connected'))) + '</div>' +
      '<div class="text" data-variant="meta">' + esc(meta) + '</div><div class="row__end"></div></div>';
  });
  return h + '</div>';
}
async function loadSources() {
  S.sourcesError = '';
  try { S.sources = list(await action('list_sources'), 'sources'); }
  catch (e) { S.sources = null; S.sourcesError = e.message; }
  if (S.view === 'sources') render();
}

/* ---------- Alerts ---------- */
function paintAlerts() {
  const alerts = (S.state && S.state.alerts) || [];
  const h = head(t('alerts_title'), t('alerts_lead'));
  if (!alerts.length) return h + '<div class="empty"><p>' + esc(t('alerts_empty')) + '</p></div>';
  return h + '<div class="rows" style="max-width:64rem">' + alerts.map((al) => {
    const sub = [L(al.rule), L(al.schedule)].filter(Boolean).join(' · ');
    return '<div class="row" data-cols="alert"><div class="stack" data-gap="1"><span class="row__title">' + esc(L(al.title)) + '</span>' + (sub ? '<span class="row__sub">' + esc(sub) + '</span>' : '') + '</div>' +
      '<div class="cluster" data-gap="3">' + (al.status === 'active' ? status('ok', t('a_active')) : status('warn', t('a_pending'))) + who(al.created_by) + '</div>' +
      '<div class="row__end" data-err-host>' + (al.status === 'pending'
        ? '<button type="button" class="button" data-variant="primary" data-size="sm" data-approve="' + esc(al.id) + '" data-k="approve:' + esc(al.id) + '">' + esc(t('approve')) + '</button><button type="button" class="button" data-variant="secondary" data-size="sm" data-decline="' + esc(al.id) + '" data-k="decline:' + esc(al.id) + '">' + esc(t('decline')) + '</button>'
        : '<button type="button" class="button" data-variant="secondary" data-size="sm" data-remove-alert="' + esc(al.id) + '" data-k="remove:' + esc(al.id) + '">' + esc(t('remove')) + '</button>') + '</div></div>';
  }).join('') + '</div>';
}

/* ---------- Activity ---------- */
function detailText(d) {
  if (d == null) return '';
  if (typeof d === 'string') return d;
  if (typeof d === 'object' && (d.en || d.tr)) return L(d);
  return L(d.title) || L(d.question) || L(d.summary) || L(d.text) || '';
}
function paintActivity() {
  const log = (S.state && S.state.activity) || [];
  let h = head(t('activity_title'), t('activity_lead'));
  if (!log.length) return h + '<div class="empty"><p>' + esc(t('activity_empty')) + '</p></div>';
  h += '<div class="rows" style="max-width:64rem">';
  log.forEach((e) => {
    let name = e.action;
    if (name === 'decide_alert' && e.detail && typeof e.detail === 'object' && 'approve' in e.detail) name = e.detail.approve ? 'approve_alert' : 'decline_alert';
    h += '<div class="row" data-cols="log"><span class="text" data-variant="meta">' + esc(fmtWhen(e.at)) + '</span>' + who(e.actor) +
      '<span><strong>' + esc(tAct(name, e.actor)) + '</strong> <span class="row__sub">' + esc(detailText(e.detail)) + '</span></span>' +
      '<span class="row__end" data-err-host>' + (e.undo ? (e.undone ? '<span class="text" data-variant="meta">' + esc(t('undone')) + '</span>' : '<button type="button" class="button" data-variant="text" data-undo="' + esc(e.id) + '" data-k="undo:' + esc(e.id) + '">' + esc(t('undo')) + '</button>') : '') + '</span></div>';
  });
  return h + '</div>';
}

/* ---------- rendering, navigation, chrome ---------- */
const PAINT = { ask: paintAsk, dashboard: paintDashboard, checks: paintChecks, metrics: paintMetrics, sources: paintSources, alerts: paintAlerts, activity: paintActivity };
function render(focusKey) {
  const v = $('view');
  if (!S.state) return;
  // Keep focus, open disclosures and the draft question across a re-render.
  const act = document.activeElement;
  const k = focusKey || (act && v.contains(act) ? act.getAttribute('data-k') : null);
  const open = [...v.querySelectorAll('details[open][data-k]')].map((d) => d.getAttribute('data-k'));
  const q = $('q');
  const draft = q ? { v: q.value, s: q.selectionStart, e: q.selectionEnd } : null;
  S.sql = {};
  v.innerHTML = PAINT[S.view]();
  open.forEach((key) => { const d = v.querySelector('details[data-k="' + CSS.escape(key) + '"]'); if (d) d.open = true; });
  const q2 = $('q');
  if (q2 && draft && !q2.value) { q2.value = draft.v; }
  if (k) {
    const el = v.querySelector('[data-k="' + CSS.escape(k) + '"]');
    if (el && !el.disabled && !el.hidden) { el.focus({ preventScroll: true }); if (el === q2 && draft) q2.setSelectionRange(draft.s, draft.e); }
    else if (k === 'ask-btn' || k === 'stop-btn') q2 && q2.focus({ preventScroll: true });
  }
}
function markNav() {
  document.querySelectorAll('.rail__item').forEach((b) => { if (b.dataset.view === S.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
}
function go(v, focus) {
  if (!VIEWS.includes(v)) v = 'ask';
  const changed = S.view !== v;
  S.view = v;
  markNav();
  render();
  if (changed) window.scrollTo(0, 0);
  if (focus) $('view').focus({ preventScroll: true });
  if (v === 'sources') loadSources();
  if (v === 'metrics' && S.metrics == null) loadMetrics().then(() => S.view === 'metrics' && render());
}
function paintCounts() {
  const st = S.state || {};
  const pins = (st.pins || []).length;
  $('n-pins').textContent = pins || '';
  const bad = (st.checks || []).filter((c) => c.verdict === 'does_not_add_up').length;
  const nc = $('n-checks');
  nc.textContent = bad ? bad + ' ×' : '';
  nc.dataset.tone = bad ? 'bad' : '';
  if (bad) nc.innerHTML = '<span aria-hidden="true">' + bad + ' ×</span><span class="sr">, ' + esc(t('checks_bad', { n: bad })) + '</span>'; else nc.textContent = '';
  const alerts = st.alerts || [];
  const pend = alerts.filter((a) => a.status === 'pending').length;
  const na = $('n-alerts');
  if (pend) na.innerHTML = '<span aria-hidden="true">' + pend + ' ?</span><span class="sr">, ' + esc(t(pend === 1 ? 'pending_n' : 'pending_nn', { n: pend })) + '</span>';
  else na.textContent = alerts.length || '';
  const rp = $('rail-pending');
  rp.hidden = !pend;
  rp.textContent = pend ? t(pend === 1 ? 'pending_n' : 'pending_nn', { n: pend }) : '';
}
function paintChrome() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-t-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.tLabel)); });
  document.querySelectorAll('.seg__b').forEach((b) => { b.setAttribute('aria-pressed', b.dataset.lang === getLang() ? 'true' : 'false'); });
  const st = S.state || {};
  const ws = st.workspace || {};
  $('ws-name').textContent = ws.name || '';
  $('demo-tag').hidden = !ws.demo;
  $('rail-demo').hidden = !ws.demo;
  $('freshness').textContent = freshText(ws);
  const mode = st.agent && st.agent.mode;
  $('agent-mode').textContent = mode === 'model' ? t('mode_model') : mode === 'planner' ? t('mode_planner') : t('mode_wait');
  if (mode === 'model' && st.agent.model) $('agent-mode').title = st.agent.model;
  document.title = (ws.name ? ws.name + ' · ' : '') + 'AI Analyst';
  paintTheme();
  paintCounts();
}
function isDark() {
  const a = document.documentElement.getAttribute('data-theme');
  if (a) return a === 'dark';
  return !(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
}
function paintTheme() {
  const dark = isDark();
  $('theme-ico').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  $('theme-btn').setAttribute('aria-label', dark ? t('theme_light') : t('theme_dark'));
}
let toastTimer;
function toast(msg) { const el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2400); }

/** Every button: the registry action, then a fresh /api/state. Errors stay next to the control. */
async function run(btn, name, input, okMsg) {
  const host = btn.closest('[data-err-host]') || btn.parentElement;
  host.querySelectorAll(':scope > .err').forEach((e) => e.remove());
  const fk = btn.getAttribute('data-k');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    const result = await action(name, input);
    await getState();
    paintChrome();
    render(fk);
    if (okMsg) toast(okMsg);
    return result;
  } catch (e) {
    btn.disabled = false; btn.removeAttribute('aria-busy');
    if (btn.isConnected) btn.focus({ preventScroll: true });
    if (host.isConnected) host.insertAdjacentHTML('beforeend', errLine(t('err_action', { m: e.message })));
    else toast(t('err_action', { m: e.message }));
    return null;
  }
}

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.lang) { setLang(d.lang); store('aia-lang', getLang()); paintChrome(); return render(); }
  if (b.id === 'theme-btn') { const next = isDark() ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); store('aia-theme', next); return paintTheme(); }
  if (b.id === 'stop-btn') return stop();
  if (b.id === 'run-checks') return run(b, 'run_all_checks', { days: 14 }, t('toast_run'));
  if (d.retry != null) return boot();
  if (d.ask) return ask(d.ask, d.answer || null);
  if (d.pin) {
    const pin = pinFor(d.pin);
    return pin ? run(b, 'unpin', { pin_id: pin.id }, t('toast_unpin')) : run(b, 'pin_answer', { answer_id: d.pin }, t('toast_pin'));
  }
  if (d.alert) {
    const a = allAnswers().get(d.alert);
    if (!a) return;
    const input = { title: a.check ? checkLabel(a.check.check, a.check) : aTitle(a), metric: a.query && a.query.metric };
    if (a.check) input.check = a.check.check;
    return run(b, 'create_alert', input, t('toast_alert'));
  }
  if (d.alertCheck) return run(b, 'create_alert', { check: d.alertCheck, title: d.title || checkLabel(d.alertCheck) }, t('toast_alert'));
  if (d.approve) return run(b, 'decide_alert', { alert_id: d.approve, approve: true }, t('toast_approved'));
  if (d.decline) return run(b, 'decide_alert', { alert_id: d.decline, approve: false }, t('toast_declined'));
  if (d.removeAlert) return run(b, 'remove_alert', { alert_id: d.removeAlert }, t('toast_removed'));
  if (d.unpin) return run(b, 'unpin', { pin_id: d.unpin }, t('toast_unpin'));
  if (d.undo) return run(b, 'undo', { activity_id: d.undo }, t('toast_undo'));
  if (d.copy) {
    const sql = S.sql[d.copy] || '';
    const label = b.querySelector('span');
    const done = () => { b.dataset.state = 'copied'; label.textContent = t('copied'); b.querySelector('use').setAttribute('href', '#i-check'); setTimeout(() => { b.dataset.state = ''; label.textContent = t('copy_sql'); b.querySelector('use').setAttribute('href', '#i-copy'); }, 1600); };
    try { navigator.clipboard.writeText(sql).then(done, () => selectCode(b)); } catch (e) { selectCode(b); }
  }
});
function selectCode(b) { const code = b.closest('.codeblock').querySelector('code'); const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
document.addEventListener('submit', (ev) => { if (ev.target.id === 'ask-form') { ev.preventDefault(); ask($('q').value); } });
document.addEventListener('keydown', (ev) => {
  if (ev.target.id === 'q' && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); ask(ev.target.value); }
  if (ev.key === 'Escape' && S.live && S.live.running) stop();
});
document.addEventListener('toggle', (ev) => { const d = ev.target; if (d.open && d.dataset && d.dataset.metric) loadExplain(d.dataset.metric); }, true);
window.addEventListener('hashchange', () => { const v = (location.hash || '').slice(1); if (VIEWS.includes(v) && v !== S.view) go(v, true); });
if (window.matchMedia) { try { window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', paintTheme); } catch (e) { /* old browsers */ } }

async function loadMetrics() {
  try { S.metrics = list(await action('list_metrics'), 'metrics'); S.metricsError = ''; }
  catch (e) { S.metricsError = e.message; }
}
async function loadChecks() {
  try { S.checks = list(await action('list_checks'), 'checks'); } catch (e) { /* labels fall back to ids */ }
}
async function boot() {
  const v = $('view');
  paintChrome();
  v.innerHTML = '<p class="busy load">' + esc(t('loading')) + '</p>';
  try {
    await Promise.all([getState(), loadMetrics(), loadChecks()]);
  } catch (e) {
    v.innerHTML = head(t('ask_title'), t('ask_lead')) + '<div class="empty">' + errLine(t('err_load', { m: e.message })) + '<button type="button" class="button" data-variant="secondary" data-retry>' + esc(t('retry')) + '</button></div>';
    return;
  }
  paintChrome();
  const start = (location.hash || '').slice(1);
  go(VIEWS.includes(start) ? start : 'ask');
}
boot();
