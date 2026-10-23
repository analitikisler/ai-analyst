/* AI Analyst · interface strings (en-GB and Turkish) and number/date formatting per language.
   The browser never computes a figure: these functions only format values the API returned. */

export const STR = {
  en: {
    skip: 'Skip to content', nav_label: 'Sections', lang_label: 'Language', by: 'by Analitik İşler',
    nav_ask: 'Ask', nav_dashboard: 'Dashboard', nav_checks: 'Checks', nav_metrics: 'Metrics', nav_sources: 'Sources', nav_alerts: 'Alerts', nav_activity: 'Activity',
    demo_note: 'Demo workspace. Every figure is generated sample data.', demo_tag: 'demo data',
    fresh: 'Data to {d} · refreshed {t}', fresh_short: 'Data to {d}',
    mode_model: 'Agent: Claude', mode_planner: 'Agent: built-in planner', mode_wait: 'Agent: connecting',
    checks_bad: '{n} do not add up', pending_n: '{n} needs approval', pending_nn: '{n} need approval',
    ask_title: 'Ask the data', ask_lead: 'Ask in Turkish or English. Every answer shows its query, its definition and a check against the source system.',
    ask_ph: 'e.g. Do GA4 purchases match our orders this month?', ask_btn: 'Ask', stop_btn: 'Stop', stopping: 'Stopping', ask_hint: 'Enter sends · Shift+Enter adds a line',
    suggest: 'Try a question', working: 'Working', thinking: 'Thinking',
    steps: 'Agent steps', steps_offline: 'built-in planner · no model call', steps_model: 'Claude · the same actions as the buttons',
    a_chart: 'Result', a_check: 'Check against the source', a_def: 'Definition', a_sql: 'SQL', a_src: 'Sources', a_split: 'By device', a_query: 'query', a_expected: 'check · source', a_measured: 'check · measured',
    pin: 'Pin to dashboard', pinned: 'Pinned', alert: 'Make an alert', copy_sql: 'Copy SQL', copied: 'Copied',
    followups: 'Follow-up questions', no_check: 'No source system to check this metric against.',
    not_checked: 'not checked', not_checked_why: 'Some figures in this sentence did not match the query: {n}.',
    plan: 'Source', sent: 'Measured', diff: 'Difference', adds: 'adds up', notadds: 'does not add up', insufficient: 'not enough data', tol: 'tolerance ±{p}',
    over: '{p} more than the source', under: '{p} less than the source', same: 'the same as the source',
    approve_title: 'The agent wants to create an alert', approve: 'Approve', decline: 'Decline', approved: 'Approved', declined: 'Declined',
    dash_title: 'Dashboard', dash_lead: 'Answers pinned by people and by the agent. Each tile keeps its query and its check.', unpin: 'Remove from dashboard',
    dash_empty: 'Nothing pinned yet. Ask a question and choose Pin to dashboard.', open_ask: 'Ask a question',
    checks_title: 'Checks', checks_lead: 'Each check compares a measured figure with the system that owns it. A check that does not add up names where the gap starts.',
    run_all: 'Run all checks', last_run: 'Last run {t}', never_run: 'No check run yet. Run all checks to see where the numbers stand.',
    ask_why: 'Ask why', finding: 'Linked finding', first_out: 'Out of tolerance since {d}',
    metrics_title: 'Metrics', metrics_lead: 'The definitions every answer uses. The agent cannot change a definition; a person approves each new version.',
    m_source: 'Source', m_owner: 'Owner', m_version: 'Version', m_check: 'Checked against', m_unit: 'Unit', m_none: 'none', m_dims: 'Breakdowns', m_filter: 'Fixed filter', m_formula: 'Formula',
    sources_title: 'Sources', sources_lead: 'Read-only connections. The tool reads them and never writes back.',
    connected: 'connected', not_connected: 'not connected', rows: 'rows', synced: 'synced {t}', sources_empty: 'No sources connected.',
    alerts_title: 'Alerts', alerts_lead: 'Checks and metrics watched on a schedule. Alerts the agent proposes wait for a person to approve them.',
    alerts_empty: 'No alerts yet. Make one from any answer or check.', a_active: 'active', a_pending: 'needs approval', remove: 'Remove',
    activity_title: 'Activity', activity_lead: 'Everything done in this workspace, by people and by the agent. Pins and alerts can be undone.',
    activity_empty: 'Nothing has happened in this workspace yet.',
    undo: 'Undo', undone: 'Undone', you: 'you', agent: 'agent', system: 'system',
    err_rate: 'Too many questions at once. Wait a minute and ask again.', err_generic: 'The agent stopped before it finished. Ask again, or rephrase the question.',
    err_stopped: 'Stopped. Nothing after the last step was run.', err_network: 'The server did not answer. Check that AI Analyst is running and try again.',
    err_action: 'That did not work: {m}', err_load: 'The workspace did not load: {m}', retry: 'Try again', loading: 'Loading',
    toast_pin: 'Pinned to the dashboard', toast_unpin: 'Removed from the dashboard', toast_alert: 'Alert created', toast_undo: 'Undone', toast_run: 'Checks run', toast_approved: 'Alert approved', toast_declined: 'Alert declined', toast_removed: 'Alert removed',
    theme_dark: 'Switch to dark theme', theme_light: 'Switch to light theme',
    working_sr: 'The agent is working', ready_sr: 'Answer ready: {s}', done_sr: 'The agent finished', approval_sr: 'Needs approval: {s}',
    act: {
      pin_answer: 'Pinned to the dashboard', unpin: 'Removed from the dashboard', create_alert: 'Created an alert', create_alert_agent: 'Proposed an alert',
      decide_alert: 'Decided on an alert', approve_alert: 'Approved an alert', decline_alert: 'Declined an alert', remove_alert: 'Removed an alert', undo: 'Undid',
      run_all_checks: 'Ran all checks', publish_answer: 'Published an answer', ask: 'Asked', run_query: 'Ran a query', reconcile: 'Ran a check'
    }
  },
  tr: {
    skip: 'İçeriğe geç', nav_label: 'Bölümler', lang_label: 'Dil', by: 'by Analitik İşler',
    nav_ask: 'Sor', nav_dashboard: 'Pano', nav_checks: 'Kontroller', nav_metrics: 'Metrikler', nav_sources: 'Kaynaklar', nav_alerts: 'Alarmlar', nav_activity: 'İşlem geçmişi',
    demo_note: 'Demo çalışma alanı. Tüm rakamlar üretilmiş örnek veridir.', demo_tag: 'demo veri',
    fresh: 'Veri {d} tarihine kadar · yenilenme {t}', fresh_short: 'Veri {d} tarihine kadar',
    mode_model: 'Ajan: Claude', mode_planner: 'Ajan: yerleşik planlayıcı', mode_wait: 'Ajan: bağlanıyor',
    checks_bad: '{n} tutmuyor', pending_n: '{n} onay bekliyor', pending_nn: '{n} onay bekliyor',
    ask_title: 'Veriye sor', ask_lead: 'Türkçe ya da İngilizce sorulabilir. Her yanıt sorgusunu, tanımını ve kaynak sistemle karşılaştırmasını gösterir.',
    ask_ph: 'ör. Bu ay GA4 satın almaları siparişlerle tutuyor mu?', ask_btn: 'Sor', stop_btn: 'Durdur', stopping: 'Durduruluyor', ask_hint: 'Enter gönderir · Shift+Enter yeni satır',
    suggest: 'Örnek sorular', working: 'Çalışıyor', thinking: 'Düşünüyor',
    steps: 'Ajan adımları', steps_offline: 'yerleşik planlayıcı · model çağrısı yok', steps_model: 'Claude · düğmelerle aynı işlemler',
    a_chart: 'Sonuç', a_check: 'Kaynakla karşılaştırma', a_def: 'Tanım', a_sql: 'SQL', a_src: 'Kaynaklar', a_split: 'Cihaza göre', a_query: 'sorgu', a_expected: 'kontrol · kaynak', a_measured: 'kontrol · ölçülen',
    pin: 'Panoya sabitle', pinned: 'Sabitlendi', alert: 'Alarm kur', copy_sql: 'SQL’i kopyala', copied: 'Kopyalandı',
    followups: 'Devam soruları', no_check: 'Bu metriği karşılaştıracak bir kaynak sistem yok.',
    not_checked: 'kontrol edilmedi', not_checked_why: 'Cümledeki bazı rakamlar sorguyla eşleşmedi: {n}.',
    plan: 'Kaynak', sent: 'Ölçülen', diff: 'Fark', adds: 'tutuyor', notadds: 'tutmuyor', insufficient: 'yeterli veri yok', tol: 'tolerans ±{p}',
    over: 'kaynaktan {p} fazla', under: 'kaynaktan {p} eksik', same: 'kaynakla aynı',
    approve_title: 'Ajan bir alarm kurmak istiyor', approve: 'Onayla', decline: 'Reddet', approved: 'Onaylandı', declined: 'Reddedildi',
    dash_title: 'Pano', dash_lead: 'Kişilerin ve ajanın sabitlediği yanıtlar. Her kutu sorgusunu ve kontrolünü korur.', unpin: 'Panodan kaldır',
    dash_empty: 'Henüz sabitlenen yanıt yok. Bir soru sorulup Panoya sabitle seçilebilir.', open_ask: 'Soru sor',
    checks_title: 'Kontroller', checks_lead: 'Her kontrol ölçülen bir rakamı o rakamın sahibi olan sistemle karşılaştırır. Tutmayan kontrol farkın nerede başladığını gösterir.',
    run_all: 'Tüm kontrolleri çalıştır', last_run: 'Son çalışma {t}', never_run: 'Henüz kontrol çalıştırılmadı. Rakamların durumunu görmek için tüm kontroller çalıştırılabilir.',
    ask_why: 'Nedenini sor', finding: 'İlgili bulgu', first_out: '{d} tarihinden beri tolerans dışında',
    metrics_title: 'Metrikler', metrics_lead: 'Her yanıtın kullandığı tanımlar. Ajan bir tanımı değiştiremez; her yeni sürümü bir kişi onaylar.',
    m_source: 'Kaynak', m_owner: 'Sahibi', m_version: 'Sürüm', m_check: 'Karşılaştırıldığı', m_unit: 'Birim', m_none: 'yok', m_dims: 'Kırılımlar', m_filter: 'Sabit filtre', m_formula: 'Formül',
    sources_title: 'Kaynaklar', sources_lead: 'Salt okunur bağlantılar. Araç bunları okur, hiçbirine yazmaz.',
    connected: 'bağlı', not_connected: 'bağlı değil', rows: 'satır', synced: '{t} eşitlendi', sources_empty: 'Bağlı kaynak yok.',
    alerts_title: 'Alarmlar', alerts_lead: 'Takvime göre izlenen kontroller ve metrikler. Ajanın önerdiği alarmlar bir kişinin onayını bekler.',
    alerts_empty: 'Henüz alarm yok. Herhangi bir yanıttan ya da kontrolden kurulabilir.', a_active: 'etkin', a_pending: 'onay bekliyor', remove: 'Kaldır',
    activity_title: 'İşlem geçmişi', activity_lead: 'Bu çalışma alanında kişilerin ve ajanın yaptığı her işlem. Sabitlemeler ve alarmlar geri alınabilir.',
    activity_empty: 'Bu çalışma alanında henüz işlem yapılmadı.',
    undo: 'Geri al', undone: 'Geri alındı', you: 'kişi', agent: 'ajan', system: 'sistem',
    err_rate: 'Aynı anda çok fazla soru gönderildi. Bir dakika sonra tekrar sorulabilir.', err_generic: 'Ajan bitirmeden durdu. Soru tekrar sorulabilir ya da farklı ifade edilebilir.',
    err_stopped: 'Durduruldu. Son adımdan sonrası çalıştırılmadı.', err_network: 'Sunucu yanıt vermedi. AI Analyst’in çalıştığı kontrol edilip tekrar denenebilir.',
    err_action: 'İşlem yapılamadı: {m}', err_load: 'Çalışma alanı yüklenemedi: {m}', retry: 'Tekrar dene', loading: 'Yükleniyor',
    toast_pin: 'Panoya sabitlendi', toast_unpin: 'Panodan kaldırıldı', toast_alert: 'Alarm kuruldu', toast_undo: 'Geri alındı', toast_run: 'Kontroller çalıştırıldı', toast_approved: 'Alarm onaylandı', toast_declined: 'Alarm reddedildi', toast_removed: 'Alarm kaldırıldı',
    theme_dark: 'Koyu temaya geç', theme_light: 'Açık temaya geç',
    working_sr: 'Ajan çalışıyor', ready_sr: 'Cevap hazır: {s}', done_sr: 'Ajan bitirdi', approval_sr: 'Onay gerekiyor: {s}',
    act: {
      pin_answer: 'Panoya sabitledi', unpin: 'Panodan kaldırdı', create_alert: 'Alarm kurdu', create_alert_agent: 'Alarm önerdi',
      decide_alert: 'Alarm için karar verdi', approve_alert: 'Alarmı onayladı', decline_alert: 'Alarmı reddetti', remove_alert: 'Alarmı kaldırdı', undo: 'Geri aldı',
      run_all_checks: 'Kontrolleri çalıştırdı', publish_answer: 'Yanıt yayımladı', ask: 'Sordu', run_query: 'Sorgu çalıştırdı', reconcile: 'Kontrol çalıştırdı'
    }
  }
};

/* Names for dimension values and source keys the API returns as ids. */
export const NAMES = {
  channel: {
    organic: { en: 'Organic search', tr: 'Organik arama' }, direct: { en: 'Direct', tr: 'Doğrudan' }, google_ads: { en: 'Google Ads', tr: 'Google Ads' },
    meta_ads: { en: 'Meta Ads', tr: 'Meta Ads' }, tiktok_ads: { en: 'TikTok Ads', tr: 'TikTok Ads' }, email: { en: 'Email', tr: 'E-posta' }
  },
  device: { mobile: { en: 'Mobile', tr: 'Mobil' }, desktop: { en: 'Desktop', tr: 'Masaüstü' } },
  source: {
    backoffice: { en: 'Back office', tr: 'Arka ofis' }, ga4: { en: 'GA4 BigQuery export', tr: 'GA4 BigQuery dışa aktarımı' },
    ads: { en: 'Google Ads, Meta Ads, TikTok Ads', tr: 'Google Ads, Meta Ads, TikTok Ads' },
    ai_tag_debugger: { en: 'AI Tag Debugger', tr: 'AI Tag Debugger' }, aitd: { en: 'AI Tag Debugger', tr: 'AI Tag Debugger' }
  },
  unit: { count: { en: 'count', tr: 'adet' }, try: { en: 'TRY', tr: 'TL' }, pct: { en: 'percentage', tr: 'yüzde' }, ratio: { en: 'ratio', tr: 'oran' } }
};

let lang = 'en';
export function getLang() { return lang; }
export function setLang(l) { lang = l === 'tr' ? 'tr' : 'en'; }

export function t(k, vars) {
  let s = (STR[lang] && STR[lang][k]) ?? STR.en[k] ?? k;
  if (vars) for (const v of Object.keys(vars)) s = s.split('{' + v + '}').join(vars[v]);
  return s;
}
export function tAct(name, actor) {
  const a = STR[lang].act;
  if (name === 'create_alert' && actor === 'agent') return a.create_alert_agent;
  return a[name] || STR.en.act[name] || String(name || '').replace(/_/g, ' ');
}
/** A value the API may send as a plain string or as { en, tr }. */
export function L(x) {
  if (x == null) return '';
  if (typeof x === 'object') return x[lang] ?? x.en ?? x.tr ?? '';
  return String(x);
}
export function nameOf(kind, id) {
  const n = NAMES[kind] && NAMES[kind][id];
  return n ? n[lang] : String(id ?? '');
}
export function sourceName(key) {
  return String(key || '').split('+').filter(Boolean).map((k) => nameOf('source', k)).join(' · ');
}

/* ---------- numbers ---------- */
export const MINUS = '−';
function group(intStr) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'tr' ? '.' : ','); }
export function fmtInt(n) {
  if (n == null || isNaN(n)) return '–';
  return (n < 0 && Math.round(Math.abs(n)) !== 0 ? MINUS : '') + group(Math.round(Math.abs(n)).toString());
}
export function fmtDec(n, d) {
  if (n == null || isNaN(n)) return '–';
  const parts = Math.abs(n).toFixed(d).split('.');
  parts[0] = group(parts[0]);
  const s = parts.join(lang === 'tr' ? ',' : '.');
  return (n < 0 && Number(Math.abs(n).toFixed(d)) !== 0 ? MINUS : '') + s;
}
/** r is a ratio (0.042 → 4.2%). Turkish puts the sign before the percent sign: −%10,1. */
export function fmtPct(r, d = 1, signed = false) {
  if (r == null || isNaN(r)) return '–';
  const v = fmtDec(Math.abs(r * 100), d);
  const zero = Number(Math.abs(r * 100).toFixed(d)) === 0;
  const sign = zero ? '' : signed ? (r < 0 ? MINUS : '+') : (r < 0 ? MINUS : '');
  return lang === 'tr' ? sign + '%' + v : sign + v + '%';
}
export function fmtTRY(n) {
  if (n == null || isNaN(n)) return '–';
  if (Math.abs(n) >= 1e6) return fmtDec(n / 1e6, 2) + (lang === 'tr' ? ' mn TL' : 'M TL');
  return fmtInt(n) + ' TL';
}
export function fmtVal(v, unit) {
  if (v == null || isNaN(v)) return '–';
  if (unit === 'try') return fmtTRY(v);
  if (unit === 'pct') return fmtPct(v, 2);
  if (unit === 'ratio' || unit === 'x') return fmtDec(v, 2) + '×';
  return fmtInt(v);
}
/** Axis labels: shorter, same language rules. */
export function shortVal(v, unit) {
  if (unit === 'pct') return fmtPct(v, 1);
  if (unit === 'ratio' || unit === 'x') return fmtDec(v, 1) + '×';
  if (Math.abs(v) >= 1e6) return fmtDec(v / 1e6, 1) + (lang === 'tr' ? ' mn' : 'M');
  if (Math.abs(v) >= 1e4) return fmtDec(v / 1e3, 0) + (lang === 'tr' ? ' bin' : 'k');
  return fmtInt(v);
}

/* ---------- dates ---------- */
const MON = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  tr: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
};
function parts(s) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(s || ''));
  return m ? { y: +m[1], m: +m[2] - 1, d: m[3] ? +m[3] : null } : null;
}
export function fmtDate(s, withYear = false) {
  const p = parts(s);
  if (!p) return String(s ?? '');
  if (p.d == null) return MON[lang][p.m] + ' ' + p.y;
  return p.d + ' ' + MON[lang][p.m] + (withYear ? ' ' + p.y : '');
}
export function fmtMonth(s) { const p = parts(s); return p ? MON[lang][p.m] + (p.m === 0 ? ' ' + p.y : '') : String(s ?? ''); }
export function fmtRange(a, b) {
  if (!a || !b) return fmtDate(a || b, true);
  if (a === b) return fmtDate(a, true);
  const pa = parts(a), pb = parts(b);
  if (pa && pb && pa.y === pb.y && pa.m === pb.m) return pa.d + '–' + fmtDate(b, true);
  if (pa && pb && pa.y === pb.y) return fmtDate(a) + '–' + fmtDate(b, true);
  return fmtDate(a, true) + '–' + fmtDate(b, true);
}
const TZ = 'Europe/Istanbul';
function zoned(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const o = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return { date: o.year + '-' + o.month + '-' + o.day, time: (o.hour === '24' ? '00' : o.hour) + ':' + o.minute };
}
/** A timestamp as 08:14 today, or 22 Oct · 08:14 on another day (İstanbul time). */
export function fmtWhen(iso) {
  const z = zoned(iso);
  if (!z) return String(iso ?? '');
  const today = zoned(new Date().toISOString());
  return today && today.date === z.date ? z.time : fmtDate(z.date, z.date.slice(0, 4) !== today?.date.slice(0, 4)) + ' · ' + z.time;
}
export function fmtClock(iso) { const z = zoned(iso); return z ? z.time : ''; }
