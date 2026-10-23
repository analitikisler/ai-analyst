-- One row per GA4 transaction whose first purchase event falls between date_from and date_to (Europe/Istanbul).
--
-- ga4_purchases counts purchase events with a distinct ecommerce.transaction_id (metrics/ga4_purchases.yaml).
-- Duplicates are common: thank-you page reloads, a second tag, a back button. The first event per
-- transaction id wins, and its date, device, session and revenue are the ones counted. Taking one event
-- per id before grouping keeps the mart additive: a duplicate that lands in a different channel or
-- device cannot be counted twice when rows are summed.
--
-- Deduplication looks back 7 extra days, so a reload days later is not counted again by the nightly
-- incremental run. Events with no transaction id, an empty one or '(not set)' are left out.
--
-- Revenue = ecommerce.purchase_revenue, in the property currency. The pack assumes the property
-- currency is TRY; if it is not, see docs/connecting-bigquery.md.
--
-- channel is resolved in the mart by joining session_key to stg_ga4_sessions. event_channel is the
-- fallback from the purchase event's own session_traffic_source_last_click record, used when the
-- session started outside the scanned window.
--
-- Placeholders: {project}, {ga4_dataset}, {dataset}.

CREATE OR REPLACE TABLE FUNCTION `{project}.{dataset}.stg_ga4_purchases`(date_from DATE, date_to DATE) AS (
  WITH purchase_events AS (
    SELECT
      `{project}.{dataset}.order_key`(ecommerce.transaction_id) AS order_key,
      ecommerce.transaction_id AS transaction_id,
      event_timestamp,
      DATE(TIMESTAMP_MICROS(event_timestamp), 'Europe/Istanbul') AS date,
      CONCAT(user_pseudo_id, '.',
             CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)) AS session_key,
      device.category AS device_category,
      CAST(ROUND(COALESCE(ecommerce.purchase_revenue, 0), 2) AS NUMERIC) AS revenue,
      `{project}.{dataset}.channel_of`(
        COALESCE(session_traffic_source_last_click.cross_channel_campaign.source,
                 session_traffic_source_last_click.manual_campaign.source,
                 collected_traffic_source.manual_source),
        COALESCE(session_traffic_source_last_click.cross_channel_campaign.medium,
                 session_traffic_source_last_click.manual_campaign.medium,
                 collected_traffic_source.manual_medium),
        collected_traffic_source.gclid, NULL, NULL,
        session_traffic_source_last_click.google_ads_campaign.campaign_id) AS event_channel
    FROM `{project}.{ga4_dataset}.events_*`
    WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(date_from, INTERVAL 8 DAY))
                            AND FORMAT_DATE('%Y%m%d', DATE_ADD(date_to, INTERVAL 1 DAY))
      AND event_name = 'purchase'
  ),

  first_per_transaction AS (
    SELECT *
    FROM purchase_events
    WHERE order_key IS NOT NULL
      AND order_key != '(not set)'
    QUALIFY ROW_NUMBER() OVER (PARTITION BY order_key ORDER BY event_timestamp) = 1
  )

  SELECT
    order_key,
    transaction_id,
    date,
    event_timestamp,
    session_key,
    `{project}.{dataset}.device_of`(device_category) AS device,
    event_channel,
    revenue
  FROM first_per_transaction
  WHERE date BETWEEN date_from AND date_to
);
