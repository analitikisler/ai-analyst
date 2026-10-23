-- Diagnosis for checks/gads_vs_orders.yaml (Google Ads conversions against back-office Google Ads orders).
-- The two sides are not expected to be equal day by day:
--   - Google Ads dates a conversion by the ad click; the back office dates an order when it is placed.
--   - metrics_conversions counts every primary conversion action, fractionally under data-driven
--     attribution, across devices and with Google's own lookback window.
--   - The back office credits google_ads only when the stored last non-direct visit carried a gclid or
--     Google paid UTMs.
-- This script shows how much of the gap each of those explains.
--
-- Output, in order:
--   1. by day and device: back-office google_ads orders (split by gclid and UTM only) against conversions
--   2. click-to-order lag for orders whose gclid is found in p_ads_ClickStats_*: the share of orders whose
--      click falls on an earlier day is the share Google Ads reports on a different date
--   3. gclids in orders that ClickStats does not know (wrong account, expired, or edited by the storefront)
--
-- ClickStats is the click_view report, one row per click, kept by Google Ads for about 90 days.
--
-- Placeholders: {project}, {ads_dataset}, {dataset}.

DECLARE date_to   DATE DEFAULT DATE_SUB(CURRENT_DATE('Europe/Istanbul'), INTERVAL 1 DAY);
DECLARE date_from DATE DEFAULT DATE_SUB(date_to, INTERVAL 13 DAY);
DECLARE click_lookback_days INT64 DEFAULT 30;

CREATE TEMP TABLE gads_orders AS
SELECT * FROM `{project}.{dataset}.stg_orders`(date_from, date_to)
WHERE channel = 'google_ads';

-- 1. Daily tally by device.
WITH bo AS (
  SELECT date, device,
    COUNT(*) AS orders,
    COUNTIF(has_gclid) AS orders_with_gclid,
    COUNTIF(NOT has_gclid) AS orders_utm_only
  FROM gads_orders
  GROUP BY date, device
),
ads AS (
  SELECT date, device, SUM(platform_conversions) AS conversions, SUM(ad_spend) AS ad_spend
  FROM `{project}.{dataset}.stg_ad_spend`(date_from, date_to)
  WHERE channel = 'google_ads'
  GROUP BY date, device
)
SELECT
  date, device,
  COALESCE(bo.orders, 0) AS backoffice_orders,
  COALESCE(bo.orders_with_gclid, 0) AS with_gclid,
  COALESCE(bo.orders_utm_only, 0) AS utm_only,
  ROUND(COALESCE(ads.conversions, 0), 1) AS google_ads_conversions,
  ROUND(SAFE_DIVIDE(COALESCE(ads.conversions, 0) - COALESCE(bo.orders, 0), bo.orders) * 100, 1) AS delta_pct
FROM bo
FULL OUTER JOIN ads USING (date, device)
ORDER BY date, device;

-- Orders matched to their click.
CREATE TEMP TABLE clicked AS
SELECT
  o.order_id,
  o.date AS order_date,
  o.device AS order_device,
  c.click_date,
  `{project}.{dataset}.device_of`(c.segments_device) AS click_device,
  c.click_date IS NOT NULL AS found
FROM gads_orders AS o
LEFT JOIN (
  SELECT click_view_gclid, segments_device, segments_date AS click_date
  FROM `{project}.{ads_dataset}.p_ads_ClickStats_*`
  WHERE segments_date BETWEEN DATE_SUB(date_from, INTERVAL click_lookback_days DAY) AND date_to
  QUALIFY ROW_NUMBER() OVER (PARTITION BY click_view_gclid ORDER BY segments_date) = 1
) AS c
  ON c.click_view_gclid = o.gclid
WHERE o.has_gclid;

-- 2. Click-to-order lag.
SELECT
  order_device AS device,
  CASE
    WHEN NOT found THEN 'gclid not in ClickStats'
    WHEN DATE_DIFF(order_date, click_date, DAY) = 0 THEN 'same day'
    WHEN DATE_DIFF(order_date, click_date, DAY) = 1 THEN '1 day'
    WHEN DATE_DIFF(order_date, click_date, DAY) <= 7 THEN '2 to 7 days'
    ELSE '8 to 30 days'
  END AS click_to_order,
  COUNT(*) AS orders,
  COUNTIF(found AND click_device != order_device) AS clicked_on_other_device
FROM clicked
GROUP BY 1, 2
ORDER BY device, click_to_order;

-- 3. Orders whose gclid ClickStats does not know.
SELECT order_id, order_date, order_device
FROM clicked
WHERE NOT found
ORDER BY order_date DESC
LIMIT 100;
