-- Order-level diagnosis for checks/ga4_rev_vs_revenue.yaml (GA4 revenue against back-office revenue).
-- Splits the revenue gap into two parts that need different fixes:
--   missing   orders GA4 never saw (or GA4 transactions with no order): a tracking gap, see ga4_vs_orders.sql
--   value     orders both sides saw, at a different value: what the purchase event sends as `value`
-- The back-office figure is VAT included, shipping excluded (metrics/revenue.yaml); the GA4 purchase
-- event has to send the same, or the value part never closes.
--
-- Run with an identity that can read the raw datasets. Results contain order ids, no personal data.
--
-- Output, in order:
--   1. the gap by device, split into missing and value
--   2. matched orders by value pattern: same, includes shipping, net of VAT, other
--   3. up to 100 matched orders with the largest value difference
--
-- Placeholders: {project}, {dataset}.

DECLARE date_to   DATE DEFAULT DATE_SUB(CURRENT_DATE('Europe/Istanbul'), INTERVAL 1 DAY);
DECLARE date_from DATE DEFAULT DATE_SUB(date_to, INTERVAL 13 DAY);
DECLARE tolerance_try NUMERIC DEFAULT 1;  -- rounding allowance per order

CREATE TEMP TABLE bo  AS SELECT * FROM `{project}.{dataset}.stg_orders`(DATE_SUB(date_from, INTERVAL 1 DAY), DATE_ADD(date_to, INTERVAL 1 DAY));
CREATE TEMP TABLE ga4 AS SELECT * FROM `{project}.{dataset}.stg_ga4_purchases`(DATE_SUB(date_from, INTERVAL 1 DAY), DATE_ADD(date_to, INTERVAL 1 DAY));

-- One row per order or GA4 transaction in the window, each side on its own date as the check counts it.
CREATE TEMP TABLE sides AS
SELECT
  COALESCE(o.order_key, g.order_key) AS order_key,
  COALESCE(o.device, g.device) AS device,
  IF(o.date BETWEEN date_from AND date_to, o.revenue, 0) AS bo_revenue,
  IF(g.date BETWEEN date_from AND date_to, g.revenue, 0) AS ga4_revenue,
  o.order_key IS NOT NULL AND g.order_key IS NOT NULL AS matched,
  o.total_try,
  o.shipping_try,
  o.revenue AS bo_value,
  g.revenue AS ga4_value,
  o.order_id,
  o.date AS order_date
FROM bo AS o
FULL OUTER JOIN ga4 AS g ON g.order_key = o.order_key
WHERE o.date BETWEEN date_from AND date_to
   OR g.date BETWEEN date_from AND date_to;

-- 1. Gap by device: total = missing + value.
SELECT
  COALESCE(device, 'all') AS device,
  SUM(bo_revenue) AS backoffice_revenue,
  SUM(ga4_revenue) AS ga4_revenue,
  SUM(ga4_revenue) - SUM(bo_revenue) AS delta,
  ROUND(SAFE_DIVIDE(SUM(ga4_revenue) - SUM(bo_revenue), SUM(bo_revenue)) * 100, 1) AS delta_pct,
  SUM(IF(matched, 0, ga4_revenue - bo_revenue)) AS delta_from_missing,
  SUM(IF(matched, ga4_revenue - bo_revenue, 0)) AS delta_from_value
FROM sides
GROUP BY ROLLUP (device)
ORDER BY 1;  -- 'all' sorts first

-- 2. Matched orders by value pattern. VAT in Türkiye is 20, 10 or 1 per cent depending on the product,
--    so "net of VAT" is a range, not one ratio.
SELECT
  device,
  CASE
    WHEN ABS(ga4_value - bo_value) <= tolerance_try THEN 'same value'
    WHEN shipping_try > 0 AND ABS(ga4_value - total_try) <= tolerance_try THEN 'GA4 includes shipping'
    WHEN ga4_value BETWEEN bo_value / 1.20 - tolerance_try AND bo_value / 1.01 + tolerance_try THEN 'GA4 looks net of VAT'
    WHEN ga4_value = 0 THEN 'GA4 value is 0'
    WHEN ga4_value > bo_value THEN 'GA4 higher, other'
    ELSE 'GA4 lower, other'
  END AS pattern,
  COUNT(*) AS orders,
  SUM(ga4_value - bo_value) AS delta
FROM sides
WHERE matched AND order_date BETWEEN date_from AND date_to
GROUP BY 1, 2
ORDER BY device, orders DESC;

-- 3. Largest value differences among matched orders.
SELECT order_id, order_date, device, bo_value, ga4_value, ga4_value - bo_value AS delta, shipping_try, total_try
FROM sides
WHERE matched AND order_date BETWEEN date_from AND date_to
ORDER BY ABS(ga4_value - bo_value) DESC
LIMIT 100;
