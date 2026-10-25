-- The mart every metric reads (docs/CONTRACT.md, "The mart"): one row per date x channel x device.
--
-- This file creates two objects:
--   daily_channel_device        the table ai analyst queries
--   daily_channel_device_build  a table function that computes the rows for a date range
-- daily_channel_device_incremental.sql (nightly MERGE) and daily_channel_device_full_refresh.sql
-- (rebuild) both call the function, so there is one definition of the mart.
--
-- Every date in the range gets all 12 channel x device rows, zeros included, so a day with no orders
-- reads as 0 rather than as a missing row. ad_spend and platform_conversions are 0 outside the three
-- ad channels by construction: only ad platforms feed them.
--
-- Placeholders: {project}, {dataset}.

CREATE TABLE IF NOT EXISTS `{project}.{dataset}.daily_channel_device` (
  date                 DATE    NOT NULL OPTIONS (description = 'Europe/Istanbul calendar date'),
  channel              STRING  NOT NULL OPTIONS (description = 'organic, direct, google_ads, meta_ads, tiktok_ads, email'),
  device               STRING  NOT NULL OPTIONS (description = 'mobile, desktop'),
  sessions             INT64   NOT NULL OPTIONS (description = 'GA4 sessions'),
  orders               INT64   NOT NULL OPTIONS (description = 'Back-office orders, test orders excluded, cancellations kept'),
  revenue              NUMERIC NOT NULL OPTIONS (description = 'Back-office order value in TRY incl. VAT, excl. shipping'),
  ga4_purchases        INT64   NOT NULL OPTIONS (description = 'GA4 purchase events with a distinct transaction_id'),
  ga4_revenue          NUMERIC NOT NULL OPTIONS (description = 'GA4 purchase revenue in TRY'),
  platform_conversions INT64   NOT NULL OPTIONS (description = 'Conversions the ad platform reports (ad channels only, else 0)'),
  ad_spend             NUMERIC NOT NULL OPTIONS (description = 'Ad platform cost in TRY (ad channels only, else 0)')
)
PARTITION BY date
CLUSTER BY channel, device
OPTIONS (description = 'ai analyst mart: one row per date x channel x device. Aggregates only, no personal data.');

CREATE OR REPLACE TABLE FUNCTION `{project}.{dataset}.daily_channel_device_build`(date_from DATE, date_to DATE) AS (
  WITH
  grid AS (
    SELECT date, channel, device
    FROM UNNEST(GENERATE_DATE_ARRAY(date_from, date_to)) AS date
    CROSS JOIN UNNEST(['organic', 'direct', 'google_ads', 'meta_ads', 'tiktok_ads', 'email']) AS channel
    CROSS JOIN UNNEST(['mobile', 'desktop']) AS device
  ),

  -- Read one day earlier than the window: a purchase just after midnight can belong to a session
  -- that started the day before, and it takes that session's channel.
  ga4_sessions AS (
    SELECT * FROM `{project}.{dataset}.stg_ga4_sessions`(DATE_SUB(date_from, INTERVAL 1 DAY), date_to)
  ),

  sessions AS (
    SELECT date, channel, device, COUNT(*) AS sessions
    FROM ga4_sessions
    WHERE date BETWEEN date_from AND date_to
    GROUP BY date, channel, device
  ),

  ga4 AS (
    SELECT
      p.date,
      COALESCE(s.channel, p.event_channel) AS channel,
      p.device,
      COUNT(*) AS ga4_purchases,
      SUM(p.revenue) AS ga4_revenue
    FROM `{project}.{dataset}.stg_ga4_purchases`(date_from, date_to) AS p
    LEFT JOIN ga4_sessions AS s USING (session_key)
    GROUP BY 1, 2, 3
  ),

  backoffice AS (
    SELECT date, channel, device, COUNT(*) AS orders, SUM(revenue) AS revenue
    FROM `{project}.{dataset}.stg_orders`(date_from, date_to)
    GROUP BY date, channel, device
  ),

  ads AS (
    SELECT
      date, channel, device,
      SUM(ad_spend) AS ad_spend,
      CAST(ROUND(SUM(platform_conversions)) AS INT64) AS platform_conversions
    FROM `{project}.{dataset}.stg_ad_spend`(date_from, date_to)
    GROUP BY date, channel, device
  )

  SELECT
    g.date,
    g.channel,
    g.device,
    COALESCE(sessions.sessions, 0)                     AS sessions,
    COALESCE(backoffice.orders, 0)                     AS orders,
    COALESCE(backoffice.revenue, 0)                    AS revenue,
    COALESCE(ga4.ga4_purchases, 0)                     AS ga4_purchases,
    COALESCE(ga4.ga4_revenue, 0)                       AS ga4_revenue,
    COALESCE(ads.platform_conversions, 0)              AS platform_conversions,
    COALESCE(ads.ad_spend, 0)                          AS ad_spend
  FROM grid AS g
  LEFT JOIN sessions   ON sessions.date   = g.date AND sessions.channel   = g.channel AND sessions.device   = g.device
  LEFT JOIN ga4        ON ga4.date        = g.date AND ga4.channel        = g.channel AND ga4.device        = g.device
  LEFT JOIN backoffice ON backoffice.date = g.date AND backoffice.channel = g.channel AND backoffice.device = g.device
  LEFT JOIN ads        ON ads.date        = g.date AND ads.channel        = g.channel AND ads.device        = g.device
);
