-- Nightly incremental load of daily_channel_device: recompute the last few days and MERGE them in.
--
-- Why 3 days: GA4 keeps updating a daily table for late events for up to two calendar days after the
-- table's date, plus the current day (support.google.com/analytics/answer/9358801). Re-running the last
-- 3 days each night picks those updates up. Schedule it in the evening, Europe/Istanbul (e.g. 21:00),
-- after the daily export has landed (usually early to mid afternoon in the property time zone).
--
-- Ad platforms restate conversions for longer (Google Ads transfer refresh window, Meta's 30-day window).
-- Run a second scheduled copy of this script once a week with lookback_days = 30.
--
-- The window ends at the last complete GA4 daily table, so a late export never produces a day with
-- orders but no sessions. That day is filled by the next run.
--
-- Placeholders: {project}, {ga4_dataset}, {dataset}.

DECLARE lookback_days INT64 DEFAULT 3;

DECLARE ga4_last DATE DEFAULT (
  SELECT MAX(SAFE.PARSE_DATE('%Y%m%d', REGEXP_EXTRACT(table_name, r'^events_(\d{8})$')))
  FROM `{project}.{ga4_dataset}.INFORMATION_SCHEMA.TABLES`
);
DECLARE date_to   DATE DEFAULT LEAST(DATE_SUB(CURRENT_DATE('Europe/Istanbul'), INTERVAL 1 DAY), ga4_last);
DECLARE date_from DATE DEFAULT DATE_SUB(CURRENT_DATE('Europe/Istanbul'), INTERVAL lookback_days DAY);

ASSERT ga4_last IS NOT NULL AS 'No GA4 daily events_YYYYMMDD table found in {ga4_dataset}.';

IF date_from <= date_to THEN
  ASSERT NOT EXISTS (
    SELECT 1 FROM `{project}.{dataset}.stg_ad_spend`(date_from, date_to) WHERE ad_spend IS NULL
  ) AS 'Ad spend without a TRY rate: load fx_daily for the account currency, or fill ads_daily.cost_try.';

  CREATE TEMP TABLE fresh AS
  SELECT * FROM `{project}.{dataset}.daily_channel_device_build`(date_from, date_to);

  MERGE `{project}.{dataset}.daily_channel_device` AS t
  USING fresh AS s
  ON  t.date = s.date
  AND t.channel = s.channel
  AND t.device = s.device
  WHEN MATCHED THEN UPDATE SET
    sessions             = s.sessions,
    orders               = s.orders,
    revenue              = s.revenue,
    ga4_purchases        = s.ga4_purchases,
    ga4_revenue          = s.ga4_revenue,
    platform_conversions = s.platform_conversions,
    ad_spend             = s.ad_spend
  WHEN NOT MATCHED BY TARGET THEN
    INSERT (date, channel, device, sessions, orders, revenue, ga4_purchases, ga4_revenue, platform_conversions, ad_spend)
    VALUES (s.date, s.channel, s.device, s.sessions, s.orders, s.revenue, s.ga4_purchases, s.ga4_revenue, s.platform_conversions, s.ad_spend)
  -- Rows in the window that the build no longer produces (none today, since the grid is complete) are removed.
  WHEN NOT MATCHED BY SOURCE AND t.date BETWEEN date_from AND date_to THEN
    DELETE;
END IF;
