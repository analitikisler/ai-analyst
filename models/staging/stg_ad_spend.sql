-- Ad spend in TRY and platform-reported conversions, one row per date x channel x device x currency source.
--
-- Google Ads  BigQuery Data Transfer Service tables in {ads_dataset}:
--               p_ads_CampaignBasicStats_<customer_id>  segments_date, segments_device, metrics_cost_micros,
--                                                       metrics_conversions, customer_id
--               p_ads_Customer_<customer_id>            customer_currency_code, customer_time_zone
--             The wildcard picks up every customer id the transfer writes (one table per account under a
--             manager account). segments_date is in the account time zone; set accounts to Europe/Istanbul.
--             metrics_conversions is Google Ads' "Conversions" column: every primary conversion action,
--             fractional under data-driven attribution, dated by the ad click rather than the conversion.
-- Meta, TikTok  {dataset}.ads_daily (models/landing/ads_daily.sql).
-- TRY           cost_try when the landing table gives it; otherwise cost x the latest fx_daily rate on or
--               before the date (TCMB publishes on business days only). A missing rate yields NULL, which
--               the build scripts refuse with an ASSERT rather than counting as zero.
--
-- Placeholders: {project}, {ads_dataset}, {dataset}.

CREATE OR REPLACE TABLE FUNCTION `{project}.{dataset}.stg_ad_spend`(date_from DATE, date_to DATE) AS (
  WITH google_currency AS (
    -- An account's currency cannot change, so any snapshot row will do.
    SELECT customer_id, UPPER(ANY_VALUE(customer_currency_code)) AS currency
    FROM `{project}.{ads_dataset}.p_ads_Customer_*`
    GROUP BY customer_id
  ),

  google AS (
    SELECT
      s.segments_date AS date,
      'google_ads' AS channel,
      `{project}.{dataset}.device_of`(s.segments_device) AS device,
      COALESCE(c.currency, 'TRY') AS currency,
      CAST(SUM(s.metrics_cost_micros) AS NUMERIC) / 1000000 AS cost,
      CAST(NULL AS NUMERIC) AS cost_try,
      CAST(SUM(s.metrics_conversions) AS NUMERIC) AS conversions
    FROM `{project}.{ads_dataset}.p_ads_CampaignBasicStats_*` AS s
    LEFT JOIN google_currency AS c USING (customer_id)
    WHERE s.segments_date BETWEEN date_from AND date_to
    GROUP BY date, channel, device, currency
  ),

  landing AS (
    SELECT
      date,
      platform AS channel,
      `{project}.{dataset}.device_of`(device) AS device,
      UPPER(COALESCE(currency, 'TRY')) AS currency,
      SUM(cost) AS cost,
      -- Keep NULL when any row lacks cost_try, so those rows are converted rather than half-counted.
      IF(COUNTIF(cost_try IS NULL) = 0, SUM(cost_try), NULL) AS cost_try,
      SUM(conversions) AS conversions
    FROM `{project}.{dataset}.ads_daily`
    WHERE date BETWEEN date_from AND date_to
      AND platform IN ('meta_ads', 'tiktok_ads')
    GROUP BY date, channel, device, currency
  ),

  spend AS (
    SELECT * FROM google
    UNION ALL
    SELECT * FROM landing
  ),

  priced AS (
    SELECT
      a.date, a.channel, a.device, a.currency, a.cost, a.cost_try, a.conversions,
      IF(a.currency = 'TRY', 1, f.try_per_unit) AS try_per_unit
    FROM spend AS a
    LEFT JOIN `{project}.{dataset}.fx_daily` AS f
      ON  f.currency = a.currency
      AND f.date <= a.date
      AND f.date >  DATE_SUB(a.date, INTERVAL 10 DAY)
    WHERE TRUE  -- older BigQuery releases require a WHERE next to QUALIFY
    QUALIFY ROW_NUMBER() OVER (PARTITION BY a.date, a.channel, a.device, a.currency ORDER BY f.date DESC) = 1
  )

  SELECT
    date,
    channel,
    device,
    currency,
    COALESCE(cost_try, cost * try_per_unit) AS ad_spend,
    conversions AS platform_conversions
  FROM priced
);
