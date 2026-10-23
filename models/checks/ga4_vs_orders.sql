-- Order-level diagnosis for checks/ga4_vs_orders.yaml (GA4 purchases against back-office orders).
-- The check itself compares daily sums in the mart; this script joins each back-office order to its GA4
-- purchase on order_id = transaction_id, to show which orders GA4 misses and where.
--
-- Run it in the BigQuery console with an identity that can read the raw datasets. Results contain order
-- ids but no personal data; keep them in the client's project and do not paste them into a chat with a model.
--
-- Output, in order:
--   1. the tally as the check computes it, by device, with the match rate
--   2. match rate by day and device: shows the first day a device starts losing purchases
--   3. unmatched orders by status and channel: e.g. bank transfer orders that skip the thank-you page
--   4. up to 200 unmatched orders, newest first
--   5. GA4 transactions with no back-office order (test orders, other stores sharing the property, id format)
--
-- Placeholders: {project}, {dataset}.

DECLARE date_to   DATE DEFAULT DATE_SUB(CURRENT_DATE('Europe/Istanbul'), INTERVAL 1 DAY);
DECLARE date_from DATE DEFAULT DATE_SUB(date_to, INTERVAL 13 DAY);

-- Both sides are read one day wider than the window, so an order at 23:59 and its purchase event at
-- 00:01 still match. Counts use each side's own date inside the window, as the check does.
CREATE TEMP TABLE bo  AS SELECT * FROM `{project}.{dataset}.stg_orders`(DATE_SUB(date_from, INTERVAL 1 DAY), DATE_ADD(date_to, INTERVAL 1 DAY));
CREATE TEMP TABLE ga4 AS SELECT * FROM `{project}.{dataset}.stg_ga4_purchases`(DATE_SUB(date_from, INTERVAL 1 DAY), DATE_ADD(date_to, INTERVAL 1 DAY));

CREATE TEMP TABLE pairs AS
SELECT
  o.order_key,
  o.order_id,
  o.date        AS order_date,
  o.created_at,
  o.device      AS order_device,
  o.channel     AS order_channel,
  o.status,
  o.revenue,
  g.date        AS ga4_date,
  g.device      AS ga4_device,
  g.order_key IS NOT NULL AS matched
FROM bo AS o
LEFT JOIN ga4 AS g ON g.order_key = o.order_key
WHERE o.date BETWEEN date_from AND date_to;

-- 1. Tally by device, plus the match rate.
SELECT
  COALESCE(device, 'all') AS device,
  SUM(orders) AS backoffice_orders,
  SUM(ga4_purchases) AS ga4_purchases,
  SUM(ga4_purchases) - SUM(orders) AS delta,
  ROUND(SAFE_DIVIDE(SUM(ga4_purchases) - SUM(orders), SUM(orders)) * 100, 1) AS delta_pct,
  SUM(matched) AS matched_orders,
  ROUND(SAFE_DIVIDE(SUM(matched), SUM(orders)) * 100, 1) AS match_rate_pct
FROM (
  SELECT order_device AS device, 1 AS orders, 0 AS ga4_purchases, IF(matched, 1, 0) AS matched FROM pairs
  UNION ALL
  SELECT device, 0, 1, 0 FROM ga4 WHERE date BETWEEN date_from AND date_to
)
GROUP BY ROLLUP (device)
ORDER BY 1;  -- 'all' sorts first

-- 2. Match rate by day and device.
SELECT
  order_date AS date,
  order_device AS device,
  COUNT(*) AS orders,
  COUNTIF(matched) AS matched,
  ROUND(SAFE_DIVIDE(COUNTIF(matched), COUNT(*)) * 100, 1) AS match_rate_pct,
  COUNTIF(matched AND ga4_date != order_date) AS matched_on_other_date,
  COUNTIF(matched AND ga4_device != order_device) AS matched_on_other_device
FROM pairs
GROUP BY date, device
ORDER BY date, device;

-- 3. Unmatched orders by device, status and channel.
SELECT
  order_device AS device,
  COALESCE(status, '(none)') AS status,
  order_channel AS channel,
  COUNT(*) AS unmatched_orders,
  ROUND(SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER (PARTITION BY order_device)) * 100, 1) AS pct_of_device_unmatched
FROM pairs
WHERE NOT matched
GROUP BY 1, 2, 3
ORDER BY device, unmatched_orders DESC;

-- 4. Unmatched orders, newest first.
SELECT order_id, created_at, order_date, order_device, order_channel, status, revenue
FROM pairs
WHERE NOT matched
ORDER BY created_at DESC
LIMIT 200;

-- 5. GA4 transactions in the window with no back-office order (bo is read a day wider, so these are real misses).
SELECT
  g.device,
  COUNT(*) AS ga4_without_order,
  ARRAY_AGG(g.transaction_id ORDER BY g.event_timestamp DESC LIMIT 20) AS sample_transaction_ids
FROM ga4 AS g
LEFT JOIN bo AS o ON o.order_key = g.order_key
WHERE g.date BETWEEN date_from AND date_to
  AND o.order_key IS NULL
GROUP BY g.device;
