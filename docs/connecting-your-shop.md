# Connecting your shop

ai analyst can answer from your own shop's data without a BigQuery project. Three connectors and one file import
feed a local DuckDB file on this machine, `<data_dir>/warehouse.duckdb` (the source called **Your shop's data**):

| Source | Fills | How |
|---|---|---|
| Google Analytics 4 | sessions, GA4 purchases, GA4 revenue | the Analytics Data API, read only |
| Orders file | orders, revenue | a CSV or XLSX export from ikas, Ticimax, Shopify, WooCommerce or any shop |
| Shopify | orders, revenue | the Admin GraphQL API, a custom app's token with `read_orders` |
| WooCommerce | orders, revenue | the REST API v3, a key with Read permission |

Use **one** orders source: the file, Shopify or WooCommerce. When two cover the same day, the mart adds them up.
Ad spend and platform conversions have no connector yet (Meta Ads, Google Ads and TikTok Ads are on the Analitik
İşler Cloud waitlist), so ROAS, CPA, ad spend and the Meta and Google Ads checks say "no data" on this source.

Everything is set up in **Settings › Sources**, from this machine only. Each connector is tested first (Test), then
connected (Connect), which fetches 90 days by default (up to 400). While `ai-analyst serve` runs, the connected
sources sync once a day; **Sync now** fetches them again.

Facts Analitik İşler could not confirm from a primary source are marked **(unverified)**.

## What is stored

- **Daily totals only.** Per day, channel and device: sessions, GA4 purchases and GA4 revenue from GA4; orders and
  revenue from the orders sources. No order row, order number, product, customer name, email, address or phone
  number is requested from Shopify or WooCommerce, or kept from a file.
- **WooCommerce sends order meta, and the app discards it.** Its REST API cannot pick meta entries by key, so each
  order arrives with all of its meta, where plugins may keep personal data (a tax id, a phone number, the visitor's
  user agent). The app keeps only the four order-attribution values (UTM source and medium, source type, device
  type) and drops the rest on arrival: never stored, logged or passed on.
- **Small shops:** with few orders a day, one daily total for a channel and device can be a single order.
- **The orders file itself is deleted** when you import it, and an upload you do not import is deleted after an
  hour. While it waits it lives in `<data_dir>/uploads/` (mode 0600) and never leaves this machine.
- A sync replaces exactly the days it fetched for that source. A day a source covered with no orders reads 0; a
  day it did not cover reads "no data".
- **Disconnect** removes the connector's settings, its saved secrets and every row it brought in.
- Resetting the demo keeps the connectors' data.

## When the app switches to your shop's data

- **From the demo:** the first successful connect or import switches the data source to Your shop's data.
- **From BigQuery:** your BigQuery data is never replaced on its own. The data lands in `warehouse.duckdb`, the
  connect or import result says so in one line, and you switch by hand in **Settings › Sources**.
- **When `AI_ANALYST_WAREHOUSE` is set:** the environment fixes the source, so nothing switches it. Set
  `AI_ANALYST_WAREHOUSE=local` (or remove it) and restart. The connect or import result says this too.
- Switching back to the demo keeps your shop's data.

## Google Analytics 4

ai analyst asks the Analytics Data API (`analyticsdata.googleapis.com`, scope `analytics.readonly`) for sessions,
transactions and purchase revenue by date, default channel group and device category. It cannot change the
property. Find the **property ID** (a number) in GA4 › Admin › Property details.

The account it uses needs the **Viewer** role on the property (Analyst and above also work). Pick one of three ways
to sign in.

### Your own Google login

Simplest on your own computer. With the [gcloud CLI](https://cloud.google.com/sdk/docs/install):

```sh
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/cloud-platform
```

Your Google user must have access to the property. In Settings choose **Google login**. Without the
`analytics.readonly` scope, the test fails at the property step with an insufficient-scopes error.

### A service account key file

For a server, or a shared machine:

1. In Google Cloud console › IAM & Admin › Service accounts, create a service account (no project roles are needed
   for GA4) and add a JSON key. Turn on the **Google Analytics Data API** for that project.
2. In GA4 › Admin › Property access management, add the service account's email
   (`name@project.iam.gserviceaccount.com`) with the **Viewer** role. Untick "Notify new users", since a service
   account has no inbox.
3. Save the JSON file outside the project folder, readable only by you (`chmod 600`), and give its path in
   Settings (**Key file**), or set `GOOGLE_APPLICATION_CREDENTIALS` to it and choose Google login.

Never commit the key file. Your organisation may forbid key files (the `iam.disableServiceAccountKeyCreation`
policy); use impersonation instead.

### Impersonating a service account

No key file. Your own login acts as the service account:

1. Create the service account and add it to the GA4 property as **Viewer**, as above.
2. Give your Google user the **Service Account Token Creator** role on that service account.
3. Sign in with `gcloud auth application-default login` (the `cloud-platform` scope is needed to impersonate) and
   enter the service account's email under **Impersonate** in Settings. A key file can be the source too.

### The GA4 test

Six steps: credentials, the property, a one-day report, the first and last day with data, report flags, the quota
left. Thresholding, sampling and an `(other)` row are warnings, not failures: small segments may read low. GA4's
default channel groups map to the mart's channels (Organic Search → organic, Direct → direct, Paid Search →
google_ads, Paid Social → meta_ads, Email → email, Unassigned → unknown, everything else → other). The property's
currency must match the workspace currency (Settings › Currency).

## The orders file

Any table with one order per row (or one row per product, with the order number repeated), as CSV or XLSX, up to
25 MB. Export a shorter period, or only the order columns, if the file is larger. An old `.xls` file must be
saved as XLSX from Excel first.

The app guesses the columns from Turkish and English headers (`Sipariş Tarihi`, `Toplam Tutar`, `Sipariş Durumu`,
`Created at`, `Total`, `Financial Status`...). You check the guess and the daily preview, choose the statuses to
leave out (test orders are pre-selected; cancelled orders are counted by default, as in the Orders metric), pick
the time zone of times without an offset (default Europe/Istanbul), and import. Only the date and total columns are
required. A channel or UTM column splits orders by channel (a channel column may hold GA's "source / medium", such as
`google / cpc`); a device or user agent column splits them by device.
Without them, the tracking checks run on totals. A currency column must match the workspace currency on every
order counted.

Each export menu below is **(unverified)**: menus change. Look for an orders list with an export or download
button, and choose CSV or Excel.

### ikas

Admin › Orders, filter the date range, then **Export** (Dışa aktar) and choose Excel or CSV **(unverified)**. Keep the
order number, order date, status and total columns; the channel and device columns help if your export has them.

### Ticimax

Admin › Orders (Siparişler) › order list, filter by date, then **Excel'e aktar** **(unverified)**. The XLSX works as is.

### Shopify

Admin › Orders, filter the dates, **Export** › "Current page" or "All orders" › "CSV for Excel"; the file arrives
by email for large exports. Shopify's export has one row per line item, with the order number (`Name`) repeated;
the app counts each order once. Or connect Shopify directly (below).

### WooCommerce

WooCommerce › Orders has no built-in CSV export in every version **(unverified)**. Use WooCommerce › Reports
(Analytics › Orders, **Download**), or an export plugin, with the order number, date, status and total. Or connect
WooCommerce directly (below).

## Shopify

ai analyst reads orders through a **custom app** in your shop with one scope, `read_orders`.

1. Shopify admin › Settings › Apps and sales channels › **Develop apps** (allow custom app development if asked),
   **Create an app**, name it "ai analyst".
2. **Configure Admin API scopes**: tick `read_orders` only (and `read_all_orders` if you have it). Leave every other
   scope off: the app refuses a token with a `write_*` scope, with `read_customers` or any other scope that reads
   people's data, or with anything beyond a few read-only scopes (`read_products`, `read_analytics`,
   `read_reports`, `read_locations`).
3. **Install app**, then reveal the **Admin API access token** (`shpat_...`) once and copy it.
4. In Settings › Sources › Shopify, enter the shop (`yourshop` or `yourshop.myshopify.com`) and the token, then
   Test and Connect.

Orders older than 60 days need `read_all_orders`, which Shopify grants on request [Shopify access scopes]. With
`read_orders` alone, a 90-day history may come back short **(unverified for custom apps)**.

Per order, only the creation time, the test flag, the total, shipping and currency, and the last visit's source and
UTM are requested. Test orders are left out, cancelled orders count, and revenue excludes shipping. Shopify does not
give the device of an order, so device is `unknown`. Only `https://<shop>.myshopify.com` is called. The token goes
to `<data_dir>/secrets.json` (0600) and is never shown again (only its last four characters).

## WooCommerce

1. WordPress admin › WooCommerce › Settings › Advanced › **REST API** › **Add key**. Pick a user, set
   **Permissions: Read**, generate, and copy the consumer key (`ck_...`) and secret (`cs_...`).
2. Pretty permalinks must be on (Settings › Permalinks, anything but "Plain"), so `/wp-json/wc/v3` answers.
3. In Settings › Sources › WooCommerce, enter the shop address (`https://yourshop.com`), the key and the secret, then
   Test and Connect.

The test checks the key is read only by sending an empty batch update (a write call that changes nothing): WordPress
refuses it for a Read key; a key that is accepted can write, and the app refuses it (`scope_write`). If a security
plugin or firewall answers instead, the permission cannot be told and the test fails (`scope_unchecked`). Create the
key with **Read** permission whatever the check shows. Orders are fetched with only their id,
status, creation time, total, shipping, currency and the order-attribution fields (channel, device). Failed, draft
and trashed orders are left out; cancelled and refunded orders count. The address must be HTTPS on the shop's own
domain on the standard port (443): no IP address, no other port, no private network, no redirect to another host.
The address is checked once when it is resolved, and the app connects to that same address.

## Environment variables

Set in the environment, a value wins over Settings and locks the field there.

| Variable | Meaning |
|---|---|
| `AI_ANALYST_WAREHOUSE` | `duckdb` (the demo), `bigquery` or `local` (your shop's data); set, it fixes the source |
| `AI_ANALYST_GA4_PROPERTY` | the GA4 property ID (`123456789` or `properties/123456789`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | a service account key file, used by the Google login option |
| `AI_ANALYST_SHOPIFY_SHOP` | `yourshop.myshopify.com` |
| `AI_ANALYST_SHOPIFY_TOKEN` | the custom app's Admin API access token |
| `AI_ANALYST_WOOCOMMERCE_URL` | `https://yourshop.com` |
| `AI_ANALYST_WOOCOMMERCE_KEY`, `AI_ANALYST_WOOCOMMERCE_SECRET` | the Read key and its secret |
| `AI_ANALYST_DATA_DIR` | where `warehouse.duckdb`, `secrets.json` and `uploads/` live (default `./data`) |
| `AI_ANALYST_NO_CLOUD` | `1` refuses every outbound call, connectors included; the orders file still works |

A source whose settings come from the environment cannot be disconnected in Settings; unset the variables instead.

## When something fails

| Message | What to do |
|---|---|
| `key_rejected` | the token, key or Google login was not accepted, or lacks `read_orders` |
| `scope_write` | the token or key can change the shop: make a read-only one |
| `scope_extra` | the Shopify token has more scopes than `read_orders`: make a token with `read_orders` only |
| `scope_unchecked` | the shop did not answer the permission check clearly: check the key is Read only and that no plugin blocks the REST API |
| `property_not_found` | wrong property ID, or the account is not a Viewer on it |
| `currency_mismatch` | the source reports another currency: change Settings › Currency first |
| `host_not_allowed` | the address is not HTTPS on the shop's domain, or redirects |
| `rate_limited` | the service is limiting requests: nothing was stored, the next sync tries again |
| `upload_too_large`, `upload_kind`, `file_unreadable` | export again as CSV or XLSX, under 25 MB |

[Shopify access scopes]: https://shopify.dev/docs/api/usage/access-scopes
