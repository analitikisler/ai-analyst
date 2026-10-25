// Server-made strings, stored in both languages ({ en, tr }) so switching the UI language re-renders answers,
// titles, follow-ups, steps and activity. Ported from the approved prototype (src/api/mock/text.ts): its sentence
// templates with the Turkish house terms (cevap, sipariş paneli, dashboard, sağlama, İşlem geçmişi).
// Copy rules: en-GB, short sentences, no exclamation marks, no em dashes, no superlatives; Turkish impersonal.
import { enShort, f, trFrom, trLong } from "./format.js";

export { f, enShort, trFrom, trLong };
export const T = (en, tr) => ({ en, tr });
export const both = (fn) => ({ en: fn("en"), tr: fn("tr") });

export const STEP = {
  run_query: (metric, grouping, period) => ({
    en: `Ran a query on ${/^[A-Z0-9]{2}/.test(metric.en) ? metric.en : metric.en.toLowerCase()}, ${grouping.en}, ${period.en}`,
    tr: `${metric.tr} için sorgu çalıştırıldı: ${grouping.tr}, ${period.tr}`,
  }),
  reconcile: (check) => ({ en: `Ran the tracking check ${check.en}`, tr: `${check.tr} ölçüm kontrolü çalıştırıldı` }),
  publish: T("Wrote the answer", "Cevap yazıldı"),
  propose_watch: (check) => ({ en: `Proposed watching ${check.en}`, tr: `${check.tr} için izleme önerildi` }),
  propose_pin: (dash) => ({ en: `Proposed pinning to ${dash.en}`, tr: `${dash.tr} dashboard’una ekleme önerildi` }),
  propose_event: (title, date) => ({ en: `Proposed an event: ${title.en}, ${enShort(date)}`, tr: `Olay önerildi: ${title.tr}, ${trLong(date)}` }),
  propose_metric: T("Proposed a metric from the exploratory answer", "Keşif cevabından metrik önerildi"),
  dry_run: (bytes) => ({
    en: `Dry run on daily_channel_device: ${f.en.bytes(bytes)}, under the bytes cap`,
    tr: `daily_channel_device üzerinde deneme çalıştırması: ${f.tr.bytes(bytes)}, bayt sınırının altında`,
  }),
  run_sql: (n, tables = []) =>
    tables.length > 1
      ? { en: `Ran one read-only query on ${tables.join(", ")}: ${n} ${n === 1 ? "row" : "rows"}`, tr: `${tables.join(", ")} üzerinde salt okunur tek bir sorgu çalıştırıldı: ${n} satır` }
      : { en: `Ran one read-only query: ${n} ${n === 1 ? "row" : "rows"}`, tr: `Salt okunur tek bir sorgu çalıştırıldı: ${n} satır` },
  describe_tables: (n) => ({ en: `Read the structure of ${n} ${n === 1 ? "table" : "tables"}`, tr: `${n} tablonun yapısı okundu` }),
  failed: (tool) => ({ en: `${tool} did not run`, tr: `${tool} çalışmadı` }),
};

export const GROUPING = {
  none: T("in total", "toplam"),
  day: T("by day", "günlük"),
  week: T("by week, complete weeks", "haftalık, tam haftalar"),
  month: T("by month", "aylık"),
  channel: T("by channel", "kanala göre"),
  device: T("by device", "cihaza göre"),
};

export const READ_AS = (reading) => ({ en: `Read as: ${reading.en}.`, tr: `Soru şöyle okundu: ${reading.tr}.` });

export const PLANNER_TEXT = T("Answered by the built-in planner, without a model.", "Cevabı yerleşik planlayıcı verdi; model kullanılmadı.");
export const PLANNER_LABEL = T("Built-in planner", "Yerleşik planlayıcı");

export const REFUSAL = {
  heading: T("The built-in planner cannot answer this one", "Yerleşik planlayıcı bu soruyu cevaplayamıyor"),
  outside: T("This is outside the metric set. With a model added, an exploratory answer is possible.", "Bu soru metrik setinin dışında. Model eklenirse keşif cevabı verilebilir."),
  explore_failed: {
    heading: T("Could not write a query for this from the mart’s columns", "Mart tablosunun sütunlarıyla bu soru için sorgu yazılamadı"),
    body: (cols) => ({
      en: `Exploratory answers read one table, daily_channel_device, with these columns: ${cols}. Products, returns and customers are not in it.`,
      tr: `Keşif cevapları tek bir tabloyu, daily_channel_device, okur; sütunları: ${cols}. Ürün, iade ve müşteri verisi bu tabloda yoktur.`,
    }),
    /** When the person allowed more tables than the mart. */
    body_tables: (tables) => ({
      en: `Exploratory answers read the tables allowed in Settings › Data source: ${tables}. None of them holds what this question needs.`,
      tr: `Keşif cevapları Ayarlar › Veri kaynağı bölümünde izin verilen tabloları okur: ${tables}. Bu sorunun gerektirdiği veri bu tabloların hiçbirinde yok.`,
    }),
  },
  metric_howto: {
    heading: T("Metrics are defined in the metric pack", "Metrikler metrik paketinde tanımlanır"),
    demo: T(
      "On demo data, metrics live in metrics/*.yaml in the AI Analyst folder: a definition (columns, filters, unit), an owner, and a tracking check when another system owns the number. The guide shows the format; after a restart the new metric answers like the others, with its definition and check.",
      "Demo veride metrikler AI Analyst klasöründeki metrics/*.yaml dosyalarındadır: bir tanım (sütunlar, filtreler, birim), bir sorumlu ve rakamın sahibi başka bir sistemse bir ölçüm kontrolü. Biçim rehberde anlatılır; yeniden başlatmadan sonra yeni metrik diğerleri gibi tanımı ve kontrolüyle cevaplanır.",
    ),
    own: T(
      "Metrics live in metrics/*.yaml next to the BigQuery connection: a definition, an owner, and a tracking check when another system owns the number. The guide shows the format, and Analitik İşler can add it to the pack with the team.",
      "Metrikler BigQuery bağlantısının yanındaki metrics/*.yaml dosyalarındadır: bir tanım, bir sorumlu ve rakamın sahibi başka bir sistemse bir ölçüm kontrolü. Biçim rehberde anlatılır; Analitik İşler metriği ekiple birlikte pakete ekleyebilir.",
    ),
  },
  coverage: T(
    "The built-in planner covers orders, revenue, sessions, conversion rate, order value, ad spend, ROAS and the four tracking checks, one question at a time.",
    "Yerleşik planlayıcı sipariş, ciro, oturum, dönüşüm oranı, sepet ortalaması, reklam harcaması, ROAS ve dört ölçüm kontrolü hakkındaki soruları tek tek cevaplar.",
  ),
  no_product: {
    heading: T("This workspace has no product-level data", "Bu çalışma alanında ürün düzeyinde veri yok"),
    body: T(
      "The demo data holds orders, revenue, sessions and ad figures by day, channel and device. Products, returns and customers are not in it, so this cannot be answered here.",
      "Demo veri sipariş, ciro, oturum ve reklam rakamlarını gün, kanal ve cihaz düzeyinde tutar. Ürün, iade ve müşteri verisi yoktur; bu yüzden soru burada cevaplanamaz.",
    ),
  },
  no_weekday: {
    heading: T("This workspace has no weekday breakdown", "Bu çalışma alanında hafta günü kırılımı yok"),
    body: T(
      "The metrics can be split by day, week, month, channel and device. A weekday split is not in the metric pack, so this cannot be answered here.",
      "Metrikler gün, hafta, ay, kanal ve cihaza göre kırılabilir. Hafta günü kırılımı metrik paketinde yok; bu yüzden soru burada cevaplanamaz.",
    ),
  },
};

/** Exploratory questions: offered on Ask only while a model is set and exploratory answers are on. */
export const EXPLORE_Q = {
  weekday: T("Which weekday brings the most revenue?", "Hangi hafta günü en çok ciro getiriyor?"),
  channel_device: T("Revenue by channel and device in the last 28 days", "Son 28 günde kanal ve cihaza göre ciro"),
  aov_device_week: T("Average order value by device by week", "Haftalık, cihaza göre sepet ortalaması"),
  spend_growth: T("Which channel’s ad spend grew most this month?", "Bu ay hangi kanalın reklam harcaması en çok arttı?"),
};

/** A question across the demo shop's tables (orders, order_items, products, returns): offered on the demo only. */
export const CROSS_Q = {
  returns_category: T("Which product categories are returned most often?", "En sık iade edilen ürün kategorileri hangileri?"),
};

export const NEAR = {
  revenue_channel_last_month: T("Revenue by channel last month", "Geçen ay kanallara göre ciro"),
  orders_channel_last_month: T("Orders by channel last month", "Geçen ay kanallara göre sipariş"),
  gads_14: T("Do Google Ads conversions match orders in the last 14 days?", "Son 14 günde Google Ads dönüşümleri siparişlerle tutuyor mu?"),
  revenue_channel_28: T("Revenue by channel in the last 28 days", "Son 28 günde kanallara göre ciro"),
  aov_device_28: T("Average order value by device in the last 28 days", "Son 28 günde cihaza göre sepet ortalaması"),
};

export const SUGGEST = {
  ga4: { text: T("Do GA4 purchases match orders in the last 14 days?", "Son 14 günde GA4 satın almaları siparişlerle tutuyor mu?"), tag: "check" },
  meta: { text: T("Do Meta conversions match orders this month?", "Bu ay Meta dönüşümleri siparişlerle tutuyor mu?"), tag: "check" },
  roas: { text: T("ROAS by channel in the last 28 days", "Son 28 günde kanallara göre ROAS"), tag: "by_channel" },
  revenue_week: { text: T("Revenue last week against the week before", "Geçen hafta ciro, bir önceki haftaya göre"), tag: "comparison" },
};

export const FOLLOW = {
  mobile: T("Is the gap only on mobile?", "Fark yalnızca mobilde mi?"),
  meta: T("Do Meta conversions match orders this month?", "Bu ay Meta dönüşümleri siparişlerle tutuyor mu?"),
  watch_ga4: T("Watch the GA4 tracking check", "GA4 ölçüm kontrolünü izle"),
  watch_meta: T("Watch the Meta tracking check", "Meta ölçüm kontrolünü izle"),
  watch_gads: T("Watch the Google Ads tracking check", "Google Ads ölçüm kontrolünü izle"),
  why_meta: T("Why do Meta conversions not match orders?", "Meta dönüşümleri neden siparişlerle tutmuyor?"),
  why: T("Why do GA4 purchases not match back-office orders for 9–22 Oct?", "9–22 Eki döneminde GA4 satın almaları neden sipariş panelindeki siparişlerle tutmuyor?"),
  gads: NEAR.gads_14,
  ga4: SUGGEST.ga4.text,
  roas: SUGGEST.roas.text,
  spend: T("Ad spend by channel in the last 28 days", "Son 28 günde kanallara göre reklam harcaması"),
  revenue_channel: NEAR.revenue_channel_28,
  revenue_week: SUGGEST.revenue_week.text,
  revenue_day: T("Revenue by day in the last 28 days", "Son 28 günde günlük ciro"),
  orders_device: T("Orders by device in the last 28 days", "Son 28 günde cihaza göre sipariş"),
  conversion_device: T("Conversion rate by device in the last 28 days", "Son 28 günde cihaza göre dönüşüm oranı"),
  pin: T("Pin this to the dashboard", "Bunu dashboard’a ekle"),
  to_metric: T("Turn this into a metric", "Bunu metriğe dönüştür"),
  add_event: T("Add the v4.12 release as an event", "v4.12 sürümünü olay olarak ekle"),
};

/** Questions the web app's tour links start. */
export const TOUR = {
  compare: T("Compare email and Google Ads last month", "Geçen ay e-posta ile Google Ads’i karşılaştır"),
  products: T("Which products sell most?", "En çok satan ürünler hangileri?"),
};

/** Every question the app itself offers, in both languages, so a turn started from one can follow the UI language. */
export const KNOWN_QUESTIONS = [...Object.values(SUGGEST).map((x) => x.text), ...Object.values(FOLLOW), ...Object.values(NEAR), ...Object.values(TOUR), ...Object.values(EXPLORE_Q), ...Object.values(CROSS_Q)];

/** What to do next, per check, for a "why" answer. */
export const WHY_NEXT = {
  ga4: [
    T("Fix the thank-you page so the purchase tag waits for dataLayer, and ship it in a release after v4.12.", "Teşekkür sayfası, purchase tag’i dataLayer hazır olduktan sonra yükleyecek şekilde düzeltilmeli ve v4.12’den sonraki bir sürümle yayımlanmalı."),
    T("Run the AI Tag Debugger purchase journey on mobile Safari to confirm the fix.", "Düzeltme, AI Tag Debugger’ın satın alma yolu mobil Safari’de çalıştırılarak doğrulanabilir."),
    T("Watch this tracking check: a changed verdict shows when the gap is back inside the tolerance.", "Bu ölçüm kontrolü izlenirse fark kabul edilen sapmanın içine döndüğünde sonuç değişikliği görünür."),
  ],
  meta: [
    T("Compare on the same attribution: report Meta conversions on 7-day click without 1-day view.", "Aynı atıfla karşılaştırmak için Meta dönüşümleri 1 günlük görüntüleme olmadan 7 günlük tıklamayla raporlanmalı."),
    T("Use back-office orders, not Meta conversions, for ROAS and budget decisions.", "ROAS ve bütçe kararlarında Meta dönüşümleri yerine sipariş panelindeki siparişler kullanılmalı."),
    T("Watch this tracking check: a changed verdict shows when the gap is back inside the tolerance.", "Bu ölçüm kontrolü izlenirse fark kabul edilen sapmanın içine döndüğünde sonuç değişikliği görünür."),
  ],
  other: [
    T("Run the AI Tag Debugger purchase journey to see what the platform receives.", "Platformun ne aldığını görmek için AI Tag Debugger’ın satın alma yolu çalıştırılabilir."),
    T("Watch this tracking check: a changed verdict shows when the gap is back inside the tolerance.", "Bu ölçüm kontrolü izlenirse fark kabul edilen sapmanın içine döndüğünde sonuç değişikliği görünür."),
  ],
};

/** Follow-ups that fill the list when the planner's own ones were already asked. */
export const FOLLOW_POOL = [FOLLOW.ga4, FOLLOW.meta, FOLLOW.gads, FOLLOW.roas, FOLLOW.revenue_week, FOLLOW.revenue_channel, FOLLOW.orders_device, FOLLOW.spend, FOLLOW.conversion_device, FOLLOW.revenue_day];

export const METRIC_PROPOSED = {
  heading: (label) => ({ en: `Proposed as a metric: ${label.en}`, tr: `Metrik olarak önerildi: ${label.tr}` }),
  // The prototype's demo text said "saved in this prototype only"; the real app writes the overlay on both sources.
  body: T(
    "It is on the Metrics page as Proposed, with the model’s SQL and a draft definition; accept or decline it there. Accepting writes it to metrics/ in the data folder, next to the pack, with an Activity row. It stays not checked, since no tracking check uses it.",
    "Metrikler sayfasında Önerildi olarak duruyor; modelin SQL’i ve taslak bir tanımla. Orada kabul edilebilir ya da reddedilebilir. Kabul, metriği veri klasöründeki metrics/ altına, paketin yanına yazar ve İşlem geçmişi’ne bir satır ekler. Hiçbir ölçüm kontrolü kullanmadığı için sağlaması yok olarak kalır.",
  ),
};

export const APPROVAL = {
  event_title: (title) => ({ en: `Add “${title.en}” as an event`, tr: `“${title.tr}” olay olarak eklensin` }),
  event_body: (date) => ({
    en: `It shows on every chart whose range holds ${f.en.date(date, true)}, with its type and note. It can be edited or removed in Settings › Events.`,
    tr: `${f.tr.date(date, true)} tarihini içeren her grafikte türü ve notuyla görünür. Ayarlar › Olaylar bölümünden düzenlenebilir ya da kaldırılabilir.`,
  }),
  watch_title: (check) => ({ en: `Watch ${check.en}`, tr: `${check.tr} izlensin` }),
  watch_body: T(
    "It runs again when AI Analyst starts, every hour while it runs, and on every ai-analyst check. A changed verdict shows under Tracking health on the dashboard and in Settings › Activity. Nothing is emailed.",
    "AI Analyst açıldığında, açıkken saatte bir ve her ai-analyst check çalıştığında yeniden çalışır. Sonuç değişirse dashboard’daki Ölçüm sağlığı bölümünde ve Ayarlar › İşlem geçmişi’nde görünür. E-posta gönderilmez.",
  ),
  pin_title: (dash) => ({ en: `Pin this answer to ${dash.en}`, tr: `Bu cevap ${dash.tr} dashboard’una eklensin` }),
  pin_body: (chart, w) => ({
    en: `It becomes a ${chart.en.toLowerCase()} tile, ${w} columns wide, and follows the dashboard period.`,
    tr: `${w} sütun genişliğinde bir ${chart.tr.toLowerCase()} kutusu olur ve dashboard’un dönemini izler.`,
  }),
  waiting: T("Waiting for a decision. Nothing changes until it is approved.", "Karar bekleniyor. Onaylanana kadar hiçbir şey değişmez."),
};

export const ACT = {
  demo_built: (from, to) => ({ en: `Built the demo workspace: Örnek Moda, ${f.en.range(from, to)}`, tr: `Demo çalışma alanı oluşturuldu: Örnek Moda, ${f.tr.range(from, to)}` }),
  checks_run: (n, bad) => ({ en: `Ran ${n} tracking checks · ${bad} do not add up`, tr: `${n} ölçüm kontrolü çalıştırıldı · ${bad} tanesi tutmuyor` }),
  watched_changed: (check) => ({ en: `${check.en} changed since the last run`, tr: `${check.tr} son çalıştırmadan beri değişti` }),
  event_added: (title) => ({ en: `Added the event “${title.en}”`, tr: `“${title.tr}” olayı eklendi` }),
  event_edited: (title) => ({ en: `Edited the event “${title.en}”`, tr: `“${title.tr}” olayı düzenlendi` }),
  event_deleted: (title) => ({ en: `Deleted the event “${title.en}”`, tr: `“${title.tr}” olayı silindi` }),
  metric_proposed: (label) => ({ en: `Proposed the metric “${label.en}” from an exploratory answer`, tr: `Bir keşif cevabından “${label.tr}” metriği önerildi` }),
  metric_accepted: (label) => ({ en: `Accepted the metric “${label.en}” from an exploratory answer`, tr: `Bir keşif cevabından gelen “${label.tr}” metriği kabul edildi` }),
  explore_added: (name, dataset) => (dataset ? { en: `Allowed the agent to read the dataset ${name}`, tr: `Agent’ın ${name} veri kümesini okumasına izin verildi` } : { en: `Allowed the agent to read the table ${name}`, tr: `Agent’ın ${name} tablosunu okumasına izin verildi` }),
  explore_removed: (name, dataset) => (dataset ? { en: `Removed the dataset ${name} from the tables the agent may read`, tr: `${name} veri kümesi agent’ın okuyabileceği tablolardan çıkarıldı` } : { en: `Removed the table ${name} from the tables the agent may read`, tr: `${name} tablosu agent’ın okuyabileceği tablolardan çıkarıldı` }),
  question_cap: (bytes) => ({ en: `Set the bytes cap per question to ${f.en.bytes(bytes)}`, tr: `Soru başına bayt sınırı ${f.tr.bytes(bytes)} olarak ayarlandı` }),
  protected_set: (table, cols) =>
    cols.length
      ? { en: `Confirmed the protected columns of ${table}: ${cols.join(", ")}`, tr: `${table} tablosunun korunan sütunları onaylandı: ${cols.join(", ")}` }
      : { en: `Confirmed that ${table} has no protected columns`, tr: `${table} tablosunda korunan sütun olmadığı onaylandı` },
  description_set: (table, set) => (set ? { en: `Saved the description of ${table}`, tr: `${table} tablosunun açıklaması kaydedildi` } : { en: `Removed the description of ${table}`, tr: `${table} tablosunun açıklaması kaldırıldı` }),
  metric_declined: (label) => ({ en: `Declined the proposed metric “${label.en}”`, tr: `Önerilen “${label.tr}” metriği reddedildi` }),
  audit_done: (title, ok) =>
    ok
      ? { en: `Audit of the purchase journey on mobile Safari passed (simulated): ${title.en}`, tr: `Mobil Safari’de satın alma yolu denetimi geçti (canlandırma): ${title.tr}` }
      : { en: `Audit of the purchase journey on mobile Safari confirmed the finding (simulated): ${title.en}`, tr: `Mobil Safari’de satın alma yolu denetimi bulguyu doğruladı (canlandırma): ${title.tr}` },
  audit_handoff: (check) => ({ en: `Prepared a purchase journey audit for AI Tag Debugger: ${check.en}`, tr: `AI Tag Debugger için satın alma yolu denetimi hazırlandı: ${check.tr}` }),
  audit_attached: (title, ok) =>
    ok
      ? { en: `AI Tag Debugger audit passed: ${title.en}`, tr: `AI Tag Debugger denetimi geçti: ${title.tr}` }
      : { en: `AI Tag Debugger audit confirmed a finding: ${title.en}`, tr: `AI Tag Debugger denetimi bir bulguyu doğruladı: ${title.tr}` },
  pinned: (title, dash) => ({ en: `Pinned “${title.en}” to ${dash.en}`, tr: `“${title.tr}” ${dash.tr} dashboard’una eklendi` }),
  removed: (title, dash) => ({ en: `Removed “${title.en}” from ${dash.en}`, tr: `“${title.tr}” ${dash.tr} dashboard’undan kaldırıldı` }),
  chart: (title, chart) => ({ en: `Changed “${title.en}” to a ${chart.en.toLowerCase()} chart`, tr: `“${title.tr}” için grafik türü ${chart.tr.toLowerCase()} olarak değiştirildi` }),
  resized: (title, w, h) => ({ en: `Resized “${title.en}” to ${w} columns, ${h} ${h === 1 ? "row" : "rows"}`, tr: `“${title.tr}” ${w} sütun, ${h} satır olarak boyutlandırıldı` }),
  moved: (title, other, last) =>
    other && !last
      ? { en: `Moved “${title.en}” before “${other.en}”`, tr: `“${title.tr}”, “${other.tr}” kutusunun önüne taşındı` }
      : { en: `Moved “${title.en}” to the end`, tr: `“${title.tr}” sona taşındı` },
  renamed: (old, title) => ({ en: `Renamed “${old.en}” to “${title.en}”`, tr: `“${old.tr}” adı “${title.tr}” olarak değiştirildi` }),
  duplicated: (title) => ({ en: `Duplicated “${title.en}”`, tr: `“${title.tr}” çoğaltıldı` }),
  period: (dash, period, compare) => ({
    en: `Changed ${dash.en} to ${period.en.toLowerCase()} against ${compare.en.toLowerCase()}`,
    tr: `${dash.tr} dönemi ${period.tr.toLocaleLowerCase("tr")} olarak değiştirildi, karşılaştırma: ${compare.tr.toLocaleLowerCase("tr")}`,
  }),
  dashboard_created: (name) => ({ en: `Created the dashboard ${name.en}`, tr: `${name.tr} dashboard’u oluşturuldu` }),
  dashboard_renamed: (old, name) => ({ en: `Renamed the dashboard “${old.en}” to “${name.en}”`, tr: `“${old.tr}” dashboard’unun adı “${name.tr}” olarak değiştirildi` }),
  dashboard_deleted: (name) => ({ en: `Deleted the dashboard ${name.en}`, tr: `${name.tr} dashboard’u silindi` }),
  watch: (check) => ({ en: `Started watching ${check.en}`, tr: `${check.tr} izlenmeye başlandı` }),
  unwatch: (check) => ({ en: `Stopped watching ${check.en}`, tr: `${check.tr} izlenmesi bırakıldı` }),
  proposed: (what) => ({ en: `Proposed: ${what.en}`, tr: `Önerildi: ${what.tr}` }),
  approved: (what) => ({ en: `Approved: ${what.en}`, tr: `Onaylandı: ${what.tr}` }),
  declined: (what) => ({ en: `Declined: ${what.en}`, tr: `Reddedildi: ${what.tr}` }),
  undid: (what) => ({ en: `Undid: ${what.en}`, tr: `Geri alındı: ${what.tr}` }),
  data_source: (source) => ({ en: `Switched the data source to ${source.en}`, tr: `Veri kaynağı ${source.tr} olarak değiştirildi` }),
  model_saved: (provider) => ({ en: `Saved a model key for ${provider}`, tr: `${provider} için model anahtarı kaydedildi` }),
  model_removed: (provider) => ({ en: `Removed the model key for ${provider}`, tr: `${provider} model anahtarı kaldırıldı` }),
  model_provider: (provider) => ({ en: `Set ${provider} to answer questions`, tr: `Soruları ${provider} cevaplayacak şekilde ayarlandı` }),
  cap: (bytes) => ({ en: `Lowered the bytes cap to ${bytes}`, tr: `Bayt sınırı ${bytes} olarak düşürüldü` }),
  demo_rebuilt: T("Rebuilt the demo", "Demo yeniden oluşturuldu"),
  answered: (q) => ({ en: q, tr: q }),
};

export const CHART_NAMES = {
  number: T("Number with sparkline", "Sayı ve küçük grafik"),
  line: T("Line", "Çizgi"),
  column: T("Column", "Sütun"),
  stacked_column: T("Stacked column", "Yığılmış sütun"),
  area: T("Area", "Alan"),
  table: T("Table", "Tablo"),
  tally: T("Tally", "Sağlama"),
  split_bar: T("Split bar", "Kırılım çubukları"),
  both_lines: T("Line of both figures", "İki rakamın çizgisi"),
};

export const PERIOD_NAMES = {
  last_7: T("Last 7 days", "Son 7 gün"),
  last_14: T("Last 14 days", "Son 14 gün"),
  last_28: T("Last 28 days", "Son 28 gün"),
  last_90: T("Last 90 days", "Son 90 gün"),
  last_week: T("Last complete week", "Geçen tam hafta"),
  this_month: T("This month", "Bu ay"),
  last_month: T("Last month", "Geçen ay"),
};
export const COMPARE_NAMES = {
  off: T("No comparison", "Karşılaştırma yok"),
  previous_period: T("The previous period", "Önceki dönem"),
  previous_year: T("Year on year", "Geçen yılın aynı dönemi"),
};

export const SOURCE_LABEL = {
  demo: T("Demo data", "Demo veri"),
  bigquery: (project) => ({ en: `BigQuery · ${project}`, tr: `BigQuery · ${project}` }),
  local: T("Your shop’s data", "Mağazanın kendi verisi"),
};

export const NAMES = {
  channel: {
    organic: T("Organic search", "Organik arama"),
    direct: T("Direct", "Doğrudan"),
    google_ads: T("Google Ads", "Google Ads"),
    meta_ads: T("Meta Ads", "Meta Ads"),
    tiktok_ads: T("TikTok Ads", "TikTok Ads"),
    email: T("Email", "E-posta"),
    other: T("Other channels", "Diğer kanallar"),
    unknown: T("Unknown", "Bilinmiyor"),
  },
  device: { mobile: T("Mobile", "Mobil"), desktop: T("Desktop", "Masaüstü"), unknown: T("Unknown", "Bilinmiyor") },
  weekday: {
    mon: T("Monday", "Pazartesi"), tue: T("Tuesday", "Salı"), wed: T("Wednesday", "Çarşamba"), thu: T("Thursday", "Perşembe"),
    fri: T("Friday", "Cuma"), sat: T("Saturday", "Cumartesi"), sun: T("Sunday", "Pazar"),
  },
};
export const dimName = (key, lang) => NAMES.channel[key]?.[lang] ?? NAMES.device[key]?.[lang] ?? key;

/** Plain words for every error code a person can see, in both languages. */
export const ERRORS = {
  stopped: T("Stopped.", "Durduruldu."),
  rate_limited: T("The model provider is limiting requests. Wait a minute, then ask again.", "Model sağlayıcısı istekleri sınırlıyor. Bir dakika sonra tekrar sorulabilir."),
  auth_failed: T("The model key was refused. Check it in Settings › Model.", "Model anahtarı reddedildi. Ayarlar › Model bölümünden kontrol edilmeli."),
  refusal: T("The model declined this question. Rephrase it, or ask about a metric in the pack.", "Model bu soruyu cevaplamadı. Soru farklı ifade edilebilir ya da paketteki bir metrik sorulabilir."),
  too_many_steps: T("The agent stopped before it finished. Ask again, or rephrase the question.", "Agent bitirmeden durdu. Soru tekrar sorulabilir ya da farklı ifade edilebilir."),
  model_error: T("The model did not answer. Ask again in a minute.", "Model cevap vermedi. Bir dakika sonra tekrar sorulabilir."),
  internal: T("Something went wrong on the server. The log has the details.", "Sunucuda bir sorun oluştu. Ayrıntılar günlükte."),
  no_answer: T("The model ended without an answer. Ask again, or rephrase the question.", "Model cevap vermeden bitti. Soru tekrar sorulabilir ya da farklı ifade edilebilir."),
  no_cloud: T("No model was called: AI_ANALYST_NO_CLOUD is set, so this server makes no calls to outside services.", "Model çağrılmadı: AI_ANALYST_NO_CLOUD tanımlı olduğu için bu sunucu dış servislere hiç bağlanmıyor."),
};
