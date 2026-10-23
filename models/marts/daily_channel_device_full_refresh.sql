-- Full rebuild of daily_channel_device, from the first GA4 daily table (or a chosen start date) to the
-- last complete one. Use it on first setup, after a change to channel_of() / device_of() or to a staging
-- model, and after a GA4 reprocessing notice.
--
-- Cost: scans the used GA4 columns over the whole history. Dry-run it first (docs/connecting-bigquery.md).
-- To limit the scan, set date_from to a later date; earlier rows are then dropped from the mart.
--
-- Placeholders: {project}, {ga4_dataset}, {dataset}.

DECLARE ga4_first DATE DEFAULT (
  SELECT MIN(SAFE.PARSE_DATE('%Y%m%d', REGEXP_EXTRACT(table_name, r'^events_(\d{8})$')))
  FROM `{project}.{ga4_dataset}.INFORMATION_SCHEMA.TABLES`
);
DECLARE ga4_last DATE DEFAULT (
  SELECT MAX(SAFE.PARSE_DATE('%Y%m%d', REGEXP_EXTRACT(table_name, r'^events_(\d{8})$')))
  FROM `{project}.{ga4_dataset}.INFORMATION_SCHEMA.TABLES`
);
DECLARE date_from DATE DEFAULT ga4_first;  -- or e.g. DATE '2026-01-01'
DECLARE date_to   DATE DEFAULT LEAST(DATE_SUB(CURRENT_DATE('Europe/Istanbul'), INTERVAL 1 DAY), ga4_last);

ASSERT ga4_first IS NOT NULL AS 'No GA4 daily events_YYYYMMDD table found in {ga4_dataset}.';

ASSERT NOT EXISTS (
  SELECT 1 FROM `{project}.{dataset}.stg_ad_spend`(date_from, date_to) WHERE ad_spend IS NULL
) AS 'Ad spend without a TRY rate: load fx_daily for the account currency, or fill ads_daily.cost_try.';

-- Build into a staging table first, then swap, so the live mart is never half-written.
CREATE OR REPLACE TABLE `{project}.{dataset}.daily_channel_device__rebuild`
PARTITION BY date
CLUSTER BY channel, device
AS
SELECT * FROM `{project}.{dataset}.daily_channel_device_build`(date_from, date_to);

ASSERT (
  SELECT COUNT(*) = DATE_DIFF(date_to, date_from, DAY) * 12 + 12
     AND COUNT(*) = COUNT(DISTINCT FORMAT('%t|%s|%s', date, channel, device))
  FROM `{project}.{dataset}.daily_channel_device__rebuild`
) AS 'Rebuild does not have exactly one row per date x channel x device.';

BEGIN TRANSACTION;
  DELETE FROM `{project}.{dataset}.daily_channel_device` WHERE TRUE;
  INSERT INTO `{project}.{dataset}.daily_channel_device`
    (date, channel, device, sessions, orders, revenue, ga4_purchases, ga4_revenue, platform_conversions, ad_spend)
  SELECT date, channel, device, sessions, orders, revenue, ga4_purchases, ga4_revenue, platform_conversions, ad_spend
  FROM `{project}.{dataset}.daily_channel_device__rebuild`;
COMMIT TRANSACTION;

DROP TABLE `{project}.{dataset}.daily_channel_device__rebuild`;
