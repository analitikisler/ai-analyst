// The metrics page (data dictionary) and chart events for the fixture API (owner round 5). Definitions are derived
// from the pack (metrics/*.yaml as captured in pack.ts); the history and the events are seeded, marked in PHASE2.md.
import type { ChartEvent, CheckId, MetricHistoryRow, MetricId, MetricInfo, Text } from "../types";
import { CHECKS, METRICS } from "./pack";
import { T } from "./text";

/** Which tracking checks use a metric, and on which side. */
export function checksUsing(id: string): { id: CheckId; role: "source" | "measured" }[] {
  const out: { id: CheckId; role: "source" | "measured" }[] = [];
  for (const c of Object.values(CHECKS)) {
    if (c.expected.metric === id) out.push({ id: c.id, role: "source" });
    else if (c.measured.metric === id) out.push({ id: c.id, role: "measured" });
  }
  return out;
}

const SOURCE_ROW: Record<string, Text> = {
  backoffice: T("Back office, by order date", "Sipariş paneli, sipariş tarihine göre"),
  ga4: T("GA4 BigQuery export", "GA4 BigQuery dışa aktarımı"),
  ads: T("Google Ads, Meta Ads and TikTok Ads, as each reports it", "Google Ads, Meta Ads ve TikTok Ads, her biri kendi bildirdiği gibi"),
};

/** The YAML-derived definition, in rows: what it counts, grain, filters, timezone, money rules, dedup. */
export function definitionRows(m: MetricInfo): { label: Text; value: Text }[] {
  const d = m.definition;
  const formula: Text = "sum" in d ? { en: `SUM(${d.sum})`, tr: `SUM(${d.sum})` } : { en: `SUM(${d.ratio.numerator}) / SUM(${d.ratio.denominator})`, tr: `SUM(${d.ratio.numerator}) / SUM(${d.ratio.denominator})` };
  const rows: { label: Text; value: Text }[] = [
    { label: T("Formula", "Formül"), value: formula },
    { label: T("Table", "Tablo"), value: T("daily_channel_device", "daily_channel_device") },
    { label: T("Grain", "Ayrıntı düzeyi"), value: T("Day × channel × device", "Gün × kanal × cihaz") },
    { label: T("Source", "Kaynak"), value: { en: m.source.split("+").map((s) => SOURCE_ROW[s]?.en ?? s).join("; "), tr: m.source.split("+").map((s) => SOURCE_ROW[s]?.tr ?? s).join("; ") } },
    { label: T("Timezone", "Saat dilimi"), value: T("Europe/Istanbul; a day is midnight to midnight there", "Europe/Istanbul; gün oradaki gece yarısından gece yarısına") },
  ];
  rows.push({
    label: T("Filters", "Filtreler"),
    value: m.where?.channel ? { en: `channel in ${m.where.channel.join(", ")}`, tr: `kanal: ${m.where.channel.join(", ")}` } : T("None", "Yok"),
  });
  if (m.id === "orders" || m.id === "revenue" || m.id === "aov") rows.push({ label: T("Excluded", "Hariç"), value: T("Test orders. Cancelled orders are kept (since Orders v3)", "Test siparişleri. İptal edilen siparişler dahil (Sipariş v3’ten beri)") });
  if (m.unit === "try") rows.push({ label: T("VAT", "KDV"), value: m.id === "ad_spend" ? T("Ad spend has no VAT; converted to TRY at the day’s TCMB rate", "Reklam harcamasında KDV yok; günün TCMB kuruyla TRY’ye çevrilir") : T("Includes 20% VAT; shipping excluded", "%20 KDV dahil; kargo hariç") });
  if (m.source.includes("ga4")) rows.push({ label: T("Deduplication", "Tekilleştirme"), value: T("Once per transaction_id; sessions by user_pseudo_id and ga_session_id", "transaction_id başına bir kez; oturumlar user_pseudo_id ve ga_session_id ile") });
  if (m.where?.channel || m.id === "conversion_rate") rows.push({ label: T("Attribution", "Atıf"), value: T("Back-office orders by last non-direct click; platform figures as each platform reports them", "Sipariş paneli siparişleri son doğrudan olmayan tıklamaya göre; platform rakamları her platformun bildirdiği gibi") });
  rows.push({ label: T("Can be split by", "Kırılımlar"), value: { en: m.dimensions.join(", "), tr: m.dimensions.map((x) => (({ day: "gün", week: "hafta", month: "ay", channel: "kanal", device: "cihaz" }) as Record<string, string>)[x] ?? x).join(", ") } });
  rows.push({ label: T("Owner", "Sorumlu"), value: { en: m.owner, tr: m.owner } });
  return rows;
}

const H = (version: number, date: string, en: string, tr: string): MetricHistoryRow => ({ version, date, change: T(en, tr), actor: T("Bahadır Ölez", "Bahadır Ölez") });

/** Seeded version history per metric, newest first (the pack carries versions; the dates and notes are seeded). */
export function historyOf(id: MetricId): MetricHistoryRow[] {
  const special: Partial<Record<MetricId, MetricHistoryRow[]>> = {
    orders: [
      H(3, "2026-08-18", "Cancelled orders no longer excluded: an order counts on the day it was placed, as GA4 records the purchase.", "İptal edilen siparişler artık hariç tutulmuyor: sipariş, GA4’ün satın almayı kaydettiği gibi verildiği gün sayılıyor."),
      H(2, "2026-06-02", "Channel taken from the last non-direct click instead of the first touch.", "Kanal ilk temas yerine son doğrudan olmayan tıklamadan alınıyor."),
    ],
    revenue: [H(2, "2026-08-18", "Same cancellation rule as Orders v3; shipping removed from the value.", "Sipariş v3 ile aynı iptal kuralı; kargo tutardan çıkarıldı.")],
    ga4_purchases: [H(2, "2026-07-01", "Counted once per transaction_id, so a reloaded thank-you page no longer counts twice.", "transaction_id başına bir kez sayılıyor; yenilenen teşekkür sayfası artık iki kez sayılmıyor.")],
    conversion_rate: [H(2, "2026-06-02", "Orders by last non-direct click, matching Orders v2.", "Siparişler son doğrudan olmayan tıklamaya göre; Sipariş v2 ile uyumlu.")],
    roas: [H(2, "2026-06-02", "Revenue by last non-direct click instead of platform conversions.", "Platform dönüşümleri yerine son doğrudan olmayan tıklamaya göre ciro.")],
  };
  return [...(special[id] ?? []), H(1, "2026-03-01", "First version.", "İlk sürüm.")];
}

/** The seeded events (owner round 5): the release, the sale that explains the 10–13 Oct spike, a GTM publish, a price change. */
export function seedEvents(): ChartEvent[] {
  return [
    { id: "ev_v412", date: "2026-10-09", title: T("v4.12 release", "v4.12 sürümü"), type: "release", note: T("New checkout and thank-you page.", "Yeni ödeme ve teşekkür sayfası."), source: "manual", data_source: "demo" },
    { id: "ev_sale", date: "2026-10-10", title: T("Autumn sale starts", "Sonbahar indirimi başlıyor"), type: "campaign", note: T("20% off outerwear until 13 Oct.", "13 Ekim’e kadar dış giyimde %20 indirim."), source: "manual", data_source: "demo" },
    { id: "ev_gtm58", date: "2026-10-02", title: T("GTM version 58 published", "GTM sürüm 58 yayımlandı"), type: "tag_change", note: T("Consent Mode update.", "Consent Mode güncellemesi."), source: "gtm", data_source: "demo" },
    { id: "ev_ship", date: "2026-09-15", title: T("Free shipping threshold to 750 TL", "Ücretsiz kargo sınırı 750 TL"), type: "price_change", note: null, source: "manual", data_source: "demo" },
  ];
}

/** The scripted "Import from GTM": three published versions. */

export { METRICS };
