-- TCMB exchange rates for converting non-TRY ad accounts to TRY.
-- One row per publication date x currency. TCMB publishes on business days only; stg_ad_spend uses the
-- latest rate published on or before the spend date (up to 10 days back), so weekends and holidays
-- take the last business day's rate.
--
-- Source: https://www.tcmb.gov.tr/kurlar/today.xml (and the daily archive). try_per_unit = ForexBuying / Unit,
-- because some currencies are quoted per 100 units. Buying rather than selling rate is our default;
-- confirm with the client's accountant which rate their books use.
--
-- Placeholders: {project}, {dataset}.

CREATE TABLE IF NOT EXISTS `{project}.{dataset}.fx_daily` (
  date         DATE    NOT NULL OPTIONS (description = 'Date the rate applies from (TCMB bulletin date).'),
  currency     STRING  NOT NULL OPTIONS (description = 'ISO 4217 code, e.g. USD, EUR.'),
  try_per_unit NUMERIC NOT NULL OPTIONS (description = 'TRY for one unit of the currency: ForexBuying / Unit.'),
  source       STRING           OPTIONS (description = 'e.g. tcmb_forex_buying.')
)
PARTITION BY DATE_TRUNC(date, MONTH)
CLUSTER BY currency
OPTIONS (description = 'TCMB daily exchange rates.');
