// Loads the metric pack (metrics/*.yaml, checks/*.yaml) and validates it against the mart.
// Every identifier that ever reaches SQL comes from here, so a pack that names an unknown
// column, dimension or filter value is refused at load time, not at query time.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

/** The one model every metric reads, and the values its dimensions can take. */
export const MART = {
  model: "daily_channel_device",
  measures: ["sessions", "orders", "revenue", "ga4_purchases", "ga4_revenue", "platform_conversions", "ad_spend"],
  dimensions: {
    // "other": a source's channel with no mart channel; "unknown": the source cannot attribute (connectors).
    channel: ["organic", "direct", "google_ads", "meta_ads", "tiktok_ads", "email", "other", "unknown"],
    device: ["mobile", "desktop", "unknown"],
  },
  groupBy: ["none", "day", "week", "month", "channel", "device"],
};

// Display names; the bilingual server strings (src/text.js) hold the rest.
export const NAMES = {
  channel: {
    organic: { en: "Organic search", tr: "Organik arama" },
    direct: { en: "Direct", tr: "Doğrudan" },
    google_ads: { en: "Google Ads", tr: "Google Ads" },
    meta_ads: { en: "Meta Ads", tr: "Meta Ads" },
    tiktok_ads: { en: "TikTok Ads", tr: "TikTok Ads" },
    email: { en: "Email", tr: "E-posta" },
    other: { en: "Other channels", tr: "Diğer kanallar" },
    unknown: { en: "Unknown", tr: "Bilinmiyor" },
  },
  device: { mobile: { en: "Mobile", tr: "Mobil" }, desktop: { en: "Desktop", tr: "Masaüstü" }, unknown: { en: "Unknown", tr: "Bilinmiyor" } },
  source: {
    backoffice: { en: "Back office (ikas)", tr: "Sipariş paneli (ikas)" },
    ga4: { en: "GA4 BigQuery export", tr: "GA4 BigQuery dışa aktarımı" },
    ads: { en: "Google Ads, Meta Ads, TikTok Ads", tr: "Google Ads, Meta Ads, TikTok Ads" },
  },
};

const id = z.string().regex(/^[a-z0-9_]+$/, "ids are lowercase letters, digits and _");
const label = z.object({ en: z.string().min(1), tr: z.string().min(1) }).strict();
const measure = z.enum(MART.measures);
const where = z
  .object({
    channel: z.array(z.enum(MART.dimensions.channel)).min(1).optional(),
    device: z.array(z.enum(MART.dimensions.device)).min(1).optional(),
  })
  .strict();

const metricSchema = z
  .object({
    id,
    version: z.number().int().positive(),
    label,
    unit: z.enum(["count", "try", "pct", "ratio"]),
    source: z.string().regex(/^(backoffice|ga4|ads)(\+(backoffice|ga4|ads))*$/, "source is backoffice, ga4 or ads, joined with +"),
    owner: z.string().min(1),
    description: label,
    model: z.literal(MART.model),
    sum: measure.optional(),
    ratio: z.object({ numerator: measure, denominator: measure }).strict().optional(),
    where: where.optional(),
    dimensions: z.array(z.enum(["day", "week", "month", "channel", "device"])).min(1),
    check: id.optional(),
    history: z
      .array(z.object({ version: z.number().int().positive(), date: z.union([z.string(), z.date()]).transform((d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d)), actor: z.string().min(1), change: label }).strict())
      .optional(),
  })
  .strict()
  .refine((m) => Boolean(m.sum) !== Boolean(m.ratio), { message: "a metric has either sum or ratio, not both" });

const checkSchema = z
  .object({
    id,
    label,
    expected: z.object({ metric: id, label }).strict(),
    measured: z.object({ metric: id, label }).strict(),
    where: where.optional(),
    tolerance: z.number().min(0).max(1),
    breakdown: z.enum(["channel", "device"]),
  })
  .strict();

function readDir(dir, schema, kind) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort();
  const out = {};
  for (const file of files) {
    const where = path.join(path.basename(dir), file);
    let raw;
    try {
      raw = parse(readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      throw new Error(`${where} is not valid YAML: ${err.message}`);
    }
    const result = schema.safeParse(raw);
    if (!result.success) throw new Error(`${where} is not a valid ${kind}:\n${z.prettifyError(result.error)}`);
    const stem = file.replace(/\.ya?ml$/, "");
    if (result.data.id !== stem) throw new Error(`${where}: id "${result.data.id}" must equal the file name "${stem}".`);
    out[stem] = result.data;
  }
  return out;
}

/**
 * @param {string} dir the folder that holds metrics/ and checks/
 * @returns {{ metrics: Record<string, any>, checks: Record<string, any>, dimensions: typeof MART.dimensions }}
 */
export function loadPack(dir) {
  const metrics = readDir(path.join(dir, "metrics"), metricSchema, "metric");
  const checks = readDir(path.join(dir, "checks"), checkSchema, "check");
  if (!Object.keys(metrics).length) throw new Error(`No metrics found in ${path.join(dir, "metrics")}.`);
  for (const c of Object.values(checks)) {
    for (const side of ["expected", "measured"]) {
      const m = metrics[c[side].metric];
      if (!m) throw new Error(`checks/${c.id}.yaml: ${side} metric "${c[side].metric}" is not in the pack.`);
      // A check adds up daily sums, so a ratio would be averaged by accident.
      if (!m.sum) throw new Error(`checks/${c.id}.yaml: ${side} metric "${m.id}" must be a sum, not a ratio.`);
    }
  }
  for (const m of Object.values(metrics)) {
    if (m.check && !checks[m.check]) throw new Error(`metrics/${m.id}.yaml: check "${m.check}" is not in the pack.`);
  }
  return { metrics, checks, dimensions: MART.dimensions };
}
