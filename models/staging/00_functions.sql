-- Shared rules for the mart: channel, device and order keys.
-- One definition used by GA4, back-office and ads staging, so every source assigns
-- channels and devices the same way. Run this file first.
--
-- Placeholders: {project}, {dataset}.

-- Lower-cases and trims a UTM value; GA4's markers for "no value" become NULL,
-- so direct traffic is simply "no source and no medium".
CREATE OR REPLACE FUNCTION `{project}.{dataset}.norm_utm`(v STRING)
RETURNS STRING AS (
  CASE
    WHEN v IS NULL THEN NULL
    WHEN LOWER(TRIM(v)) IN ('', '(not set)', '(none)', '(direct)', '(not provided)', 'null', 'undefined') THEN NULL
    ELSE LOWER(TRIM(v))
  END
);

-- Six channels from CONTRACT: organic, direct, google_ads, meta_ads, tiktok_ads, email.
-- Order of the rules matters:
--   1. google_ads  a gclid, a GA4 Google Ads campaign id, or a Google source with a paid medium
--   2. tiktok_ads  a ttclid, or a TikTok source with a paid medium
--   3. meta_ads    a Meta source with a paid medium, or an fbclid with no medium (or a paid one).
--                  Meta adds fbclid to organic link clicks too, so the fbclid fallback can count
--                  organic social as meta_ads when the link carries no UTMs. models/checks/meta_vs_orders.sql
--                  measures how many orders rest on that fallback alone.
--   4. email       an email medium, or a known email-sending source without a paid medium
--   5. direct      no source and no medium
--   6. organic     everything else: organic search, referral, organic social, unpaid campaigns
-- google_ads_campaign_id is only available on the GA4 side; pass NULL elsewhere.
CREATE OR REPLACE FUNCTION `{project}.{dataset}.channel_of`(
  source STRING, medium STRING, gclid STRING, fbclid STRING, ttclid STRING, google_ads_campaign_id STRING)
RETURNS STRING AS (
  CASE
    WHEN NULLIF(TRIM(gclid), '') IS NOT NULL
      OR NULLIF(TRIM(google_ads_campaign_id), '') IS NOT NULL
      OR (`{project}.{dataset}.norm_utm`(source) IN ('google', 'adwords', 'googleads', 'google ads', 'google_ads', 'youtube')
          AND `{project}.{dataset}.norm_utm`(medium) IN ('cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'paid-search', 'cpm', 'cpv', 'display', 'video', 'pmax', 'shopping'))
      THEN 'google_ads'
    WHEN NULLIF(TRIM(ttclid), '') IS NOT NULL
      OR (`{project}.{dataset}.norm_utm`(source) IN ('tiktok', 'tiktok.com', 'tiktokads', 'tiktok_ads', 'tiktok ads')
          AND `{project}.{dataset}.norm_utm`(medium) IN ('cpc', 'ppc', 'paid', 'paid_social', 'paidsocial', 'paid-social', 'cpm', 'cpv', 'ads', 'video'))
      THEN 'tiktok_ads'
    WHEN (`{project}.{dataset}.norm_utm`(source) IN ('facebook', 'fb', 'instagram', 'ig', 'meta', 'an', 'messenger', 'threads', 'facebook_ads', 'meta_ads')
          AND `{project}.{dataset}.norm_utm`(medium) IN ('cpc', 'ppc', 'paid', 'paid_social', 'paidsocial', 'paid-social', 'cpm', 'ads', 'video'))
      OR (NULLIF(TRIM(fbclid), '') IS NOT NULL
          AND (`{project}.{dataset}.norm_utm`(medium) IS NULL
               OR `{project}.{dataset}.norm_utm`(medium) IN ('cpc', 'ppc', 'paid', 'paid_social', 'paidsocial', 'paid-social', 'cpm', 'ads')))
      THEN 'meta_ads'
    WHEN `{project}.{dataset}.norm_utm`(medium) IN ('email', 'e-mail', 'e_mail', 'mail', 'newsletter')
      OR `{project}.{dataset}.norm_utm`(source) IN ('newsletter', 'email', 'klaviyo', 'mailchimp', 'brevo', 'sendinblue', 'hubspot', 'euromsg', 'insider_email')
      THEN 'email'
    WHEN `{project}.{dataset}.norm_utm`(source) IS NULL AND `{project}.{dataset}.norm_utm`(medium) IS NULL
      THEN 'direct'
    ELSE 'organic'
  END
);

-- Two devices from CONTRACT. Tablets count as mobile. Anything not recognisably a phone or a
-- tablet (desktop, smart TV, console, unknown, NULL) counts as desktop. The same rule reads
-- GA4 device.category, Google Ads segments_device (MOBILE, TABLET, DESKTOP, CONNECTED_TV, OTHER),
-- Meta impression_device (iphone, ipad, android_smartphone, android_tablet, desktop, other)
-- and whatever the back office exports.
CREATE OR REPLACE FUNCTION `{project}.{dataset}.device_of`(category STRING)
RETURNS STRING AS (
  IF(REGEXP_CONTAINS(LOWER(COALESCE(category, '')), r'mobile|tablet|phone|android|ios|ipad|iphone'),
     'mobile', 'desktop')
);

-- Join key between back-office order_id and GA4 transaction_id: trimmed, lower-cased,
-- a leading '#' removed (stores often show "#1234" and send "1234", or the reverse).
CREATE OR REPLACE FUNCTION `{project}.{dataset}.order_key`(id STRING)
RETURNS STRING AS (
  NULLIF(LOWER(REGEXP_REPLACE(TRIM(id), r'^#', '')), '')
);
