// A simulated AI Tag Debugger audit of the purchase journey (owner round 5). Nothing is called: the steps, hits and the
// result are scripted to match the demo's planted problem (purchase not sent on mobile Safari since v4.12). In the real
// app this would be the companion tool's MCP tools (start_audit, browser_action, finish_audit); see PHASE2.md.
import type { AuditPlatform, AuditRun, AuditStep, CheckId, Text } from "../types";
import { T } from "./text";

const STEPS: { name: Text; path: string; events: Record<AuditPlatform, string | null> }[] = [
  { name: T("Home page", "Ana sayfa"), path: "/", events: { ga4: "page_view", google_ads: null, meta: "PageView", tiktok: "Pageview" } },
  { name: T("Product page", "Ürün sayfası"), path: "/urun/yun-palto-lacivert", events: { ga4: "view_item", google_ads: null, meta: "ViewContent", tiktok: "ViewContent" } },
  { name: T("Add to cart", "Sepete ekleme"), path: "/sepet", events: { ga4: "add_to_cart", google_ads: null, meta: "AddToCart", tiktok: "AddToCart" } },
  { name: T("Checkout", "Ödeme"), path: "/odeme", events: { ga4: "begin_checkout", google_ads: null, meta: "InitiateCheckout", tiktok: "InitiateCheckout" } },
  { name: T("Thank-you page", "Teşekkür sayfası"), path: "/odeme/tesekkurler", events: { ga4: "purchase", google_ads: "conversion (purchase)", meta: "Purchase", tiktok: "CompletePayment" } },
];

export function runAudit(input: { check: CheckId; url: string; platforms: AuditPlatform[]; device: string }, fixed: boolean, at: string, id: string): AuditRun {
  const host = input.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const steps: AuditStep[] = STEPS.map((s, i) => ({
    name: s.name,
    url: `https://${host}${s.path}`,
    hits: input.platforms
      .map((p) => ({ platform: p, event: s.events[p] }))
      .filter((h): h is { platform: AuditPlatform; event: string } => !!h.event)
      .map((h) => ({ ...h, status: i === STEPS.length - 1 && h.platform === "ga4" && !fixed ? ("missing" as const) : ("sent" as const) })),
  }));
  const result = fixed
    ? {
        ok: true,
        severity: "none" as const,
        title: T("purchase is sent on the thank-you page on mobile Safari", "mobil Safari’de teşekkür sayfasında purchase gönderiliyor"),
        evidence: [T("GA4 purchase hit with transaction_id ORN-104822 on the thank-you page.", "Teşekkür sayfasında transaction_id ORN-104822 ile GA4 purchase isteği.")],
        fix: T("Nothing to fix. The tracking check adds up again once the new days are in the mart.", "Düzeltilecek bir şey yok. Yeni günler mart tablosuna girdiğinde ölçüm kontrolü yeniden tutar."),
        console: null,
      }
    : {
        ok: false,
        severity: "high" as const,
        title: T("purchase is not sent on the thank-you page on mobile Safari: the tag fires before dataLayer is ready", "mobil Safari’de teşekkür sayfasında purchase gönderilmiyor: tag, dataLayer hazır olmadan çalışıyor"),
        evidence: [
          T("No GA4 purchase hit on the thank-you page; page_view, add_to_cart and begin_checkout were sent.", "Teşekkür sayfasında GA4 purchase isteği yok; page_view, add_to_cart ve begin_checkout gönderildi."),
          T("The purchase tag fired 180 ms before the ecommerce object was pushed to dataLayer.", "purchase tag’i, ecommerce nesnesi dataLayer’a eklenmeden 180 ms önce çalıştı."),
        ],
        fix: T(
          "Fire the GA4 purchase tag on the custom event pushed with the ecommerce object (event: purchase), not on page load, and publish a new GTM version.",
          "GA4 purchase tag’i sayfa yüklemesinde değil, ecommerce nesnesiyle gönderilen özel olayda (event: purchase) çalıştırılmalı ve yeni bir GTM sürümü yayımlanmalı.",
        ),
        console: "TypeError: Cannot read properties of undefined (reading 'transaction_id') at gtm.js?id=GTM-ORNK:1:48213",
      };
  return { id, check: input.check, journey: "purchase", device: input.device, url: `https://${host}`, platforms: input.platforms, started_at: at, finished_at: at, steps, result, fixed, status: "done" as const };
}
