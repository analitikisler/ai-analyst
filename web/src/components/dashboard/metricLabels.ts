// Metric labels from the pack (the server sends the same text with each result).
import type { MetricId, Text } from "@/api/types";

export const METRIC_LABELS: Record<MetricId, Text> = {
  "ad_spend": {
    "en": "Ad spend",
    "tr": "Reklam harcaması"
  },
  "aov": {
    "en": "Average order value",
    "tr": "Sepet ortalaması"
  },
  "conversion_rate": {
    "en": "Conversion rate",
    "tr": "Dönüşüm oranı"
  },
  "cpa": {
    "en": "Cost per order",
    "tr": "Sipariş başı maliyet"
  },
  "ga4_purchases": {
    "en": "GA4 purchases",
    "tr": "GA4 satın almaları"
  },
  "ga4_revenue": {
    "en": "GA4 revenue",
    "tr": "GA4 geliri"
  },
  "orders": {
    "en": "Orders",
    "tr": "Sipariş"
  },
  "platform_conversions": {
    "en": "Platform-reported conversions",
    "tr": "Platformun bildirdiği dönüşüm"
  },
  "revenue": {
    "en": "Revenue",
    "tr": "Ciro"
  },
  "roas": {
    "en": "ROAS",
    "tr": "ROAS"
  },
  "sessions": {
    "en": "Sessions",
    "tr": "Oturum"
  }
};
