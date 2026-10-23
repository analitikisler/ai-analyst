-- One row per back-office order placed between date_from and date_to (Europe/Istanbul).
--
-- orders  (metrics/orders.yaml)  test orders excluded, cancelled orders kept.
-- revenue (metrics/revenue.yaml) total_try - shipping_try: TRY, VAT included, shipping excluded, refunds
--                                not subtracted.
-- channel uses the same channel_of() as GA4, over the UTMs and click ids the storefront stored for the
-- order. For CPA and ROAS to mean "last non-direct click", the storefront has to keep the last non-direct
-- values (a first-party cookie, e.g. 30 days) rather than the UTMs of the ordering visit only.
-- device  device_of(): tablet counts as mobile, NULL counts as desktop.
--
-- Reads models/landing/backoffice_orders.sql. The latest row per order_id wins (by updated_at), and the
-- test flag is applied after that, so an order later marked as a test drops out.
--
-- Placeholders: {project}, {backoffice_dataset}, {dataset}.

CREATE OR REPLACE TABLE FUNCTION `{project}.{dataset}.stg_orders`(date_from DATE, date_to DATE) AS (
  WITH latest AS (
    SELECT *
    FROM `{project}.{backoffice_dataset}.orders`
    WHERE created_at >= TIMESTAMP(date_from, 'Europe/Istanbul')
      AND created_at <  TIMESTAMP(DATE_ADD(date_to, INTERVAL 1 DAY), 'Europe/Istanbul')
    QUALIFY ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY updated_at DESC) = 1
  )

  SELECT
    order_id,
    `{project}.{dataset}.order_key`(order_id) AS order_key,
    created_at,
    DATE(created_at, 'Europe/Istanbul') AS date,
    status,
    CAST(total_try AS NUMERIC) AS total_try,
    CAST(COALESCE(shipping_try, 0) AS NUMERIC) AS shipping_try,
    CAST(total_try AS NUMERIC) - CAST(COALESCE(shipping_try, 0) AS NUMERIC) AS revenue,
    `{project}.{dataset}.channel_of`(utm_source, utm_medium, gclid, fbclid, ttclid, NULL) AS channel,
    `{project}.{dataset}.device_of`(device) AS device,
    device AS device_raw,
    `{project}.{dataset}.norm_utm`(utm_source) AS utm_source,
    `{project}.{dataset}.norm_utm`(utm_medium) AS utm_medium,
    NULLIF(TRIM(gclid), '') IS NOT NULL AS has_gclid,
    NULLIF(TRIM(fbclid), '') IS NOT NULL AS has_fbclid,
    NULLIF(TRIM(ttclid), '') IS NOT NULL AS has_ttclid,
    NULLIF(TRIM(gclid), '') AS gclid
  FROM latest
  WHERE NOT COALESCE(is_test, FALSE)
);
