// GA4 through the Google Analytics Data API v1beta (runReport), REST through google-auth-library with the
// analytics.readonly scope: sessions, transactions and purchase revenue by date x channel group x device, as daily
// aggregates. Credentials as for BigQuery: application default credentials, a key file, or impersonating a service
// account. Only analyticsdata.googleapis.com is called. Tests pass app.ga4Transport, a stub.
import { assertCloudAllowed } from "../cloud.js";
import { AppError } from "../errors.js";
import { T } from "../text.js";
import { safeGoogleMessage } from "../warehouse/google-errors.js";

export const GA4_HOST = "analyticsdata.googleapis.com";
const SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"];

/** GA4's default channel groups to the mart's channels; any group not listed goes to "other". */
export const CHANNEL_GROUPS = {
  "Organic Search": "organic",
  Direct: "direct",
  Email: "email",
  Referral: "referral",
  "Organic Social": "organic_social",
  Unassigned: "unknown",
  "(not set)": "unknown",
  "(other)": "unknown",
};
const META = /facebook|instagram|^(fb|ig|meta)$/i;
/**
 * A channel group (with the session source, which tells the paid platforms apart): Paid Search from Google is
 * google_ads, Paid Social from Facebook or Instagram is meta_ads and from TikTok tiktok_ads; a paid group from any
 * other platform (Bing, LinkedIn, Pinterest), and Organic Video, Affiliates, Display and the rest, is "other".
 */
export function channelOfGroup(g, source = "") {
  const src = String(source ?? "").trim().toLowerCase();
  if (g === "Paid Search") return /^google(\.|$|ads)|^adwords/.test(src) || src === "google" ? "google_ads" : src ? "other" : "google_ads";
  if (g === "Paid Social") return META.test(src) ? "meta_ads" : /tiktok/.test(src) ? "tiktok_ads" : "other";
  return CHANNEL_GROUPS[g] ?? (g ? "other" : "unknown");
}
/** GA4's deviceCategory: mobile and tablet are mobile, desktop is desktop, anything else unknown. */
export const deviceOfCategory = (d) => (/^(mobile|tablet)$/i.test(String(d)) ? "mobile" : /^desktop$/i.test(String(d)) ? "desktop" : "unknown");

export const propertyId = (v) => {
  const m = /^(?:properties\/)?(\d{4,15})$/.exec(String(v ?? "").trim());
  return m ? m[1] : null;
};

/** The real transport: google-auth-library's client, requests to analyticsdata.googleapis.com only. */
export async function ga4Transport(app, auth = { kind: "adc" }) {
  if (app.ga4Transport) return app.ga4Transport;
  assertCloudAllowed("Google Analytics");
  const { GoogleAuth, Impersonated } = await import("google-auth-library");
  // Impersonating: the source credential calls IAM generateAccessToken, which needs cloud-platform; the token it
  // mints for the target service account carries analytics.readonly only.
  const sourceScopes = auth.impersonate ? ["https://www.googleapis.com/auth/cloud-platform"] : SCOPES;
  let client = await new GoogleAuth({ scopes: sourceScopes, ...(auth.kind === "key_file" && auth.path ? { keyFilename: auth.path } : {}) }).getClient();
  if (auth.impersonate) client = new Impersonated({ sourceClient: client, targetPrincipal: auth.impersonate, targetScopes: SCOPES, lifetime: 3600 });
  return {
    async identity() {
      if (auth.impersonate) return auth.impersonate;
      const c = await client.getCredentials?.().catch(() => ({}));
      return c?.client_email ?? client.email ?? null;
    },
    async runReport(property, body) {
      assertCloudAllowed("Google Analytics");
      const res = await client.request({ url: `https://${GA4_HOST}/v1beta/properties/${property}:runReport`, method: "POST", data: body, timeout: 30_000, maxRedirects: 0 });
      return res.data;
    },
  };
}

/** Google's structured error: { code, message, status, details } from the response body, when there is one. */
const googleBody = (err) => {
  const e = err?.response?.data?.error ?? err?.errors?.[0] ?? null;
  return e && typeof e === "object" ? e : {};
};
const reasonsOf = (body) => (Array.isArray(body.details) ? body.details.map((d) => d?.reason).filter((r) => typeof r === "string") : []);

/**
 * The console page that turns the Data API on for a project: built from the project number, never copied from the
 * message, and only when Google's own link (if any) points to Google's console.
 */
export function enableLink(message, project) {
  if (!/^\d{1,20}$/.test(String(project ?? ""))) return null;
  const link = String(message ?? "").match(/https:\/\/[^\s"')]+/)?.[0];
  if (link) {
    let host = "";
    try {
      host = new URL(link).hostname;
    } catch {}
    if (host !== "console.cloud.google.com" && host !== "console.developers.google.com") return null;
  }
  return `https://console.cloud.google.com/apis/api/analyticsdata.googleapis.com/overview?project=${project}`;
}

/** Google's error as a code the app knows. */
export function ga4Error(err) {
  if (err instanceof AppError) return err;
  const body = googleBody(err);
  const status = Number(body.code ?? err?.code ?? err?.status ?? err?.response?.status) || 0;
  const full = String(body.message ?? err?.message ?? "");
  const reason = safeGoogleMessage(err) ?? "no answer";
  const reasons = reasonsOf(body);
  const info = (Array.isArray(body.details) ? body.details : []).find((d) => d?.reason === "SERVICE_DISABLED")?.metadata ?? {};
  // The Data API is off in the Google Cloud project the credentials bill to.
  if (reasons.includes("SERVICE_DISABLED") || /has not been used in project \d+ before or it is disabled/i.test(full)) {
    const project = String(info.consumer ?? "").replace(/^projects\//, "") || full.match(/in project (\d+)/i)?.[1] || null;
    const link = enableLink(info.activationUrl ?? full, project);
    return new AppError("api_disabled", `The Google Analytics Data API is turned off in Google Cloud project ${project ?? "(unknown)"}. Turn it on${link ? ` at ${link}` : " in the Google Cloud console (APIs & Services)"}, wait a few minutes, and test again.`, { params: { service: "Google Analytics Data API", ...(project ? { project } : {}), ...(link ? { link } : {}) } });
  }
  // A property GA4 does not serve through the API at all (Google's demo properties): not a quota, nothing to retry.
  if (/property is denied access to the API/i.test(full)) return new AppError("property_api_denied", "Google does not let this GA4 property be read through the Data API (Google's demo properties are like this). Use a property of your own.", { params: { status, reason } });
  if (status === 401) return new AppError("key_rejected", `Google did not accept the credentials (${reason}).`, { params: { status, reason } });
  if (status === 403) return new AppError("property_not_found", `These credentials cannot read this GA4 property (${reason}). Add the account as a Viewer on the property.`, { params: { status, reason } });
  if (status === 404 || status === 400) return new AppError("property_not_found", `GA4 did not find this property (${reason}). Check the property id (a number, in Admin › Property details).`, { params: { status, reason } });
  // A real quota error says so: RESOURCE_EXHAUSTED, a quota or rate reason, or tokens used up.
  const quota = body.status === "RESOURCE_EXHAUSTED" || reasons.some((r) => /RATE_LIMIT|QUOTA|RESOURCE_EXHAUSTED/i.test(r)) || /quota|exhausted|tokens per|rate limit/i.test(full);
  if (status === 429 && quota) return new AppError("rate_limited", `GA4's quota for this property is used up for now (${reason}). The next sync tries again.`, { params: { status, reason } });
  return new AppError("source_unavailable", `Google Analytics could not be reached (${reason}).`, { params: { service: "Google Analytics", reason, ...(status ? { status } : {}) } });
}

// sessionSource tells Paid Search from Google from Bing, and Paid Social from Meta from TikTok or LinkedIn.
const DIMENSIONS = [{ name: "date" }, { name: "sessionDefaultChannelGroup" }, { name: "deviceCategory" }, { name: "sessionSource" }];
// transactions: purchase events with a transaction id, the closest match to the mart's GA4 purchases (distinct
// transaction_id). ecommercePurchases counts purchase events whether or not they carry one.
const METRICS = [{ name: "sessions" }, { name: "transactions" }, { name: "purchaseRevenue" }];
const isoOf = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

/** Plain warnings from a report's metadata. */
export function reportWarnings(meta = {}) {
  const out = [];
  if (meta.subjectToThresholding) out.push(T("GA4 withheld some rows to protect user privacy (thresholding), so small segments may read low.", "GA4 kullanıcı gizliliği için bazı satırları gizledi (eşikleme); küçük kırılımlar düşük görünebilir."));
  if (meta.samplingMetadatas?.length) out.push(T("GA4 sampled this report, so figures are estimates.", "GA4 bu raporu örnekledi; rakamlar tahmindir."));
  if (meta.dataLossFromOtherRow) out.push(T("GA4 grouped some rows into (other) because the property has many values.", "Mülkte çok sayıda değer olduğu için GA4 bazı satırları (other) altında topladı."));
  return out;
}

/**
 * Daily aggregates for [from, to], all pages.
 * @returns {Promise<{ rows: { date, channel, device, sessions, ga4_purchases, ga4_revenue }[], warnings: Text[], currency: string|null, quota: number|null }>}
 */
export async function fetchGa4Days(transport, property, from, to) {
  const rows = [];
  let offset = 0;
  let meta = {};
  let quota = null;
  for (let page = 0; page < 50; page++) {
    let data;
    try {
      data = await transport.runReport(property, { dateRanges: [{ startDate: from, endDate: to }], dimensions: DIMENSIONS, metrics: METRICS, limit: 100000, offset, keepEmptyRows: false, returnPropertyQuota: true });
    } catch (err) {
      throw ga4Error(err);
    }
    meta = data?.metadata ?? meta;
    quota = data?.propertyQuota?.tokensPerDay?.remaining ?? quota;
    for (const r of data?.rows ?? []) {
      const [d, group, device, source] = (r.dimensionValues ?? []).map((v) => v.value);
      const [sessions, transactions, revenue] = (r.metricValues ?? []).map((v) => Number(v.value) || 0);
      if (!/^\d{8}$/.test(String(d))) continue;
      rows.push({ date: isoOf(d), channel: channelOfGroup(group, source), device: deviceOfCategory(device), sessions, ga4_purchases: transactions, ga4_revenue: revenue });
    }
    offset += data?.rows?.length ?? 0;
    if (!data?.rows?.length || offset >= Number(data.rowCount ?? 0)) break;
  }
  return { rows, warnings: reportWarnings(meta), currency: meta.currencyCode ?? null, quota };
}

/** The first and last day with sessions. */
export async function ga4Range(transport, property, today) {
  const ask = async (desc) => {
    const data = await transport.runReport(property, { dateRanges: [{ startDate: "2015-08-14", endDate: today }], dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }], orderBys: [{ dimension: { dimensionName: "date" }, desc }], limit: 1 });
    const d = data?.rows?.[0]?.dimensionValues?.[0]?.value;
    return /^\d{8}$/.test(String(d)) ? isoOf(d) : null;
  };
  try {
    return { from: await ask(false), to: await ask(true) };
  } catch (err) {
    throw ga4Error(err);
  }
}
