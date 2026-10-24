// Generated from the captured catalogue fixtures (list_metrics, explain_metric, list_checks). Turkish labels use the
// house glossary (07-creative.md §5: sipariş paneli, not arka ofis), as the bilingual server strings will (B06).
import type { CheckId, CheckInfo, MetricId, MetricInfo } from "../types";

const metrics = {
  "ad_spend": {
    "id": "ad_spend",
    "label": {
      "en": "Ad spend",
      "tr": "Reklam harcaması"
    },
    "unit": "try",
    "version": 1,
    "source": "ads",
    "owner": "Bahadır Ölez",
    "description": {
      "en": "Cost reported by Google Ads, Meta Ads and TikTok Ads, converted to TRY at the day’s TCMB rate.",
      "tr": "Google Ads, Meta Ads ve TikTok Ads’in bildirdiği maliyet; günün TCMB kuruyla TRY’ye çevrilir."
    },
    "definition": {
      "sum": "ad_spend"
    },
    "where": {
      "channel": [
        "google_ads",
        "meta_ads",
        "tiktok_ads"
      ]
    },
    "dimensions": [
      "day",
      "week",
      "month",
      "channel",
      "device"
    ],
    "check": null
  },
  "aov": {
    "id": "aov",
    "label": {
      "en": "Average order value",
      "tr": "Sepet ortalaması"
    },
    "unit": "try",
    "version": 1,
    "source": "backoffice",
    "owner": "Bahadır Ölez",
    "description": {
      "en": "Revenue divided by orders, both from the back office.",
      "tr": "Ciro bölü sipariş; ikisi de sipariş panelinden."
    },
    "definition": {
      "ratio": {
        "numerator": "revenue",
        "denominator": "orders"
      }
    },
    "where": null,
    "dimensions": [
      "day",
      "week",
      "month",
      "channel",
      "device"
    ],
    "check": null
  },
  "conversion_rate": {
    "id": "conversion_rate",
    "label": {
      "en": "Conversion rate",
      "tr": "Dönüşüm oranı"
    },
    "unit": "pct",
    "version": 2,
    "source": "backoffice+ga4",
    "owner": "Bahadır Ölez",
    "description": {
      "en": "Back-office orders divided by GA4 sessions. By channel, orders take the channel stored with the order and sessions the GA4 session source.",
      "tr": "Sipariş paneli siparişleri bölü GA4 oturumları. Kanal kırılımında sipariş, siparişle kaydedilen kanala; oturum, GA4 oturum kaynağına göre atanır."
    },
    "definition": {
      "ratio": {
        "numerator": "orders",
        "denominator": "sessions"
      }
    },
    "where": null,
    "dimensions": [
      "day",
      "week",
      "month",
      "channel",
      "device"
    ],
    "check": null
  },
  "cpa": {
    "id": "cpa",
    "label": {
      "en": "Cost per order",
      "tr": "Sipariş başı maliyet"
    },
    "unit": "try",
    "version": 1,
    "source": "backoffice+ads",
    "owner": "Bahadır Ölez",
    "description": {
      "en": "Channel spend divided by back-office orders attributed to that channel (last non-direct click).",
      "tr": "Kanal harcaması bölü o kanala atanan sipariş paneli siparişleri (son doğrudan olmayan tıklama)."
    },
    "definition": {
      "ratio": {
        "numerator": "ad_spend",
        "denominator": "orders"
      }
    },
    "where": {
      "channel": [
        "google_ads",
        "meta_ads",
        "tiktok_ads"
      ]
    },
    "dimensions": [
      "day",
      "week",
      "month",
      "channel",
      "device"
    ],
    "check": null
  },
  "ga4_purchases": {
    "id": "ga4_purchases",
    "label": {
      "en": "GA4 purchases",
      "tr": "GA4 satın almaları"
    },
    "unit": "count",
    "version": 2,
    "source": "ga4",
    "owner": "Bahadır Ölez",
    "description": {
      "en": "Purchase events in the GA4 BigQuery export, counted once per transaction_id.",
      "tr": "GA4 BigQuery dışa aktarımındaki purchase etkinlikleri; her transaction_id bir kez sayılır."
    },
    "definition": {
      "sum": "ga4_purchases"
    },
    "where": null,
    "dimensions": [
      "day",
      "week",
      "month",
      "channel",
      "device"
    ],
    "check": "ga4_vs_orders"
  },
  "ga4_revenue": {
    "id": "ga4_revenue",
    "label": {
      "en": "GA4 revenue",
      "tr": "GA4 geliri"
    },
    "unit": "try",
    "version": 1,
    "source": "ga4",
    "owner": "Bahadır Ölez",
    "description": {
      "en": "Purchase revenue in TRY from GA4 purchase events, counted once per transaction_id.",
      "tr": "GA4 purchase etkinliklerinden TRY satın alma geliri; her transaction_id bir kez sayılır."
    },
    "definition": {
      "sum": "ga4_revenue"
    },
    "where": null,
    "dimensions": [
      "day",
      "week",
      "month",
      "channel",
      "device"
    ],
    "check": "ga4_rev_vs_revenue"
  },
  "orders": {
    "id": "orders",
    "label": {
      "en": "Orders",
      "tr": "Sipariş"
    },
    "unit": "count",
    "version": 3,
    "source": "backoffice",
    "owner": "Bahadır Ölez",
    "description": {
      "en": "Orders placed in the back office, by order date in Europe/Istanbul time. Test orders are excluded; cancelled orders are kept.",
      "tr": "Sipariş panelinde oluşan siparişler, İstanbul saatine göre sipariş tarihinde. Test siparişleri hariç, iptal edilen siparişler dahildir."
    },
    "definition": {
      "sum": "orders"
    },
    "where": null,
    "dimensions": [
      "day",
      "week",
      "month",
      "channel",
      "device"
    ],
    "check": "ga4_vs_orders"
  },
  "platform_conversions": {
    "id": "platform_conversions",
    "label": {
      "en": "Platform-reported conversions",
      "tr": "Platformun bildirdiği dönüşüm"
    },
    "unit": "count",
    "version": 1,
    "source": "ads",
    "owner": "Bahadır Ölez",
    "description": {
      "en": "Conversions as Google Ads, Meta Ads and TikTok Ads report them in their own interfaces, each with its own attribution window.",
      "tr": "Google Ads, Meta Ads ve TikTok Ads’in kendi arayüzlerinde, kendi atıf pencereleriyle bildirdiği dönüşümler."
    },
    "definition": {
      "sum": "platform_conversions"
    },
    "where": {
      "channel": [
        "google_ads",
        "meta_ads",
        "tiktok_ads"
      ]
    },
    "dimensions": [
      "day",
      "week",
      "month",
      "channel",
      "device"
    ],
    "check": null
  },
  "revenue": {
    "id": "revenue",
    "label": {
      "en": "Revenue",
      "tr": "Ciro"
    },
    "unit": "try",
    "version": 2,
    "source": "backoffice",
    "owner": "Bahadır Ölez",
    "description": {
      "en": "Order value in TRY including VAT, excluding shipping, from the back office. Refunds are not subtracted.",
      "tr": "Sipariş panelinden, KDV dahil ve kargo hariç TRY sipariş tutarı. İadeler düşülmez."
    },
    "definition": {
      "sum": "revenue"
    },
    "where": null,
    "dimensions": [
      "day",
      "week",
      "month",
      "channel",
      "device"
    ],
    "check": "ga4_rev_vs_revenue"
  },
  "roas": {
    "id": "roas",
    "label": {
      "en": "ROAS",
      "tr": "ROAS"
    },
    "unit": "ratio",
    "version": 2,
    "source": "backoffice+ads",
    "owner": "Bahadır Ölez",
    "description": {
      "en": "Back-office revenue from orders whose last non-direct click came from the channel, divided by that channel’s spend. Platform-reported conversions are not used.",
      "tr": "Son doğrudan olmayan tıklaması kanaldan gelen siparişlerin sipariş paneli cirosu, bölü o kanalın harcaması. Platformların bildirdiği dönüşümler kullanılmaz."
    },
    "definition": {
      "ratio": {
        "numerator": "revenue",
        "denominator": "ad_spend"
      }
    },
    "where": {
      "channel": [
        "google_ads",
        "meta_ads",
        "tiktok_ads"
      ]
    },
    "dimensions": [
      "day",
      "week",
      "month",
      "channel",
      "device"
    ],
    "check": null
  },
  "sessions": {
    "id": "sessions",
    "label": {
      "en": "Sessions",
      "tr": "Oturum"
    },
    "unit": "count",
    "version": 1,
    "source": "ga4",
    "owner": "Bahadır Ölez",
    "description": {
      "en": "GA4 sessions: distinct user_pseudo_id and ga_session_id pairs in the BigQuery export, on the day the session starts.",
      "tr": "GA4 oturumları: BigQuery dışa aktarımındaki benzersiz user_pseudo_id ve ga_session_id çiftleri; oturumun başladığı güne yazılır."
    },
    "definition": {
      "sum": "sessions"
    },
    "where": null,
    "dimensions": [
      "day",
      "week",
      "month",
      "channel",
      "device"
    ],
    "check": null
  }
};
export const METRICS = metrics as unknown as Record<MetricId, MetricInfo>;

const checks = {
  "ga4_rev_vs_revenue": {
    "id": "ga4_rev_vs_revenue",
    "label": {
      "en": "GA4 revenue against back-office revenue",
      "tr": "GA4 geliri ve sipariş panelindeki ciro"
    },
    "expected": {
      "metric": "revenue",
      "label": {
        "en": "Back-office revenue",
        "tr": "Sipariş paneli cirosu"
      }
    },
    "measured": {
      "metric": "ga4_revenue",
      "label": {
        "en": "GA4 revenue",
        "tr": "GA4 geliri"
      }
    },
    "where": null,
    "tolerance": 0.05,
    "breakdown": "device",
    "findings": [
      {
        "id": "f_ga4_mobile_safari",
        "source": "AI Tag Debugger",
        "text": {
          "en": "purchase is not sent on mobile Safari since release v4.12 (9 Oct): the thank-you page loads the tag before dataLayer is ready.",
          "tr": "v4.12 sürümünden (9 Ekim) beri mobil Safari’de purchase gitmiyor: teşekkür sayfası tag’i dataLayer hazır olmadan yüklüyor."
        },
        "since": "2026-10-09"
      }
    ]
  },
  "ga4_vs_orders": {
    "id": "ga4_vs_orders",
    "label": {
      "en": "GA4 purchases against back-office orders",
      "tr": "GA4 satın almaları ve sipariş panelindeki siparişler"
    },
    "expected": {
      "metric": "orders",
      "label": {
        "en": "Back-office orders",
        "tr": "Sipariş paneli"
      }
    },
    "measured": {
      "metric": "ga4_purchases",
      "label": {
        "en": "GA4 purchases",
        "tr": "GA4"
      }
    },
    "where": null,
    "tolerance": 0.05,
    "breakdown": "device",
    "findings": [
      {
        "id": "f_ga4_mobile_safari",
        "source": "AI Tag Debugger",
        "text": {
          "en": "purchase is not sent on mobile Safari since release v4.12 (9 Oct): the thank-you page loads the tag before dataLayer is ready.",
          "tr": "v4.12 sürümünden (9 Ekim) beri mobil Safari’de purchase gitmiyor: teşekkür sayfası tag’i dataLayer hazır olmadan yüklüyor."
        },
        "since": "2026-10-09"
      }
    ]
  },
  "gads_vs_orders": {
    "id": "gads_vs_orders",
    "label": {
      "en": "Google Ads conversions against back-office orders",
      "tr": "Google Ads dönüşümleri ve sipariş panelindeki siparişler"
    },
    "expected": {
      "metric": "orders",
      "label": {
        "en": "Back-office orders from Google Ads",
        "tr": "Google Ads kaynaklı siparişler"
      }
    },
    "measured": {
      "metric": "platform_conversions",
      "label": {
        "en": "Google Ads conversions",
        "tr": "Google Ads dönüşümleri"
      }
    },
    "where": {
      "channel": [
        "google_ads"
      ]
    },
    "tolerance": 0.1,
    "breakdown": "device",
    "findings": []
  },
  "meta_vs_orders": {
    "id": "meta_vs_orders",
    "label": {
      "en": "Meta conversions against back-office orders",
      "tr": "Meta dönüşümleri ve sipariş panelindeki siparişler"
    },
    "expected": {
      "metric": "orders",
      "label": {
        "en": "Back-office orders from Meta",
        "tr": "Meta kaynaklı siparişler"
      }
    },
    "measured": {
      "metric": "platform_conversions",
      "label": {
        "en": "Meta conversions",
        "tr": "Meta dönüşümleri"
      }
    },
    "where": {
      "channel": [
        "meta_ads"
      ]
    },
    "tolerance": 0.2,
    "breakdown": "device",
    "findings": [
      {
        "id": "f_meta_view_through",
        "source": "AI Tag Debugger",
        "text": {
          "en": "Meta counts view-through purchases (1-day view) that the back office attributes to other channels.",
          "tr": "Meta, sipariş panelinin başka kanallara atadığı görüntüleme sonrası satın almaları da sayıyor (1 günlük görüntüleme)."
        },
        "since": null
      }
    ]
  }
};
export const CHECKS = checks as unknown as Record<CheckId, CheckInfo>;
