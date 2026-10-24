// Where each reviewer flow starts (09-ux.md §2). Kept out of the product: only the review menu and /tour use it.
import type { Lang } from "@/api/types";

const q = (s: string) => `q=${encodeURIComponent(s)}`;

export function flowLinks(lang: Lang): string[] {
  const ga4 = lang === "tr" ? "Son 14 günde GA4 satın almaları siparişlerle tutuyor mu?" : "Do GA4 purchases match orders in the last 14 days?";
  const compare = lang === "tr" ? "Geçen ay e-posta ile Google Ads’i karşılaştır" : "Compare email and Google Ads last month";
  return [
    "/ask",
    `/ask?${q(ga4)}`,
    `/ask?${q(compare)}`,
    `/ask?${q(ga4)}`,
    "/dashboards/db_example?edit=1&menu=pin_rev_day",
    "/dashboards/db_example",
    "/dashboards/db_example?check=ga4_vs_orders",
    "/settings/data?connect=bigquery",
    "/settings/model?provider=anthropic",
    "/settings/chat-apps/claude-desktop",
    "/ask",
    "/settings/language",
    "/dashboards/db_example?check=ga4_vs_orders",
    `/ask?${q(lang === "tr" ? "Meta ölçüm kontrolünü izle" : "Watch the Meta tracking check")}`,
    `/ask?${q(lang === "tr" ? "Hangi hafta günü en çok ciro getiriyor?" : "Which weekday brings the most revenue?")}`,
    "/ask",
    "/metrics",
    "/dashboards/db_example",
    "/dashboards/db_example?check=ga4_vs_orders",
  ];
}

export function stateLinks(lang: Lang): string[] {
  const watch = lang === "tr" ? "Meta ölçüm kontrolünü izle" : "Watch the Meta tracking check";
  const why = lang === "tr" ? "9–22 Eki döneminde GA4 satın almaları neden sipariş panelindeki siparişlerle tutmuyor?" : "Why do GA4 purchases not match back-office orders for 9–22 Oct?";
  return [
    `/ask?${q(watch)}`,
    `/dashboards/db_example?ask=new&about=check:ga4_vs_orders&${q(why)}`,
    "/dashboards/db_example?edit=1&menu=pin_rev_day",
    "/no-such-page",
    "/metrics/orders",
  ];
}
