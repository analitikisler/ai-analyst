-- One row per GA4 session that starts between date_from and date_to (Europe/Istanbul).
--
-- Session  = user_pseudo_id + ga_session_id (the metric definition in metrics/sessions.yaml).
-- Date     = Europe/Istanbul date of the session's first event. A session that crosses midnight
--            counts once, on its start date (the GA4 interface counts it on both days).
-- Channel  = channel_of() over the session's traffic source:
--              session_traffic_source_last_click.cross_channel_campaign (GA4's own last non-direct
--              source for the session, includes auto-tagged Google Ads as google / cpc),
--              then .manual_campaign, then collected_traffic_source (event-level UTMs, the only
--              option for data exported before July 2024, when the session record was added);
--            plus click ids: collected_traffic_source.gclid, and fbclid / ttclid read from
--            page_location, because the export has no field for them.
-- Device   = device_of(device.category) of the first event: tablet counts as mobile.
--
-- Events without user_pseudo_id (consent mode cookieless pings) or without ga_session_id carry no
-- session and are left out, as in GA4's own session count.
--
-- Cost: _TABLE_SUFFIX is filtered with constant expressions of the arguments, so only the daily tables
-- for the window (plus one day each side for sessions that cross midnight and for properties whose
-- time zone is not Europe/Istanbul) are scanned. events_intraday_* sort after the digits and are never
-- read: checks use complete daily tables only.
--
-- Placeholders: {project}, {ga4_dataset}, {dataset}.

CREATE OR REPLACE TABLE FUNCTION `{project}.{dataset}.stg_ga4_sessions`(date_from DATE, date_to DATE) AS (
  WITH events AS (
    SELECT
      CONCAT(user_pseudo_id, '.',
             CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)) AS session_key,
      event_timestamp,
      device.category AS device_category,
      -- Source and medium kept as a pair from the same record, first non-empty record wins.
      CASE
        WHEN session_traffic_source_last_click.cross_channel_campaign.source IS NOT NULL
          OR session_traffic_source_last_click.cross_channel_campaign.medium IS NOT NULL
          THEN STRUCT(session_traffic_source_last_click.cross_channel_campaign.source AS source,
                      session_traffic_source_last_click.cross_channel_campaign.medium AS medium)
        WHEN session_traffic_source_last_click.manual_campaign.source IS NOT NULL
          OR session_traffic_source_last_click.manual_campaign.medium IS NOT NULL
          THEN STRUCT(session_traffic_source_last_click.manual_campaign.source,
                      session_traffic_source_last_click.manual_campaign.medium)
        WHEN collected_traffic_source.manual_source IS NOT NULL
          OR collected_traffic_source.manual_medium IS NOT NULL
          THEN STRUCT(collected_traffic_source.manual_source, collected_traffic_source.manual_medium)
      END AS src,
      session_traffic_source_last_click.google_ads_campaign.campaign_id AS google_ads_campaign_id,
      collected_traffic_source.gclid AS gclid,
      REGEXP_EXTRACT((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'),
                     r'[?&#]fbclid=([^&#]+)') AS fbclid,
      REGEXP_EXTRACT((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'),
                     r'[?&#]ttclid=([^&#]+)') AS ttclid
    FROM `{project}.{ga4_dataset}.events_*`
    WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(date_from, INTERVAL 1 DAY))
                            AND FORMAT_DATE('%Y%m%d', DATE_ADD(date_to, INTERVAL 1 DAY))
      AND user_pseudo_id IS NOT NULL
  ),

  sessions AS (
    SELECT
      session_key,
      MIN(event_timestamp) AS start_ts,
      ARRAY_AGG(device_category IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS device_category,
      ARRAY_AGG(src IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS src,
      ARRAY_AGG(google_ads_campaign_id IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS google_ads_campaign_id,
      ARRAY_AGG(gclid IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS gclid,
      ARRAY_AGG(fbclid IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS fbclid,
      ARRAY_AGG(ttclid IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS ttclid
    FROM events
    WHERE session_key IS NOT NULL
    GROUP BY session_key
  )

  SELECT
    session_key,
    DATE(TIMESTAMP_MICROS(start_ts), 'Europe/Istanbul') AS date,
    `{project}.{dataset}.channel_of`(src.source, src.medium, gclid, fbclid, ttclid, google_ads_campaign_id) AS channel,
    `{project}.{dataset}.device_of`(device_category) AS device,
    src.source AS source,
    src.medium AS medium,
    gclid IS NOT NULL AS has_gclid,
    fbclid IS NOT NULL AS has_fbclid,
    ttclid IS NOT NULL AS has_ttclid
  FROM sessions
  WHERE DATE(TIMESTAMP_MICROS(start_ts), 'Europe/Istanbul') BETWEEN date_from AND date_to
);
