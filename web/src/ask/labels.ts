// Pack labels the UI needs before any request (the checks are fixed in the pack; the server sends the same text).
import type { CheckId, Text } from "@/api/types";

export const CHECK_LABELS: Record<CheckId, Text> = {
  ga4_vs_orders: { en: "GA4 purchases against back-office orders", tr: "GA4 satın almaları ve sipariş panelindeki siparişler" },
  ga4_rev_vs_revenue: { en: "GA4 revenue against back-office revenue", tr: "GA4 geliri ve sipariş panelindeki ciro" },
  meta_vs_orders: { en: "Meta conversions against back-office orders", tr: "Meta dönüşümleri ve sipariş panelindeki siparişler" },
  gads_vs_orders: { en: "Google Ads conversions against back-office orders", tr: "Google Ads dönüşümleri ve sipariş panelindeki siparişler" },
};

export const CHECK_PLATFORM: Record<CheckId, string> = { ga4_vs_orders: "GA4", ga4_rev_vs_revenue: "GA4", meta_vs_orders: "Meta", gads_vs_orders: "Google Ads" };

