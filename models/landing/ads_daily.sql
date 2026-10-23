-- Landing table for ad platforms without a Google Ads-style transfer in this build: Meta Ads and TikTok Ads.
-- One row per date x platform x device x account. Aggregates only; no user-level data.
-- Filled by a connector, a third-party loader or, for Meta, from the BigQuery Data Transfer Service
-- Facebook Ads tables (see docs/connecting-bigquery.md).
--
-- Placeholders: {project}, {dataset}.

CREATE TABLE IF NOT EXISTS `{project}.{dataset}.ads_daily` (
  date        DATE    NOT NULL OPTIONS (description = 'Reporting date in the ad account time zone. Set the account to Europe/Istanbul.'),
  platform    STRING  NOT NULL OPTIONS (description = 'meta_ads or tiktok_ads. Equals the mart channel.'),
  device      STRING           OPTIONS (description = 'Device breakdown from the platform (Meta impression_device, TikTok platform). NULL counts as desktop.'),
  account_id  STRING           OPTIONS (description = 'Ad account id, for tracing.'),
  currency    STRING           OPTIONS (description = 'Account currency, ISO 4217. NULL means TRY.'),
  cost        NUMERIC          OPTIONS (description = 'Spend in the account currency.'),
  cost_try    NUMERIC          OPTIONS (description = 'Spend in TRY. Leave NULL to convert cost with fx_daily.'),
  conversions NUMERIC NOT NULL OPTIONS (description = 'Purchases as the platform reports them, with its default attribution setting.')
)
PARTITION BY date
OPTIONS (description = 'Daily Meta and TikTok spend and conversions for AI Analyst.');
