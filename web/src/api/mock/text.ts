// Server-made strings for the fixture API, stored in both languages (B06): 09-ux.md §4.2 templates, with the
// Turkish terms of 07-creative.md §5 (cevap, sipariş paneli, dashboard). Numbers are formatted by lib/format
// before they reach a template, the way the server formats them for the validator.
import { formatFor, MONTHS, trFrom, trLong } from "@/lib/format";
import { parseISO } from "@/lib/dates";
import type { Lang, Text } from "../types";

export const f = { en: formatFor("en"), tr: formatFor("tr") };
export const both = (fn: (lang: Lang) => string): Text => ({ en: fn("en"), tr: fn("tr") });
export const T = (en: string, tr: string): Text => ({ en, tr });

export { trFrom, trLong };
export const enShort = (isoDate: string) => {
  const d = parseISO(isoDate);
  return `${d.getUTCDate()} ${MONTHS.en[d.getUTCMonth()]}`;
};

export const STEP = {
  run_query: (metric: Text, grouping: Text, period: Text): Text => ({
    en: `Ran a query on ${/^[A-Z0-9]{2}/.test(metric.en) ? metric.en : metric.en.toLowerCase()}, ${grouping.en}, ${period.en}`,
    tr: `${metric.tr} için sorgu çalıştırıldı: ${grouping.tr}, ${period.tr}`,
  }),
  reconcile: (check: Text): Text => ({ en: `Ran the tracking check ${check.en}`, tr: `${check.tr} ölçüm kontrolü çalıştırıldı` }),
  publish: T("Wrote the answer", "Cevap yazıldı"),
  propose_watch: (check: Text): Text => ({ en: `Proposed watching ${check.en}`, tr: `${check.tr} için izleme önerildi` }),
  propose_pin: (dash: Text): Text => ({ en: `Proposed pinning to ${dash.en}`, tr: `${dash.tr} dashboard’una ekleme önerildi` }),
};

export const GROUPING: Record<string, Text> = {
  none: T("in total", "toplam"),
  day: T("by day", "günlük"),
  week: T("by week, complete weeks", "haftalık, tam haftalar"),
  month: T("by month", "aylık"),
  channel: T("by channel", "kanala göre"),
  device: T("by device", "cihaza göre"),
};

export const READ_AS = (reading: Text): Text => ({ en: `Read as: ${reading.en}.`, tr: `Soru şöyle okundu: ${reading.tr}.` });

export const PLANNER_TEXT = T("Answered by the built-in planner, without a model.", "Cevabı yerleşik planlayıcı verdi; model kullanılmadı.");

export const REFUSAL = {
  heading: T("The built-in planner cannot answer this one", "Yerleşik planlayıcı bu soruyu cevaplayamıyor"),
  outside: T("This is outside the metric set. With a model added, an exploratory answer is possible.", "Bu soru metrik setinin dışında. Model eklenirse keşif cevabı verilebilir."),
  explore_failed: {
    heading: T("Could not write a query for this from the mart’s columns", "Mart tablosunun sütunlarıyla bu soru için sorgu yazılamadı"),
    body: (cols: string): Text => ({
      en: `Exploratory answers read one table, daily_channel_device, with these columns: ${cols}. Products, returns and customers are not in it.`,
      tr: `Keşif cevapları tek bir tabloyu, daily_channel_device, okur; sütunları: ${cols}. Ürün, iade ve müşteri verisi bu tabloda yoktur.`,
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

/** Exploratory questions (owner round 4): offered on Ask only while a model is set and exploratory answers are on. */
export const EXPLORE_Q = {
  weekday: T("Which weekday brings the most revenue?", "Hangi hafta günü en çok ciro getiriyor?"),
  channel_device: T("Revenue by channel and device in the last 28 days", "Son 28 günde kanal ve cihaza göre ciro"),
  aov_device_week: T("Average order value by device by week", "Haftalık, cihaza göre sepet ortalaması"),
  spend_growth: T("Which channel’s ad spend grew most this month?", "Bu ay hangi kanalın reklam harcaması en çok arttı?"),
};

export const NEAR = {
  revenue_channel_last_month: T("Revenue by channel last month", "Geçen ay kanallara göre ciro"),
  orders_channel_last_month: T("Orders by channel last month", "Geçen ay kanallara göre sipariş"),
  gads_14: T("Do Google Ads conversions match orders in the last 14 days?", "Son 14 günde Google Ads dönüşümleri siparişlerle tutuyor mu?"),
  revenue_channel_28: T("Revenue by channel in the last 28 days", "Son 28 günde kanallara göre ciro"),
  aov_device_28: T("Average order value by device in the last 28 days", "Son 28 günde cihaza göre sepet ortalaması"),
};

export const SUGGEST = {
  ga4: { text: T("Do GA4 purchases match orders in the last 14 days?", "Son 14 günde GA4 satın almaları siparişlerle tutuyor mu?"), tag: "check" as const },
  meta: { text: T("Do Meta conversions match orders this month?", "Bu ay Meta dönüşümleri siparişlerle tutuyor mu?"), tag: "check" as const },
  roas: { text: T("ROAS by channel in the last 28 days", "Son 28 günde kanallara göre ROAS"), tag: "by_channel" as const },
  revenue_week: { text: T("Revenue last week against the week before", "Geçen hafta ciro, bir önceki haftaya göre"), tag: "comparison" as const },
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

/** Questions the reviewer links start (09-ux.md §2 F3). */
export const TOUR = {
  compare: T("Compare email and Google Ads last month", "Geçen ay e-posta ile Google Ads’i karşılaştır"),
  products: T("Which products sell most?", "En çok satan ürünler hangileri?"),
};

/** Every question the app itself offers, in both languages, so a turn started from one can follow the UI language. */
export const KNOWN_QUESTIONS: Text[] = [...Object.values(SUGGEST).map((x) => x.text), ...Object.values(FOLLOW), ...Object.values(NEAR), ...Object.values(TOUR)];

/** What to do next, per check, for a "why" answer. */
export const WHY_NEXT: Record<string, Text[]> = {
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
export const FOLLOW_POOL: Text[] = [FOLLOW.ga4, FOLLOW.meta, FOLLOW.gads, FOLLOW.roas, FOLLOW.revenue_week, FOLLOW.revenue_channel, FOLLOW.orders_device, FOLLOW.spend, FOLLOW.conversion_device, FOLLOW.revenue_day];

export const METRIC_PROPOSED = {
  heading: (label: Text): Text => ({ en: `Proposed as a metric: ${label.en}`, tr: `Metrik olarak önerildi: ${label.tr}` }),
  demo: T(
    "It is on the Metrics page as Proposed, with the model’s SQL and a draft definition; accept or decline it there. It stays not checked, since no tracking check uses it. On demo data it is saved in this prototype only; in the real app accepting would write metrics/*.yaml through an approval.",
    "Metrikler sayfasında Önerildi olarak duruyor; modelin SQL’i ve taslak bir tanımla. Orada kabul edilebilir ya da reddedilebilir. Hiçbir ölçüm kontrolü kullanmadığı için sağlaması yok olarak kalır. Demo veride yalnızca bu prototipte kaydedilir; gerçek uygulamada kabul, onayla metrics/*.yaml dosyasına yazar.",
  ),
  own: T(
    "It is on the Metrics page as Proposed, with the model’s SQL and a draft definition; accept or decline it there. Accepting writes metrics/*.yaml through an approval. It stays not checked, since no tracking check uses it.",
    "Metrikler sayfasında Önerildi olarak duruyor; modelin SQL’i ve taslak bir tanımla. Orada kabul edilebilir ya da reddedilebilir. Kabul, onayla metrics/*.yaml dosyasına yazar. Hiçbir ölçüm kontrolü kullanmadığı için sağlaması yok olarak kalır.",
  ),
};

export const APPROVAL = {
  event_title: (title: Text): Text => ({ en: `Add “${title.en}” as an event`, tr: `“${title.tr}” olay olarak eklensin` }),
  event_body: (date: string): Text => ({
    en: `It shows on every chart whose range holds ${f.en.date(date, true)}, with its type and note. It can be edited or removed in Settings › Events.`,
    tr: `${f.tr.date(date, true)} tarihini içeren her grafikte türü ve notuyla görünür. Ayarlar › Olaylar bölümünden düzenlenebilir ya da kaldırılabilir.`,
  }),
  watch_title: (check: Text): Text => ({ en: `Watch ${check.en}`, tr: `${check.tr} izlensin` }),
  watch_body: T(
    "It runs again when AI Analyst starts, every hour while it runs, and on every ai-analyst check. A changed verdict shows under Tracking health on the dashboard and in Settings › Activity. Nothing is emailed.",
    "AI Analyst açıldığında, açıkken saatte bir ve her ai-analyst check çalıştığında yeniden çalışır. Sonuç değişirse dashboard’daki Ölçüm sağlığı bölümünde ve Ayarlar › İşlem geçmişi’nde görünür. E-posta gönderilmez.",
  ),
  pin_title: (dash: Text): Text => ({ en: `Pin this answer to ${dash.en}`, tr: `Bu cevap ${dash.tr} dashboard’una eklensin` }),
  pin_body: (chart: Text, w: number): Text => ({
    en: `It becomes a ${chart.en.toLowerCase()} tile, ${w} columns wide, and follows the dashboard period.`,
    tr: `${w} sütun genişliğinde bir ${chart.tr.toLowerCase()} kutusu olur ve dashboard’un dönemini izler.`,
  }),
  waiting: T("Waiting for a decision. Nothing changes until it is approved.", "Karar bekleniyor. Onaylanana kadar hiçbir şey değişmez."),
};

export const ACT = {
  demo_built: (from: string, to: string): Text => ({
    en: `Built the demo workspace: Örnek Moda, ${f.en.range(from, to)}`,
    tr: `Demo çalışma alanı oluşturuldu: Örnek Moda, ${f.tr.range(from, to)}`,
  }),
  checks_run: (n: number, bad: number): Text => ({
    en: `Ran ${n} tracking checks · ${bad} do not add up`,
    tr: `${n} ölçüm kontrolü çalıştırıldı · ${bad} tanesi tutmuyor`,
  }),
  event_added: (title: Text): Text => ({ en: `Added the event “${title.en}”`, tr: `“${title.tr}” olayı eklendi` }),
  event_edited: (title: Text): Text => ({ en: `Edited the event “${title.en}”`, tr: `“${title.tr}” olayı düzenlendi` }),
  event_deleted: (title: Text): Text => ({ en: `Deleted the event “${title.en}”`, tr: `“${title.tr}” olayı silindi` }),
  gtm_import: (n: number): Text => ({ en: `Imported ${n} GTM versions as events (simulated)`, tr: `${n} GTM sürümü olay olarak içe aktarıldı (canlandırma)` }),
  metric_proposed: (label: Text): Text => ({ en: `Proposed the metric “${label.en}” from an exploratory answer`, tr: `Bir keşif cevabından “${label.tr}” metriği önerildi` }),
  metric_accepted: (label: Text): Text => ({ en: `Accepted the metric “${label.en}” from an exploratory answer`, tr: `Bir keşif cevabından gelen “${label.tr}” metriği kabul edildi` }),
  metric_declined: (label: Text): Text => ({ en: `Declined the proposed metric “${label.en}”`, tr: `Önerilen “${label.tr}” metriği reddedildi` }),
  audit_done: (title: Text, ok: boolean): Text =>
    ok
      ? { en: `Audit of the purchase journey on mobile Safari passed (simulated): ${title.en}`, tr: `Mobil Safari’de satın alma yolu denetimi geçti (canlandırma): ${title.tr}` }
      : { en: `Audit of the purchase journey on mobile Safari confirmed the finding (simulated): ${title.en}`, tr: `Mobil Safari’de satın alma yolu denetimi bulguyu doğruladı (canlandırma): ${title.tr}` },
  pinned: (title: Text, dash: Text): Text => ({ en: `Pinned “${title.en}” to ${dash.en}`, tr: `“${title.tr}” ${dash.tr} dashboard’una eklendi` }),
  removed: (title: Text, dash: Text): Text => ({ en: `Removed “${title.en}” from ${dash.en}`, tr: `“${title.tr}” ${dash.tr} dashboard’undan kaldırıldı` }),
  chart: (title: Text, chart: Text): Text => ({ en: `Changed “${title.en}” to a ${chart.en.toLowerCase()} chart`, tr: `“${title.tr}” için grafik türü ${chart.tr.toLowerCase()} olarak değiştirildi` }),
  resized: (title: Text, w: number, h: number): Text => ({
    en: `Resized “${title.en}” to ${w} columns, ${h} ${h === 1 ? "row" : "rows"}`,
    tr: `“${title.tr}” ${w} sütun, ${h} satır olarak boyutlandırıldı`,
  }),
  moved: (title: Text, other: Text | null, last: boolean): Text =>
    other && !last
      ? { en: `Moved “${title.en}” before “${other.en}”`, tr: `“${title.tr}”, “${other.tr}” kutusunun önüne taşındı` }
      : { en: `Moved “${title.en}” to the end`, tr: `“${title.tr}” sona taşındı` },
  renamed: (old: Text, title: Text): Text => ({ en: `Renamed “${old.en}” to “${title.en}”`, tr: `“${old.tr}” adı “${title.tr}” olarak değiştirildi` }),
  duplicated: (title: Text): Text => ({ en: `Duplicated “${title.en}”`, tr: `“${title.tr}” çoğaltıldı` }),
  period: (dash: Text, period: Text, compare: Text): Text => ({
    en: `Changed ${dash.en} to ${period.en.toLowerCase()} against ${compare.en.toLowerCase()}`,
    tr: `${dash.tr} dönemi ${period.tr.toLocaleLowerCase("tr")} olarak değiştirildi, karşılaştırma: ${compare.tr.toLocaleLowerCase("tr")}`,
  }),
  dashboard_created: (name: Text): Text => ({ en: `Created the dashboard ${name.en}`, tr: `${name.tr} dashboard’u oluşturuldu` }),
  dashboard_renamed: (old: Text, name: Text): Text => ({ en: `Renamed the dashboard “${old.en}” to “${name.en}”`, tr: `“${old.tr}” dashboard’unun adı “${name.tr}” olarak değiştirildi` }),
  dashboard_deleted: (name: Text): Text => ({ en: `Deleted the dashboard ${name.en}`, tr: `${name.tr} dashboard’u silindi` }),
  watch: (check: Text): Text => ({ en: `Started watching ${check.en}`, tr: `${check.tr} izlenmeye başlandı` }),
  unwatch: (check: Text): Text => ({ en: `Stopped watching ${check.en}`, tr: `${check.tr} izlenmesi bırakıldı` }),
  proposed: (what: Text): Text => ({ en: `Proposed: ${what.en}`, tr: `Önerildi: ${what.tr}` }),
  approved: (what: Text): Text => ({ en: `Approved: ${what.en}`, tr: `Onaylandı: ${what.tr}` }),
  declined: (what: Text): Text => ({ en: `Declined: ${what.en}`, tr: `Reddedildi: ${what.tr}` }),
  undid: (what: Text): Text => ({ en: `Undid: ${what.en}`, tr: `Geri alındı: ${what.tr}` }),
  data_source: (source: Text): Text => ({ en: `Switched the data source to ${source.en}`, tr: `Veri kaynağı ${source.tr} olarak değiştirildi` }),
  model_saved: (provider: string): Text => ({ en: `Saved a model key for ${provider}`, tr: `${provider} için model anahtarı kaydedildi` }),
  model_removed: (provider: string): Text => ({ en: `Removed the model key for ${provider}`, tr: `${provider} model anahtarı kaldırıldı` }),
  model_provider: (provider: string): Text => ({ en: `Set ${provider} to answer questions`, tr: `Soruları ${provider} cevaplayacak şekilde ayarlandı` }),
  cap: (bytes: string): Text => ({ en: `Lowered the bytes cap to ${bytes}`, tr: `Bayt sınırı ${bytes} olarak düşürüldü` }),
  demo_rebuilt: T("Rebuilt the demo", "Demo yeniden oluşturuldu"),
};

export const CHART_NAMES: Record<string, Text> = {
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

export const PERIOD_NAMES: Record<string, Text> = {
  last_7: T("Last 7 days", "Son 7 gün"),
  last_14: T("Last 14 days", "Son 14 gün"),
  last_28: T("Last 28 days", "Son 28 gün"),
  last_90: T("Last 90 days", "Son 90 gün"),
  last_week: T("Last complete week", "Geçen tam hafta"),
  this_month: T("This month", "Bu ay"),
  last_month: T("Last month", "Geçen ay"),
};
export const COMPARE_NAMES: Record<string, Text> = {
  off: T("No comparison", "Karşılaştırma yok"),
  previous_period: T("The previous period", "Önceki dönem"),
  previous_year: T("Year on year", "Geçen yılın aynı dönemi"),
};

export const SOURCE_LABEL = {
  demo: T("Demo data", "Demo veri"),
  bigquery: (project: string): Text => ({ en: `BigQuery · ${project}`, tr: `BigQuery · ${project}` }),
};

export const MODEL_LABEL = {
  planner: T("Built-in planner", "Yerleşik planlayıcı"),
};
