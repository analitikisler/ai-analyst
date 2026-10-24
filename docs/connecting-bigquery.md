# Connecting BigQuery

AI Analyst reads one table in your BigQuery project, `daily_channel_device`: one row per day, channel and device,
with sessions, orders, revenue, GA4 purchases, GA4 revenue, ad spend and platform conversions. You build that
table in your own project from three sources: the GA4 export, the Google Ads transfer and a back-office orders
export. AI Analyst gets read-only access to the result. It never reads raw events or orders, and it never writes
to your project.

This guide covers the setup, cost, KVKK and a checklist to confirm the table is right before anyone relies on it.

Facts we could not confirm from a primary source are marked **(unverified)**.

## What you end up with

```
{project}
├─ {ga4_dataset}          GA4 export, events_YYYYMMDD           written by Google Analytics
├─ {ads_dataset}          Google Ads transfer, p_ads_*           written by BigQuery Data Transfer Service
├─ {backoffice_dataset}   orders                                 written by your back-office export
└─ {dataset}              ai_analyst: functions, staging table functions, ads_daily, fx_daily,
                          daily_channel_device                   written by the nightly build
```

AI Analyst's service account can read `{dataset}` only.

The SQL is in `models/`:

| File | Creates |
|---|---|
| `models/staging/00_functions.sql` | `norm_utm`, `channel_of`, `device_of`, `order_key`: one set of channel and device rules for every source |
| `models/landing/backoffice_orders.sql` | the expected `orders` table (schema below) |
| `models/landing/ads_daily.sql` | landing table for Meta and TikTok |
| `models/landing/fx_daily.sql` | TCMB exchange rates |
| `models/staging/stg_ga4_sessions.sql` | table function: one row per GA4 session |
| `models/staging/stg_ga4_purchases.sql` | table function: one row per GA4 transaction |
| `models/staging/stg_orders.sql` | table function: one row per back-office order |
| `models/staging/stg_ad_spend.sql` | table function: spend in TRY and platform conversions |
| `models/marts/daily_channel_device.sql` | the mart table and `daily_channel_device_build(date_from, date_to)` |
| `models/marts/daily_channel_device_incremental.sql` | nightly MERGE of the last 3 days |
| `models/marts/daily_channel_device_full_refresh.sql` | full rebuild |
| `models/checks/*.sql` | order-level diagnosis for each check (optional) |

## 1. Choose one location

Every dataset above must be in the same BigQuery location, because the build joins across them. Pick the EU
multi-region (`EU`) or one EU region (for example `europe-west3`) and use it for all four datasets. Set
`BIGQUERY_LOCATION` to the same value.

The GA4 export location is set when you link the property and cannot be changed later without deleting the link,
moving the data and relinking [GA4 BigQuery Export setup]. Decide before you link.

## 2. GA4 export

1. In GA4, Admin, Product links, BigQuery links: link the property to `{project}`, choose the location from step 1.
2. Turn on the **Daily** export. Streaming is optional; the mart reads only the daily `events_YYYYMMDD` tables,
   because intraday tables are incomplete.
3. Property settings: time zone **Europe/Istanbul** and currency **TRY**. The mart dates everything in
   Europe/Istanbul; a property in another time zone still works (the models read one extra day either side) but
   its daily tables then cut days at a different hour. `ecommerce.purchase_revenue` is in the property currency.
4. Check the volume. Standard properties export at most 1 million events per day in the daily export; streaming
   has no limit [GA4 BigQuery Export setup], [GA4 export SLA]. What the daily export does on a day over the limit
   should be checked in the GA4 help before you rely on it **(unverified)**.

What the models use from the export [GA4 export schema]:

| Field | Used for |
|---|---|
| `user_pseudo_id` + `event_params.ga_session_id` | session key |
| `event_timestamp` | Europe/Istanbul date of a session (its first event) and of a purchase |
| `session_traffic_source_last_click.cross_channel_campaign.source / .medium` | session channel: GA4's last non-direct source for the session (added to the export in July 2024 [Adswerve], [InfoTrust]) |
| `session_traffic_source_last_click.manual_campaign.source / .medium` | fallback |
| `session_traffic_source_last_click.google_ads_campaign.campaign_id` | marks auto-tagged Google Ads sessions |
| `collected_traffic_source.manual_source / .manual_medium / .gclid` | fallback for data before July 2024, and the gclid |
| `event_params.page_location` | `fbclid` and `ttclid`, read from the URL; the export has no field for them |
| `device.category` | device: `tablet` counts as `mobile` |
| `event_name = 'purchase'`, `ecommerce.transaction_id`, `ecommerce.purchase_revenue` | GA4 purchases and revenue |

GA4 keeps updating a daily table for late events for up to two calendar days after its date, plus the current
day [GA4 export SLA]. That is why the nightly run recomputes the last 3 days.

## 3. Google Ads transfer

1. BigQuery, Data transfers, Create transfer, source **Google Ads**. Destination dataset `{ads_dataset}`, your
   customer id or manager account id. Daily schedule.
2. Set each Ads account's time zone to Europe/Istanbul if you can. `segments_date` is the account's date.
3. Backfill the period you want in the mart.

The models read these tables [Google Ads report transformation]:

| Table | Columns used |
|---|---|
| `p_ads_CampaignBasicStats_<customer_id>` | `customer_id`, `segments_date`, `segments_device`, `metrics_cost_micros`, `metrics_conversions` |
| `p_ads_Customer_<customer_id>` | `customer_id`, `customer_currency_code` |
| `p_ads_ClickStats_<customer_id>` | `click_view_gclid`, `segments_date`, `segments_device` (diagnosis only) |

The models use a wildcard (`p_ads_CampaignBasicStats_*`), so every account under a manager account is included.

Things to know:

- `metrics_conversions` is the Google Ads "Conversions" column: every **primary** conversion action, fractional
  under data-driven attribution, dated by the ad click. If purchase is not your only primary conversion action,
  `platform_conversions` will include the others.
- A forum report says Demand Gen campaigns were missing from `p_ads_CampaignBasicStats_*` while present in
  `p_ads_CampaignStats_*` [Google forum] **(unverified, no confirmed fix)**. The checklist below compares spend
  against the Google Ads interface for one day; if it differs, tell us.
- The transfer re-pulls recent days to catch restated conversions; the length of that refresh window is a
  transfer setting **(default value unverified)**. Run the weekly 30-day rebuild described in step 8.

## 4. Back-office orders

The back office is the system that owns orders and revenue. Your export (or our connector) fills
`{backoffice_dataset}.orders` with this schema (`models/landing/backoffice_orders.sql`):

| Column | Type | Meaning |
|---|---|---|
| `order_id` | STRING | Exactly the value the storefront sends to GA4 as `transaction_id` |
| `created_at` | TIMESTAMP | When the order was placed, as an absolute instant (not a local DATETIME) |
| `updated_at` | TIMESTAMP | Last change; the latest row per `order_id` wins. Use `created_at` if you export each order once |
| `total_try` | NUMERIC | Amount charged in TRY: after discounts, VAT included, shipping included |
| `shipping_try` | NUMERIC | Shipping charged, VAT included; 0 when free |
| `is_test` | BOOL | Test and staff orders; excluded |
| `status` | STRING | Platform status as is; cancelled orders are kept |
| `utm_source`, `utm_medium` | STRING | From the last non-direct visit before the order |
| `gclid`, `fbclid`, `ttclid` | STRING | Click ids from that visit |
| `device` | STRING | `mobile`, `tablet` or `desktop` (or a user-agent family); NULL counts as desktop |

Revenue in the mart is `total_try - shipping_try`. Only placed orders belong in the table: leave out carts,
drafts and checkouts that never became an order.

**No personal data**: no names, e-mail addresses, phone numbers, postal addresses, customer ids or IP addresses.

### What each platform's export has to provide

The hard columns are the UTMs, click ids and device, because most platforms do not store them on the order.
They have to be captured by the storefront: keep the last non-direct UTMs and click ids in a first-party cookie
(30 days is a common choice) and write them to the order at checkout, through an order note, custom attribute or
your tag manager. Without that, the back office cannot attribute orders and `cpa`, `roas` and the two ad checks
are meaningless. The device can come from the user agent at checkout.

| Platform | Orders and amounts | UTMs, click ids, device |
|---|---|---|
| **ikas** (first) | GraphQL Admin API, OAuth 2.0 [ikas]. The theme model `IkasOrder` has `orderNumber`, `orderedAt` (epoch milliseconds), `totalFinalPrice` and `shippingLines[].price` [ikas order model]; the Admin API field names and whether it exposes UTMs need to be confirmed **(unverified)**. Decide which of `id` and `orderNumber` the GA4 purchase event sends and export that one as `order_id`. | Not found in the public order model **(unverified)**; capture on the storefront as above. |
| Shopify | Admin GraphQL API, orders | Shopify records a landing site and referrer on the order; UTMs inside them have to be parsed **(unverified)**. |
| Ticimax | SOAP order services **(unverified, get vendor documentation)** | Storefront capture |
| İdeasoft, T-Soft | Vendor API or CSV export **(unverified)** | Storefront capture |
| Any other | CSV loaded into `{backoffice_dataset}.orders` with the schema above | Storefront capture |

## 5. Meta Ads and TikTok Ads

Both land in `{dataset}.ads_daily` (`models/landing/ads_daily.sql`): one row per date, platform (`meta_ads` or
`tiktok_ads`), device and account, with `cost` in the account currency or `cost_try` in TRY, and `conversions`
(purchases as the platform reports them).

- **Meta**: BigQuery Data Transfer Service has a Facebook Ads connector that writes date-partitioned
  `AdInsights` and `AdInsightsActions` tables, re-pulls the last 30 days on every run and runs daily
  [Facebook Ads transfers]. Its launch stage and the column names for spend, currency, device breakdown and
  purchase actions were not confirmed **(unverified)**; until they are, a small daily query that maps those tables
  into `ads_daily` is the recommended route. Otherwise use a loader of your choice against the Marketing API
  Insights endpoint, with breakdown `impression_device` and the purchase action (for example `omni_purchase`)
  **(action name unverified)**.
- **TikTok**: we found no native BigQuery transfer; third-party loaders exist [TikTok loaders]. Load the Business
  API report into `ads_daily` with a device breakdown if available.
- Set both ad accounts to the Europe/Istanbul time zone, so `date` means the same day as everywhere else.

## 6. Exchange rates

Google Ads and Meta accounts billed in USD or EUR are converted to TRY with `{dataset}.fx_daily`
(`models/landing/fx_daily.sql`). Load the TCMB daily bulletin (`https://www.tcmb.gov.tr/kurlar/today.xml`, and the
dated archive for history): `try_per_unit = ForexBuying / Unit` [TCMB]. TCMB publishes on business days only; the
model uses the latest rate on or before the spend date, up to 10 days back. If a rate is missing, the build stops
with an error instead of counting the spend as zero. We use the buying rate by default; confirm with your
accountant which rate your books use.

Accounts already in TRY need nothing.

## 7. Create the objects

Replace the placeholders and run the files in this order, as a user with BigQuery Data Editor on `{dataset}`:

```sh
export P=your-project GA4=analytics_123456789 ADS=google_ads BO=backoffice DS=ai_analyst
render() { sed -e "s/{project}/$P/g" -e "s/{ga4_dataset}/$GA4/g" -e "s/{ads_dataset}/$ADS/g" \
               -e "s/{backoffice_dataset}/$BO/g" -e "s/{dataset}/$DS/g" "$1"; }

bq mk --location=EU --dataset "$P:$DS"
for f in models/staging/00_functions.sql models/landing/*.sql models/staging/stg_*.sql \
         models/marts/daily_channel_device.sql; do
  render "$f" | bq query --use_legacy_sql=false --location=EU
done
```

Then dry-run and run the full refresh once:

```sh
render models/marts/daily_channel_device_full_refresh.sql | bq query --use_legacy_sql=false --location=EU --dry_run
render models/marts/daily_channel_device_full_refresh.sql | bq query --use_legacy_sql=false --location=EU
```

## 8. Schedule the build

Create two BigQuery scheduled queries from the rendered scripts, run by a **build** service account (not AI
Analyst's): BigQuery Data Viewer on the three source datasets, Data Editor on `{dataset}`, Job User in `{project}`.

| Schedule | Script | Why |
|---|---|---|
| Daily, 21:00 Europe/Istanbul | `daily_channel_device_incremental.sql` | Re-computes the last 3 days after GA4's daily export has landed (usually early to mid afternoon in the property time zone [GA4 export SLA]) and after GA4's late-event updates |
| Weekly, Sunday 22:00 | the same script with `lookback_days` set to 30 | Picks up restated ad platform conversions |

The incremental run ends at the last complete GA4 daily table, so a late export never produces a day with orders
and no sessions; the next run fills it. Run the full refresh again after any change to the models.

## 9. AI Analyst's read-only access

1. Create a service account for AI Analyst, for example `ai-analyst-reader@<ai-analyst-project>.iam.gserviceaccount.com`.
2. Grant it **BigQuery Data Viewer** on `{dataset}` only. Run in the BigQuery console of `{project}`:

   ```sql
   GRANT `roles/bigquery.dataViewer`
   ON SCHEMA `{project}.{dataset}`
   TO "serviceAccount:ai-analyst-reader@<ai-analyst-project>.iam.gserviceaccount.com";
   ```

   Do not grant it the GA4, Ads or back-office datasets. The order-level scripts in `models/checks/` are for your
   analyst to run with their own access.
3. Grant it **BigQuery Job User** in the AI Analyst project, where its queries run and are billed:

   ```sh
   gcloud projects add-iam-policy-binding <ai-analyst-project> \
     --member="serviceAccount:ai-analyst-reader@<ai-analyst-project>.iam.gserviceaccount.com" \
     --role="roles/bigquery.jobUser"
   ```

4. Connect AI Analyst. In the web app, Settings › Data source › Connect BigQuery tests the connection in six
   steps (credentials, running queries in the job project, the dataset, the table, reading it, the cost of a
   typical question) and saves it to `ai-analyst.config.json` once every step passes. Or set it in the
   environment, which wins over the file and locks the field in Settings:

   | Variable | Value |
   |---|---|
   | `AI_ANALYST_WAREHOUSE` | `bigquery` |
   | `BIGQUERY_PROJECT` | `{project}`, the project that holds the mart (the data project) |
   | `BIGQUERY_JOB_PROJECT` | the project where queries run and are billed; the data project when unset |
   | `BIGQUERY_DATASET` | `{dataset}` |
   | `BIGQUERY_LOCATION` | the location from step 1, `EU` by default |
   | `BIGQUERY_MAX_BYTES` | per-query cap in bytes, 2 GB by default (`2147483648`); Settings can lower it, only this raises it |
   | `GOOGLE_APPLICATION_CREDENTIALS` | path to the service account's key file, if not using `gcloud auth application-default login`; AI Analyst never stores credentials |
   | `AI_ANALYST_WORKSPACE` | the store's name |

Prefer the dataset-scoped reader service account of step 3, or impersonation of it ("Service account to
impersonate" in Settings), over a personal `gcloud` sign-in: a personal sign-in usually reaches far more than the
mart. The server only ever reads the mart (the dry run must report it as the only table read), but the narrowest
identity is the right default. Without a key file and without impersonation, Google's default credential chain
is used: `GOOGLE_APPLICATION_CREDENTIALS`, then gcloud's application default credentials, then, on a cloud VM,
the metadata server.

Testing the connection makes real BigQuery calls with the credentials on this machine. A server started with
`--no-cloud` or `AI_ANALYST_NO_CLOUD=1` (the default for tests, `bun run dev` and the smoke server) refuses them
with `no_cloud` instead; set `AI_ANALYST_NO_CLOUD=0` to connect from those.

AI Analyst dry-runs every query first and sends it with `maximumBytesBilled` set to `BIGQUERY_MAX_BYTES`, so a
query over the cap fails instead of being billed. The mart holds 12 rows per day; a year of it is well under
1 MB, so the 2 GB cap is never close for normal use. Keep the cap; lower it if you like.

## 10. Cost

- **AI Analyst's queries** read only the mart, a few hundred kilobytes at most. BigQuery bills on-demand queries
  with a 10 MB minimum per table referenced **(minimum unverified for current pricing)**, so each question costs a
  fraction of a cent.
- **The nightly build** scans the GA4 columns it uses for about 5 daily tables (3 days, plus one day either side,
  plus 7 days of `purchase` events for deduplication). Wildcard pruning on `_TABLE_SUFFIX` keeps the scan to those
  tables; we confirmed with dry runs that a longer window scans proportionally more. Expect a few hundred MB per
  run for a property with about a million events a day **(estimate; dry-run your own)**. The weekly 30-day run
  scans about ten times as much.
- **The full refresh** scans the same columns over the whole export history. Dry-run it first.
- Ads, back-office, `ads_daily` and `fx_daily` tables are small.
- On-demand pricing has a monthly free tier; check current prices for your location **(unverified)**. To put a
  ceiling on the build itself, set a custom query quota per day for the build service account in `{project}`.
- The BigQuery sandbox works for a trial, with its storage limit and table expiry [GA4 BigQuery Export setup]
  **(sandbox expiry period unverified)**; tables that expire break the mart's history.

## 11. KVKK

- **Only aggregates reach the model.** AI Analyst's service account can read `{dataset}` and nothing else. The mart
  has counts and sums by day, channel and device. The language model sees query results from the mart and the
  metric definitions, never events, orders or identifiers.
- **No personal data in the mart.** It has no user ids, order ids, click ids, IP addresses or free text.
- **Pseudonymous data stays in your project.** `user_pseudo_id`, `ga_session_id`, `gclid`, `fbclid` and `ttclid` are
  online identifiers. The staging functions read them inside your project to build the aggregates; nothing copies
  them out.
- **Keep the orders export clean.** The orders table needs no customer fields; do not export them.
- **Order-level diagnosis.** `models/checks/*.sql` return order ids. Run them in your own console; do not paste the
  results into a chat with a model.
- **Location.** Keep every dataset in the EU location from step 1. AI Analyst's queries run in that location.
  Whether processing in the EU counts as a transfer abroad under KVKK and the 2024 By-Law, and which safeguard
  applies, is a question for your legal adviser; this guide does not answer it.

## 12. Validation checklist

Run these before anyone uses AI Analyst on the data. Replace the placeholders; dates are examples.

**1. Row count: 12 rows per day, no gaps.**

```sql
SELECT MIN(date) AS first_day, MAX(date) AS last_day, COUNT(*) AS row_count,
       (DATE_DIFF(MAX(date), MIN(date), DAY) + 1) * 12 AS expected_rows
FROM `{project}.{dataset}.daily_channel_device`;
```

`row_count` equals `expected_rows`.

**2. One row per date x channel x device, only known values.**

```sql
SELECT date, channel, device, COUNT(*) AS n
FROM `{project}.{dataset}.daily_channel_device`
GROUP BY 1, 2, 3
HAVING n > 1
   OR channel NOT IN ('organic', 'direct', 'google_ads', 'meta_ads', 'tiktok_ads', 'email')
   OR device NOT IN ('mobile', 'desktop');
```

No rows.

**3. Ad columns are 0 outside ad channels.**

```sql
SELECT channel, SUM(ad_spend) AS ad_spend, SUM(platform_conversions) AS platform_conversions
FROM `{project}.{dataset}.daily_channel_device`
WHERE channel NOT IN ('google_ads', 'meta_ads', 'tiktok_ads')
GROUP BY channel
HAVING ad_spend != 0 OR platform_conversions != 0;
```

No rows.

**4. One day against the GA4 interface.** Pick a complete day at least 4 days old. In GA4, Reports, open a
report for that single day showing Sessions, Transactions (or Purchases) and Purchase revenue. Then:

```sql
SELECT SUM(sessions) AS sessions, SUM(ga4_purchases) AS purchases, SUM(ga4_revenue) AS revenue
FROM `{project}.{dataset}.daily_channel_device`
WHERE date = DATE '2026-10-15';
```

Expect purchases and revenue to match closely. Sessions differ slightly: the GA4 interface estimates sessions and
counts a session that crosses midnight on both days, while the mart counts it once **(size of the gap unverified;
typically small)**. A large difference usually means the property time zone is not Europe/Istanbul, or the
interface is applying a filter or threshold.

**5. One day against the Google Ads interface.** Same day, all accounts, Cost and Conversions:

```sql
SELECT SUM(ad_spend) AS cost_try, SUM(platform_conversions) AS conversions
FROM `{project}.{dataset}.daily_channel_device`
WHERE date = DATE '2026-10-15' AND channel = 'google_ads';
```

Cost matches to the lira for TRY accounts. If it is lower, compare with the account-level table, which catches
campaign types missing from the campaign table:

```sql
SELECT SUM(metrics_cost_micros) / 1e6 AS account_cost
FROM `{project}.{ads_dataset}.p_ads_AccountBasicStats_*`
WHERE segments_date = DATE '2026-10-15';
```

**6. One day against the back office.** Orders and revenue (VAT included, shipping excluded, test orders out,
cancellations in) for the same day in the platform's own report:

```sql
SELECT SUM(orders) AS orders, SUM(revenue) AS revenue
FROM `{project}.{dataset}.daily_channel_device`
WHERE date = DATE '2026-10-15';
```

**7. Unknown devices.** NULL or unrecognised devices count as desktop. Check how many there are:

```sql
SELECT COUNTIF(device_raw IS NULL) AS orders_without_device, COUNT(*) AS orders
FROM `{project}.{dataset}.stg_orders`(DATE '2026-10-01', DATE '2026-10-21');
```

More than a few per cent distorts every device breakdown; fix the export.

**8. Run the checks.** `ai-analyst check` runs the four checks on the mart. For any that does not add up, the
matching script in `models/checks/` explains it at order level:

| Check | Script | Shows |
|---|---|---|
| `ga4_vs_orders` | `ga4_vs_orders.sql` | match rate on `order_id = transaction_id` by device and by day, unmatched orders by status and channel, GA4 transactions without an order |
| `ga4_rev_vs_revenue` | `ga4_rev_vs_revenue.sql` | the revenue gap split into missing orders and value differences; value patterns such as "GA4 includes shipping" or "GA4 looks net of VAT" |
| `gads_vs_orders` | `gads_vs_orders.sql` | orders by gclid and UTM against conversions; click-to-order lag from `ClickStats` |
| `meta_vs_orders` | `meta_vs_orders.sql` | Meta orders by evidence (paid UTM, fbclid only) against Meta conversions |

## Sources

- [GA4 export schema] Google Analytics Help, "[GA4] BigQuery Export schema", support.google.com/analytics/answer/7029846
- [GA4 export SLA] Google Analytics Help, "[GA4] BigQuery Export", support.google.com/analytics/answer/9358801: daily
  tables updated for up to 2 calendar days plus today; 1 million events per day for standard properties
- [GA4 BigQuery Export setup] Google Analytics Help, "[GA4] Set up BigQuery Export", support.google.com/analytics/answer/9823238:
  location choice and change, daily and streaming, sandbox
- [Adswerve] adswerve.com, "Four different GA4 traffic flavors in the BigQuery export" (secondary)
- [InfoTrust] infotrust.com, "How do I get session-level attribution in GA4 BigQuery?" (secondary)
- [Google Ads report transformation] Google Cloud, "Google Ads report transformation",
  docs.cloud.google.com/bigquery/docs/google-ads-transformation: CampaignBasicStats, Customer, ClickStats, AccountBasicStats columns
- [Google forum] discuss.google.dev, "Missing data from Google Ads transfer" (Demand Gen in CampaignBasicStats)
- [Facebook Ads transfers] Google Cloud, "Introduction to Facebook Ads transfers",
  docs.cloud.google.com/bigquery/docs/facebook-ads-transfer-intro
- [TikTok loaders] fivetran.com, coupler.io, supermetrics.com connector pages (secondary; no Google page found)
- [ikas] ikas.dev developer documentation, GraphQL Admin API and OAuth 2.0
- [ikas order model] ikas.dev, theme API `IkasOrder` and `IkasOrderShippingLine`
- [TCMB] www.tcmb.gov.tr/kurlar/today.xml: `Unit`, `ForexBuying`, `ForexSelling` per currency
