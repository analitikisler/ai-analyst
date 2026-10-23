-- Diagnosis for checks/meta_vs_orders.yaml (Meta conversions against back-office Meta orders).
-- Meta exports no click-level data, so orders cannot be matched one by one. Instead this script shows
-- what each back-office meta_ads order rests on, and how the two sides move by day and device:
--   - Meta counts purchases with its own attribution setting (by default 7-day click and 1-day view),
--     including view-through and modelled conversions; the back office counts last non-direct clicks.
--   - channel_of() gives meta_ads to an order with an fbclid and no UTM medium. Meta adds fbclid to
--     organic link clicks too, so orders resting on fbclid alone may be organic social.
--
-- Output, in order:
--   1. by day and device: meta_ads orders by evidence, against Meta conversions
--   2. by device: share of meta_ads orders resting on fbclid alone
--   3. orders from Meta sources that the rules put in organic (a non-paid medium): the boundary of the channel
--
-- Placeholders: {project}, {dataset}.

DECLARE date_to   DATE DEFAULT DATE_SUB(CURRENT_DATE('Europe/Istanbul'), INTERVAL 1 DAY);
DECLARE date_from DATE DEFAULT DATE_SUB(date_to, INTERVAL 13 DAY);

CREATE TEMP TABLE bo AS
SELECT
  *,
  CASE
    WHEN channel != 'meta_ads' THEN NULL
    WHEN utm_medium IS NOT NULL AND has_fbclid THEN 'paid UTM and fbclid'
    WHEN utm_medium IS NOT NULL THEN 'paid UTM only'
    ELSE 'fbclid only'
  END AS evidence
FROM `{project}.{dataset}.stg_orders`(date_from, date_to);

-- 1. Daily tally by device.
WITH orders AS (
  SELECT date, device,
    COUNT(*) AS orders,
    COUNTIF(evidence = 'paid UTM and fbclid') AS utm_and_fbclid,
    COUNTIF(evidence = 'paid UTM only') AS utm_only,
    COUNTIF(evidence = 'fbclid only') AS fbclid_only
  FROM bo
  WHERE channel = 'meta_ads'
  GROUP BY date, device
),
meta AS (
  SELECT date, device, SUM(platform_conversions) AS conversions
  FROM `{project}.{dataset}.stg_ad_spend`(date_from, date_to)
  WHERE channel = 'meta_ads'
  GROUP BY date, device
)
SELECT
  date, device,
  COALESCE(orders.orders, 0) AS backoffice_orders,
  COALESCE(orders.utm_and_fbclid, 0) AS utm_and_fbclid,
  COALESCE(orders.utm_only, 0) AS utm_only,
  COALESCE(orders.fbclid_only, 0) AS fbclid_only,
  ROUND(COALESCE(meta.conversions, 0), 1) AS meta_conversions,
  ROUND(SAFE_DIVIDE(COALESCE(meta.conversions, 0) - COALESCE(orders.orders, 0), orders.orders) * 100, 1) AS delta_pct
FROM orders
FULL OUTER JOIN meta USING (date, device)
ORDER BY date, device;

-- 2. Share resting on fbclid alone.
SELECT
  COALESCE(device, 'all') AS device,
  COUNT(*) AS meta_ads_orders,
  COUNTIF(evidence = 'fbclid only') AS fbclid_only,
  ROUND(SAFE_DIVIDE(COUNTIF(evidence = 'fbclid only'), COUNT(*)) * 100, 1) AS fbclid_only_pct
FROM bo
WHERE channel = 'meta_ads'
GROUP BY ROLLUP (device)
ORDER BY 1;

-- 3. Orders from Meta sources classified as organic.
SELECT device, utm_source, utm_medium, COUNT(*) AS orders
FROM bo
WHERE channel = 'organic'
  AND (utm_source IN ('facebook', 'fb', 'instagram', 'ig', 'meta', 'an', 'messenger', 'threads') OR has_fbclid)
GROUP BY 1, 2, 3
ORDER BY orders DESC;
