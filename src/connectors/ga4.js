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
  "Paid Search": "google_ads",
  "Paid Social": "meta_ads",
  Email: "email",
  Unassigned: "unknown",
  "(not set)": "unknown",
  "(other)": "unknown",
};
export const channelOfGroup = (g) => CHANNEL_GROUPS[g] ?? (g ? "other" : "unknown");
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

/** Google's error as a code the app knows. */
export function ga4Error(err) {
  if (err instanceof AppError) return err;
  const status = Number(err?.code ?? err?.status ?? err?.response?.status) || 0;
  const reason = safeGoogleMessage(err) ?? "no answer";
  if (status === 401) return new AppError("key_rejected", `Google did not accept the credentials (${reason}).`, { params: { status, reason } });
  if (status === 403) return new AppError("property_not_found", `These credentials cannot read this GA4 property (${reason}). Add the account as a Viewer on the property.`, { params: { status, reason } });
  if (status === 404 || status === 400) return new AppError("property_not_found", `GA4 did not find this property (${reason}). Check the property id (a number, in Admin › Property details).`, { params: { status, reason } });
  if (status === 429) return new AppError("rate_limited", `GA4's quota for this property is used up for now (${reason}). The next sync tries again.`, { params: { status, reason } });
  return new AppError("source_unavailable", `Google Analytics could not be reached (${reason}).`, { params: { service: "Google Analytics", reason, ...(status ? { status } : {}) } });
}

const DIMENSIONS = [{ name: "date" }, { name: "sessionDefaultChannelGroup" }, { name: "deviceCategory" }];
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
      const [d, group, device] = (r.dimensionValues ?? []).map((v) => v.value);
      const [sessions, transactions, revenue] = (r.metricValues ?? []).map((v) => Number(v.value) || 0);
      if (!/^\d{8}$/.test(String(d))) continue;
      rows.push({ date: isoOf(d), channel: channelOfGroup(group), device: deviceOfCategory(device), sessions, ga4_purchases: transactions, ga4_revenue: revenue });
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
