// Channel and device from what a source records about an order or a session: a channel name, UTM source and medium,
// a device name or a user agent. Every value read here is data from the shop or the file, never an instruction.

const lower = (v) => (v == null ? "" : String(v).trim().toLowerCase());

/** A channel name as the shop or the file writes it (Turkish and English). */
const CHANNEL_NAMES = [
  [/^(organic|organic search|seo|organik|organik arama)$/, "organic"],
  [/^(direct|doğrudan|dogrudan|\(direct\)|\(none\)|none)$/, "direct"],
  [/^(google ads|google|adwords|paid search|cpc|ppc|google cpc)$/, "google_ads"],
  [/^(meta|meta ads|facebook|facebook ads|instagram|instagram ads)$/, "meta_ads"],
  [/^(tiktok|tiktok ads)$/, "tiktok_ads"],
  [/^(email|e-mail|e-posta|eposta|newsletter|bülten|bulten)$/, "email"],
  [/^(referral|referrals|referans|yönlendirme|yonlendirme|yönlendiren site|referring site)$/, "referral"],
  [/^(organic social|social|social media|sosyal|sosyal medya|organik sosyal)$/, "organic_social"],
];

/** Social networks, as a source names them (a UTM source, GA4's session source, Shopify's referring site). */
const SOCIAL = /^(?:(?:m|l|lm|www)\.)?(facebook|instagram|fb|ig|meta|t\.co|twitter|x|linkedin|lnkd\.in|pinterest|youtube|tiktok|reddit|threads|whatsapp|snapchat)(?:\.(?:com|net|in))?$/;
const SOCIAL_MEDIUM = /^(social|social-network|social_network|social-media|social_media|sm|organic_social|organic social|sosyal)$/;

/**
 * @param {{ channel?: string, source?: string, medium?: string, sourceType?: string }} o
 *   sourceType: WooCommerce's _wc_order_attribution_source_type (utm, organic, referral, typein, admin, mobile_app).
 * @returns {"organic"|"direct"|"google_ads"|"meta_ads"|"tiktok_ads"|"email"|"referral"|"organic_social"|"other"|"unknown"}
 */
export function channelFrom({ channel, source, medium, sourceType } = {}) {
  const c = lower(channel);
  if (c) {
    for (const [re, id] of CHANNEL_NAMES) if (re.test(c)) return id;
    // GA's "source / medium" in one column ("google / cpc", "(direct) / (none)"): read as source and medium.
    const sm = /^(.+?)\s+\/\s+(.+)$/.exec(c);
    if (sm && !lower(source) && !lower(medium)) return channelFrom({ source: sm[1], medium: sm[2], sourceType });
  }
  const s = lower(source);
  const m = lower(medium);
  const paid = /^(cpc|ppc|paid|paidsearch|paid_search|paid-search|paid_social|paidsocial|paid-social|cpm|display|ads?)$/.test(m) || /paid/.test(m);
  if (s || m) {
    if (/^(google|adwords|googleads|google_ads)$/.test(s) && paid) return "google_ads";
    // A paid visit from Meta or TikTok is their ads; an unpaid one is organic social.
    if (/(facebook|instagram|^meta$|^fb$|^ig$)/.test(s) && paid) return "meta_ads";
    if (/tiktok/.test(s) && paid) return "tiktok_ads";
    if (/^(email|e-mail|newsletter|mail|klaviyo|mailchimp)$/.test(m) || /^(email|newsletter|klaviyo|mailchimp)$/.test(s)) return "email";
    if (m === "organic" || (/^(google|bing|yandex|yahoo|duckduckgo)$/.test(s) && !paid)) return "organic";
    if (s === "(direct)" || (s === "direct" && (!m || m === "(none)" || m === "none"))) return "direct";
    if (!paid && (SOCIAL_MEDIUM.test(m) || SOCIAL.test(s))) return "organic_social";
    // A referral medium, or a referring site with no medium (Shopify's last visit: "blog.example.com").
    if (m === "referral" || (!m && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s))) return "referral";
    return "other";
  }
  const t = lower(sourceType);
  if (t === "typein") return "direct";
  if (t === "organic") return "organic";
  if (t === "referral") return "referral";
  if (t === "utm") return "other";
  if (c) return "other";
  return "unknown";
}

/** @returns {"mobile"|"desktop"|"unknown"} */
export function deviceFrom({ device, userAgent } = {}) {
  const d = lower(device);
  if (d) {
    if (/^(mobile|mobil|phone|smartphone|tablet|tablet pc|ios|android)$/.test(d)) return "mobile";
    if (/^(desktop|masaüstü|masaustu|computer|pc|web)$/.test(d)) return "desktop";
    return "unknown";
  }
  const ua = String(userAgent ?? "");
  if (!ua) return "unknown";
  if (/Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile Safari/i.test(ua)) return "mobile";
  if (/Windows NT|Macintosh|X11|Linux x86_64|CrOS/i.test(ua)) return "desktop";
  return "unknown";
}

/** The calendar date of a time in a time zone: an ISO time with an offset is converted, a naive one is local there. */
export function dateIn(value, timeZone = "Europe/Istanbul") {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : fmtDate(value, timeZone);
  const s = String(value).trim();
  // A naive date or time (no zone): the day as written.
  const naive = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.exec(s);
  if (naive) return `${naive[1]}-${naive[2]}-${naive[3]}`;
  // dd.mm.yyyy or dd/mm/yyyy (Turkish exports), with an optional time.
  const tr = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s);
  if (tr) return `${tr[3]}-${tr[2].padStart(2, "0")}-${tr[1].padStart(2, "0")}`;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : fmtDate(d, timeZone);
  }
  return null;
}

function fmtDate(d, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** A time zone the runtime knows, or null. */
export function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** Today's date in a time zone. */
export const todayIn = (timeZone = "Europe/Istanbul", now = new Date()) => fmtDate(now, timeZone);
