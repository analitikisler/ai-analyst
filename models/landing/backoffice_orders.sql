-- Expected schema of the back-office orders table that stg_orders reads.
-- The client's export (or our connector) fills it; the mart only reads it.
-- One row per order. Re-exporting an order with a later updated_at is fine: stg_orders keeps the latest row.
--
-- Personal data does not belong here: no names, e-mail addresses, phone numbers, postal addresses or
-- customer ids. Click ids (gclid, fbclid, ttclid) are online identifiers; they stay in the client's
-- project and never reach the mart. See docs/connecting-bigquery.md, KVKK.
--
-- Placeholders: {project}, {backoffice_dataset}.

CREATE TABLE IF NOT EXISTS `{project}.{backoffice_dataset}.orders` (
  order_id     STRING    NOT NULL OPTIONS (description = 'Order id exactly as the storefront sends it to GA4 as transaction_id. The join key for checks.'),
  created_at   TIMESTAMP NOT NULL OPTIONS (description = 'When the order was placed, as an absolute instant (UTC or with offset). Not a local DATETIME.'),
  updated_at   TIMESTAMP NOT NULL OPTIONS (description = 'Last change to the row. Use created_at if the export holds one row per order.'),
  total_try    NUMERIC   NOT NULL OPTIONS (description = 'Amount charged for the order in TRY: after discounts, VAT included, shipping included.'),
  shipping_try NUMERIC   NOT NULL OPTIONS (description = 'Shipping charged to the customer in TRY, VAT included. 0 when free.'),
  is_test      BOOL      NOT NULL OPTIONS (description = 'TRUE for test and staff orders. Excluded from the mart.'),
  status       STRING             OPTIONS (description = 'Platform status, kept as is (e.g. created, paid, shipped, delivered, cancelled, refunded). The mart keeps cancelled orders.'),
  utm_source   STRING             OPTIONS (description = 'utm_source of the last non-direct visit before the order, as the storefront stored it.'),
  utm_medium   STRING             OPTIONS (description = 'utm_medium of that same visit.'),
  gclid        STRING             OPTIONS (description = 'Google Ads click id of that visit, if any.'),
  fbclid       STRING             OPTIONS (description = 'Meta click id of that visit, if any.'),
  ttclid       STRING             OPTIONS (description = 'TikTok click id of that visit, if any.'),
  device       STRING             OPTIONS (description = 'Device the order was placed on: mobile, tablet or desktop (or a user-agent family). NULL counts as desktop.')
)
PARTITION BY DATE(created_at)
OPTIONS (description = 'Back-office orders for ai analyst. No personal data.');
