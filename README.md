# rxgrowth-metrics-service

Multi-tenant customer metrics for restaurant locations on GoHighLevel. A workflow Webhook action sends `locationId` and `contactId`. This service loads that tenant's API key, re-fetches the contact's orders, computes metrics, and writes them back to contact custom fields.

A workflow nudge recomputes M06 metrics. A daily cron writes M10 win-back eligibility from those stored fields. Nothing in this repository calls GoHighLevel or provisions a Vercel project.

## Layout

- `api/health.ts` — liveness check.
- `src/schema/fields.ts` — generated catalog of the RX Test Lab custom fields, keyed for runtime lookup. Test-lab ids are fixtures only.
- `src/tenants/` — `TenantStore`. `TENANT_STORE=neon` uses Neon Postgres. `TENANT_STORE=env` loads one tenant from the environment for the test phase. API keys are AES-256-GCM ciphertext. Tests use the in-memory store.
- `src/ghl/` — HTTP client. Timeout, retry with backoff on 429 and 5xx, per-location spacing, order pages via `offset`, contact search via `searchAfter`.
- `src/idempotency/` — `SET NX` with TTL. Upstash Redis via `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_REST_*` pair when the KV pair is unset). Production fails closed. Other environments use memory when neither pair is set.
- `src/time/business-date.ts` — tenant-timezone calendar dates.
- `migrations/001_tenants.sql` — Neon schema.
- `fixtures/test-lab-fields.json` — final custom-field snapshot for location `ekxOqjUKW7M6OV9XAVnx`.

- `api/webhooks/ghl.ts` — M06 nudge. `POST` JSON. Ids come from `customData.locationId` and `customData.contactId`, or from top-level `locationId` and `contactId`, or from `location.id` and `contact_id`. The rest of the body is ignored and is not logged. An unknown location, an inactive tenant, and a bad token all return the same 401 and do no work. A second nudge is not dropped; an unchanged metrics hash skips the write.
- `api/cron/m10.ts` — daily M10 dispatcher. `GET` or `POST` with `Authorization: Bearer $CRON_SECRET`. Invokes one tenant function per active location.
- `api/cron/m10-tenant.ts` — one tenant's order reconcile, then its win-back pass, with the same bearer check.

## Webhook

```bash
curl -X POST 'https://<deployment>/api/webhooks/ghl?t=TENANT_WEBHOOK_TOKEN' \
  -H 'content-type: application/json' \
  -d '{"locationId":"LOCATION_ID","contactId":"CONTACT_ID"}'
```

The handler returns 202 after it re-fetches orders and either writes metrics or skips an unchanged hash. It returns 400 when `locationId` or `contactId` is missing, and 400 when either id is not 1–64 alphanumeric characters. It returns 500 when processing fails so the sender can retry. An unknown location, an inactive tenant, a missing hash, and a `?t=` token that does not match `webhook_token_hash` all return 401 with the same body. The token is compared with a constant-time hash check, including a stand-in hash when the location is unknown, so the response does not reveal whether that tenant exists. A tenant with no hash is rejected in every environment, including Preview. The payload is only a signal. A standard GoHighLevel Webhook action posts the contact's fields at the top level (`contact_id`, `location.id`, name, email, phone) and the action's Custom Data under `customData`. The RX Test Lab workflow sets `customData.locationId` to `{{location.id}}` and `customData.contactId` to `{{contact.id}}`. Those custom values are used first. The handler does not log the body. There is no shared webhook secret: that action cannot set headers, so each location's workflow URL carries that tenant's token. Query strings are stripped from logs. A trailing recompute that fails is logged as `webhook.rerun_failed`. The rerun flag is put back before the contact lock is released. A second nudge does not wait on the lock; it returns 202 immediately, and the holder computes once more after it finishes.

A nudge with no `eventId` is always computed, guarded by a 30 second per-contact lock. If a second nudge arrives while that lock is held, it is queued and the in-flight run computes once more after it finishes, so a new order a few seconds later is not dropped. An explicit `eventId` or `webhookId` is still deduped for 300 seconds.

List items that already include `paymentStatus` and `liveMode` are used as-is. `markAsTest` is often absent and then means not a test order. If `paymentStatus` or `liveMode` is missing, the service fetches `GET /payments/orders/{orderId}` with `altId` and `altType=location` before applying the qualifying rule. Orders whose `contactId` is missing or belongs to some other contact are dropped. `altId` and `altType=location` are sent on every order request.

M06 never writes `winback_eligibility` or `winback_tier`.

## Daily win-back cron

Vercel invokes `GET /api/cron/m10` at 03:00 UTC (`0 3 * * *`). The handler rejects the call unless `CRON_SECRET` is set and the bearer token matches. It lists active tenants and calls `POST /api/cron/m10-tenant?locationId=` once per tenant, in parallel, with the same bearer token. Each tenant function has its own 300 second limit, so one slow location does not consume the budget of the others. One tenant invocation that throws is logged and counted, and the other tenants still finish. The cron returns 200 unless every tenant invocation failed, or configuration is missing. Zero active tenants is a successful empty run.

A tenant hop holds `m10:{locationId}:{YYYY-MM-DD}` for at least 360 seconds, longer than the 300 second function limit, and deletes that lock when the hop finishes, including when it throws. Another run the same local day is allowed once the lock is gone; the field writes are unchanged when the values already match. While the lock is held, a second hop skips that tenant. Contact search is paged with `searchAfter`. After 240 seconds the hop stores `m10cursor:{locationId}:{YYYY-MM-DD}` and schedules another call to the tenant route with `waitUntil` from `@vercel/functions`. The next hop starts at that cursor and does not repeat the earlier page.

The same contact pages feed the value distribution. Inactive tenants are not listed and are not scanned. A direct tenant call for an inactive location returns without a GoHighLevel request. The hop reads `lifetime_value`, `qualifying_order_count`, `last_order_date`, and `purchase_consistency` off the search page it already fetched. It does not add an order read, a contact read, or a second search. Customers missing a numeric lifetime value or a qualifying count above zero stay out of the population. When the scan finishes, the hop stores sorted spend, order-count, and value-score arrays on `m10:dist:{locationId}` for 8 days. The value has no contact id. A hop that stops for the time budget stores the samples so far on `m10:dist-build:{locationId}:{YYYY-MM-DD}` for 2 hours, aligned with the cursor, and does not publish. The finishing hop publishes the combined population and deletes the build key. A resumed cursor with no matching build is not published, so a partial page cannot replace the previous distribution. One tenant that throws does not write another tenant's arrays. A small location that finishes in one hop is one Redis `SET`. Each extra hop is one `GET` and one `SET` of the build key, and the last hop adds one `SET` of the distribution plus one `DEL` of the build key. Per-location spacing stays 100ms because this pass adds no GoHighLevel call. The 240 second budget and the 300 second function limit are unchanged.

Before win-back eligibility, the tenant hop reconciles M06 for orders that changed recently. The test-lab account only has an Order Submitted workflow trigger, so a cancel, refund, or payment-status change on an existing order never calls the webhook. The hop lists `GET /payments/orders` with `altType=location` and `altId` (no `contactId`) and collects distinct contact ids whose `updatedAt`, or `createdAt` when `updatedAt` is missing, falls inside the last `M06_RECONCILE_HOURS` (default 48). Each contact runs the same recompute as the webhook: the per-contact lock, the metrics hash write-skip, and the per-location rate limiter. Order payloads are not logged.

`GET /payments/orders` returns newest-first by `createdAt`, not by `updatedAt`. `startAt` and `endAt` filter `createdAt` by whole days in the location timezone (the end day is inclusive, and an ISO time is rounded to a day), so they cannot see a recent update on an older order. The scan does not send them. It pages with `offset` and `limit=100`, keeps orders whose `updatedAt` (or `createdAt` when `updatedAt` is missing) is inside the reconcile window, and stops after `M06_RECONCILE_MAX_PAGES` pages (default 30, about 3000 of the most recently created orders). Hitting that cap logs a warning with the location id, the number of pages scanned, and the `createdAt` of the last order scanned. The hop still runs eligibility for the contacts it already refreshed. An update to an order older than that scanned window is caught by the weekly full reconcile, or by the contact's next nudge, which only happens when they place a new order. When the hop's time budget runs out during the scan, it stores `m06reconcile:{locationId}:{YYYY-MM-DD}` with the next offset and the contact ids already handled, and the same `waitUntil` continuation resumes the scan. A finished scan is remembered for 36 hours so a later pass the same local day does not list orders again.

On `M06_FULL_RECONCILE_WEEKDAY` (default Friday) in the tenant timezone, that same hop ignores the 48 hour window and the 30 page cap. It recomputes every distinct contact id on the location's orders, still with `limit=100`, the per-contact lock, and the metrics hash skip. Paging stops at a safety cap of 500 pages, and that warning includes the location id, the pages scanned, and the last order's `createdAt`. Progress is stored on `m06full:{locationId}:{YYYY-MM-DD}` and continues across hops with the same time-budget cursor and `waitUntil` call. That cursor keeps at most 2000 contact ids, the most recently handled ones, so a large location cannot grow the Redis value without a bound. A contact that drops out of that window can be recomputed if they appear on a later page, and the metrics hash makes a repeat write a no-op. There is no second Vercel cron. The job still runs at 03:00 UTC, so a tenant whose local weekday is not the configured day yet keeps the 48 hour scan. A Chicago location is still on Thursday at 03:00 UTC Friday and runs the full scan on the Saturday 03:00 UTC hop, which is Friday evening there.

Eligibility for a contact refreshed in this hop uses those freshly computed values (`qualifying_order_count`, `total_orders`, `last_order_date`, and `typical_order_interval_days`), including when the hash was unchanged and the contact update was skipped. Every other contact still uses the M06 fields already stored on the contact:

- qualifying count from `qualifying_order_count`, falling back to `total_orders`
- days since the last order, recomputed from `last_order_date` and today's date in the tenant timezone
- `typical_order_interval_days`

A contact is eligible when the qualifying count is at least 3, days since the last order are at least 21, the typical interval is greater than 0, and `days_since_last / typical` rounds to at least 1.5. Tier is `High` at 2.0 or more and `Medium` otherwise. Anyone else who already has order history is `Not Eligible` / `None`. Contacts with no qualifying count and no last order date are left alone. Contacts whose `winback_cycle_status` is `In Progress` are skipped.

The eligibility pass writes only `winback_eligibility` and `winback_tier`, and only when those values change. The reconcile above is what writes M06 fields. `winback_cycle_status` and `winback_cycle_started_at` are never written.

`M10_ENROLL_ENABLED=true` adds an eligible contact to the tenant's `m10_workflow_id`. The flag defaults off. Enrollment is recorded on its own key, `m10enroll:{locationId}:{contactId}`, for 180 days. The eligibility fields are still written when the workflow call fails. A later run retries that call until it succeeds, including when the contact is already `Eligible` and including a later pass on the same local day. The marker is removed when the contact is not eligible, so a later cycle can enroll again. A recorded success is not repeated while the marker is present.

## Divergences from the M10 calculator

- The calculator read `total_orders`. The cron prefers `qualifying_order_count` and uses `total_orders` only when that field is empty. After M06 those two counts are the same full qualifying count.
- The calculator parsed `last_order_date` with `new Date(...)` and then converted to `Africa/Cairo`. A stored DATE field is a calendar year-month-day with no tenant-timezone conversion. The accepted shapes are `YYYY-MM-DD`, legacy `MM-DD-YYYY`, an ISO datetime by its UTC day, and epoch milliseconds. Other text, such as `10/21/2026`, is ignored. Impossible dates such as `2026-02-31` are ignored. `2026-10-21T00:00:00.000Z` stays 2026-10-21 in America/Chicago.
- The calculator can emit `daysOverdue`. The cron does not write it. M06 already writes `days_overdue`, rounded to two decimals.
- Tier stays `None` unless the contact is eligible. That matches the calculator and not the M06 resolver, which assigned a tier from the ratio alone.
- Contacts whose orders were updated inside `M06_RECONCILE_HOURS` are recomputed before eligibility. On the configured weekday the cron recomputes every contact with an order. The calculator read whatever was already stored. Contacts outside the daily window still use the stored fields on the other days.

## Environment

Copy `.env.example` to `.env.local`. Values are names only; do not commit secrets.

| Name | Required | Purpose |
| --- | --- | --- |
| `TENANT_STORE` | no | `neon` (default) or `env`. Selects where tenant records are loaded from. |
| `DATABASE_URL` | when `TENANT_STORE=neon` | Pooled Neon Postgres URL. Runtime reads and writes use this. |
| `DATABASE_URL_UNPOOLED` | migrations | Direct Neon URL. `npm run db:migrate` applies `migrations/*.sql` with this and nothing else. |
| `TENANT_KEY_ENCRYPTION_KEY` | yes | 32-byte key, base64 or 64-char hex, for tenant API keys |
| `TENANT_CONFIG` | `env` store, one of two forms | JSON object for the single test-phase tenant. When set, discrete `TENANT_*` fields below are ignored. |
| `TENANT_LOCATION_ID` | `env` store, if `TENANT_CONFIG` is unset | Location id of the single tenant |
| `TENANT_NAME` | no | Display name. Defaults to the location id. |
| `TENANT_API_KEY` | `env` store, one key form | Plaintext GoHighLevel token. Encrypted in memory with `TENANT_KEY_ENCRYPTION_KEY`. Do not set this together with `TENANT_API_KEY_ENCRYPTED`. |
| `TENANT_API_KEY_ENCRYPTED` | `env` store, the other key form | `v1:` ciphertext from `scripts/encrypt-api-key.mjs`. |
| `TENANT_TIMEZONE` | no | IANA timezone. Defaults to `UTC`. |
| `TENANT_CURRENCY` | no | Defaults to `USD`. Stored only; amounts are not rescaled. |
| `TENANT_M10_WORKFLOW_ID` | no | Workflow id used when M10 enrollment is enabled. |
| `TENANT_ACTIVE` | no | `false` or `0` disables the tenant. Defaults to active. |
| `TENANT_WEBHOOK_TOKEN_HASH` | webhook | SHA-256 hex of this tenant's webhook query token. Required in every environment, including Preview. Also accepted as `webhookTokenHash` inside `TENANT_CONFIG`. |
| `KV_REST_API_URL` | required when `VERCEL_ENV=production` | Upstash Redis REST URL (Vercel KV name). Production fails closed when this pair is missing. |
| `KV_REST_API_TOKEN` | required when `VERCEL_ENV=production` | Upstash Redis REST token (Vercel KV name). |
| `UPSTASH_REDIS_REST_URL` | fallback | Used only together with `UPSTASH_REDIS_REST_TOKEN`, and only when the `KV_REST_API_*` pair is unset. |
| `UPSTASH_REDIS_REST_TOKEN` | fallback | Pair with `UPSTASH_REDIS_REST_URL`. A URL from one pair and a token from the other are ignored. |
| `CRON_SECRET` | yes, for the cron | Bearer token Vercel Cron sends |
| `GHL_API_BASE_URL` | no | Defaults to `https://services.leadconnectorhq.com`. Version header is `2021-07-28`. |
| `M10_ENROLL_ENABLED` | no | `true` enrolls newly eligible contacts into `m10_workflow_id`. Default off. |
| `M06_RECONCILE_HOURS` | no | How many hours of order updates the daily cron recomputes before eligibility. Default 48. Invalid values use 48. |
| `M06_RECONCILE_MAX_PAGES` | no | Newest-first `limit=100` pages of location orders to scan on days other than the full reconcile. Default 30 (about 3000 most recently created orders). Invalid values use 30. |
| `M06_FULL_RECONCILE_WEEKDAY` | no | Tenant-local weekday for a full order scan on the same daily hop. Default `friday`. Invalid values use Friday. |

The Vercel Marketplace also injects `POSTGRES_URL`, `KV_URL`, `REDIS_URL`, and `KV_REST_API_READ_ONLY_TOKEN`. This service does not read those.

Logs are JSON on stdout. The logger redacts `apiKey`, `authorization`, `token`, `secret`, bearer strings, and every query string. Every `contactId`, `contact_id`, and `contactIds` value is replaced with the same 12-character SHA-256 prefix, so the raw contact id is never written. Do not log tenant API keys, webhook tokens, or the webhook body.

## Add a tenant

`TENANT_STORE` selects the backend. `neon` is the multi-tenant store. `env` is a single-tenant store for the test phase and does not need `DATABASE_URL`. Both decrypt the API key only in memory for the GoHighLevel call. Unknown or inactive locations do no work.

### Neon (`TENANT_STORE=neon`)

1. Apply every file in `migrations/` with the unpooled URL. The script reads `DATABASE_URL_UNPOOLED` and does not use the pooled runtime URL:

```bash
npm run db:migrate
```

2. Upsert a tenant. The GoHighLevel private-integration token is read from stdin and is not an argument. The script encrypts it with `TENANT_KEY_ENCRYPTION_KEY`, writes the ciphertext to `DATABASE_URL`, generates a webhook token, and stores only the SHA-256 hash. The token is printed once on stderr. stdout is `upserted LOCATION_ID` and does not include the token, the API key, or the ciphertext.

```bash
export TENANT_KEY_ENCRYPTION_KEY="base64-32-byte-key"
export DATABASE_URL="postgres://pooled"
export TENANT_LOCATION_ID="LOCATION_ID"
export TENANT_NAME="Restaurant name"
export TENANT_TIMEZONE="Africa/Cairo"
export TENANT_CURRENCY="EGP"
printf '%s' "$GHL_TOKEN" | npm run db:upsert-tenant
```

`timezone` is an IANA name used for calendar-day math. `currency` is stored for the tenant and is not used to rescale order amounts. `TENANT_M10_WORKFLOW_ID` is optional until enrollment is turned on. `TENANT_ACTIVE=false` stores an inactive row. Running the command again replaces that location's API key and webhook hash and prints a new token; the previous token stops matching.

To encrypt a token without writing a row (for `TENANT_STORE=env`), keep using stdin:

```bash
export TENANT_KEY_ENCRYPTION_KEY="base64-32-byte-key"
printf '%s' "$GHL_TOKEN" | node scripts/encrypt-api-key.mjs
```

### Environment (`TENANT_STORE=env`)

One tenant, either as JSON or as discrete variables. `upsert` changes the process copy only.

```bash
TENANT_STORE=env
TENANT_CONFIG={"locationId":"LOCATION_ID","name":"Restaurant name","apiKey":"pit-...","timezone":"Africa/Cairo","currency":"EGP","m10WorkflowId":null,"active":true}
```

The same tenant as discrete variables, with a ciphertext key:

```bash
TENANT_STORE=env
TENANT_LOCATION_ID=LOCATION_ID
TENANT_NAME=Restaurant name
TENANT_API_KEY_ENCRYPTED=v1:...
TENANT_TIMEZONE=Africa/Cairo
TENANT_CURRENCY=EGP
TENANT_M10_WORKFLOW_ID=
TENANT_ACTIVE=true
```

`apiKey` and `apiKeyEncrypted` are mutually exclusive. A plaintext `apiKey` is encrypted with `TENANT_KEY_ENCRYPTION_KEY` before the rest of the service sees it.

## Webhook token

Each tenant has its own query token. The database and env store keep only the SHA-256 hex digest (`webhook_token_hash` / `webhookTokenHash`). A standard GoHighLevel Webhook action cannot set headers, so the token is the `t` query parameter on that location's webhook URL.

Generate a token and its hash. The hash is written to stdout. The token is written to stderr once and is not an argument:

```bash
node scripts/webhook-token.mjs > /tmp/webhook-hash.txt
```

Put the hash on the tenant. Put the token only in the workflow URL:

```text
https://<deployment>/api/webhooks/ghl?t=<token>
```

Rotate by generating a new pair and replacing that tenant's hash. The previous token stops matching as soon as the hash is saved. A tenant with no hash is rejected in every environment, including Preview and local runs.

Regenerate the field catalog after a fixture change:

```bash
npm run generate:fields
```

Runtime writes resolve custom-field ids with `GET /locations/{locationId}/customFields?model=contact` and match `fieldKey`. The key-to-id map is cached per location in Redis for 10 minutes. A missing key or an HTTP 400/422 from the contact update drops that cache and loads the list once more. The ids in `src/schema/fields.ts` are the test-lab reference, not ids to send for other locations.

## Field contract

`contact.customerdaysoverdue` and `contact.winback_status` are not in the catalog. Do not reference them.

M06 writes these keys (and does not write win-back eligibility):

`total_orders`, `qualifying_order_count`, `first_order_date`, `last_order_date`, `lifetime_value`, `average_order_value`, `highest_order_value`, `lowest_order_value`, `customer_type`, `customer_status`, `lifecycle_stage`, `last_order_location`, `last_order_type`, `average_order_interval_days`, `typical_order_interval_days`, `orders_last_30_days`, `orders_previous_30_days`, `spend_last_30_days`, `spend_previous_30_days`, `order_frequency_trend`, `spending_trend`, `days_since_last_order`, `expected_next_order_date`, `days_overdue`, `overdue_ratio`, `favorite_item`, `top_items`, `favorite_category`, `top_categories`, `category_diversity`, `preferred_order_type`, `preferred_location`, `purchase_consistency`, `order_source_mix`, `primary_order_source`, `lifetime_spend_percentile`, `order_frequency_percentile`, `customer_value_score`, `vip_classification`, `vip_status`, `metrics_hash`, `m06_intelligence_updated_at`.

`favorite_item` is the product name with the highest quantity across qualifying orders, with line spend (`price.amount × qty`) and then the latest order date breaking ties. `top_items` is the first five of those names, separated by `, `. `favorite_category` is the collection name with the highest quantity. A line with several collections counts its quantity and line spend toward each distinct name. A line with no collection, or a collection id the location cache cannot name, is left out and is not recorded as Uncategorized. `top_categories` is the first five names, separated by `, `. `category_diversity` is the number of distinct names, or blank when there are none. Names are read from Redis key `m06:collections:{locationId}` (24 hours). A hit is one GET. A missing key, or an id that is not in the map, refreshes with `GET /products/collections` (`altId`, `altType=location`, `limit=100`, `collectionIds`), one request per 100 missing ids, then one SET. A rate limit or timeout leaves the three category keys off the update and out of the hash, and the webhook still writes the other fields. `preferred_order_type` is the most common checkout method, mapped the same way as `last_order_type` (`shipping` → Delivery, `pickup` → Pickup). `preferred_location` is the most common per-order location, using the same branch-then-source rule as `last_order_location`. The item fields, preferred order type, preferred location, and the three category fields come from order detail. They are written only when this pass has a cached summary for every qualifying order. An incomplete pass leaves the keys off the contact update, so GoHighLevel keeps the previous values, and queues the contact on `m06:backfill:{locationId}`. The daily reconcile drains that set and writes the fields once the summaries are complete. `order_source_mix` is `source name: count` for qualifying orders, separated by `, `. `primary_order_source` maps the winning source category onto the picklist: website, funnel, or store → Online Store; pos → POS; a delivery integration → Delivery Platform; manual or invoice → Manual; import → Imported; anything else → Other. Ties for type, location, mix, and primary source use count, then spend, then the latest date. `purchase_consistency` is the population coefficient of variation of the existing tenant-timezone day intervals: score `100 × (1 − sd / mean)`, then Highly Consistent at 85, Consistent at 65, Variable at 40, otherwise Sporadic. Fewer than two intervals is Insufficient Data. List-derived fields and the older M06 fields are written on every pass.

`lifetime_spend_percentile` and `order_frequency_percentile` rank this contact against the previous completed distribution: `(count of stored values ≤ this value − 1) / (n − 1) × 100`, clamped to 0–100 and rounded to two decimals. No stored values, or one, is 100. Spend uses lifetime value. Frequency uses the qualifying order count. Recency is 100 through 30 tenant-timezone days since the last order, 75 through 60, 50 through 90, 25 through 180, and 0 after that. Consistency maps the label already written for this contact: Highly Consistent 100, Consistent 75, Variable 50, Sporadic 25, Insufficient Data 0. `customer_value_score` is `0.40 × spend percentile + 0.25 × frequency percentile + 0.20 × recency + 0.15 × consistency`, rounded to two decimals. `vip_status` is VIP when that score's percentile is at least 90 and the distribution has at least 10 customers. Otherwise it is Not VIP. Tied scores share one percentile, so everyone on the 90th percentile is VIP. `vip_classification` is Not VIP unless the contact is VIP. A VIP contact with both percentiles at least 90 is High Value & High Frequency, spend alone is Spend Leader, frequency alone is Frequency Leader, and any other VIP is Emerging VIP. A contact with no qualifying orders gets blank percentile and score fields. Blank VIP picklists stay in the hash as an empty string and are left off the contact update. Before a distribution exists, or when the Redis read fails, the five keys stay off the update and out of the hash. The webhook reads `m10:dist:{locationId}` once. That is one Redis `GET` and no contact search.

`metrics_hash` is a sha256 of the formatted values this pass would write. `last_order_type`, `preferred_order_type`, and `primary_order_source` stay in that hash as an empty string when the blank value is left off the contact update. While a summary pass is incomplete, `favorite_item`, `top_items`, `preferred_order_type`, `preferred_location`, `favorite_category`, `top_categories`, and `category_diversity` are left out of the hash as well as the update, so a second incomplete pass does not rewrite and the later complete pass is not skipped. A failed collection-name refresh leaves only the three category keys out, even when the order summaries are complete. The five value keys follow that same gate until a distribution is stored. `m06_intelligence_updated_at` is excluded from the hash. When the stored hash matches, the contact `PUT` is skipped entirely, which stops a Contact Changed workflow from looping on its own write. The timestamp therefore moves only when some other written value changes. Adding these keys changes the hash once for contacts that already had M06 values.

`average_order_interval_days` is the mean of the collapsed intervals. `typical_order_interval_days` is the median. `days_overdue` and `overdue_ratio` are rounded to two decimals. `total_orders` and `qualifying_order_count` are the same full qualifying count. Zero qualifying orders write `lifecycle_stage` as `NO QUALIFYING ORDERS`. `last_order_type` is the customer's checkout choice on the latest qualifying order. The list payload does not include it. After qualifying orders are filtered, the service fetches `GET /payments/orders/{orderId}` with `altId` and `altType=location` for that one order. `delivery.method` `shipping` is written as Delivery and `pickup` as Pickup. Any other method, or a missing `delivery` object, is omitted from the contact update. Shipping fees, shipping rates, and payment method names are not used. If that detail says `markAsTest` is true, the order is excluded and the next latest qualifying order is fetched, up to three detail calls. A failed detail omits `last_order_type` and does not fail the webhook. The detail body is not logged. `last_order_location` is the branch name on the latest qualifying order when that order's detail has one, checked as `delivery.location`, `delivery.locationName`, `delivery.store`, `delivery.storeName`, `delivery.branch`, then `delivery.branchName`, and then those same names on the order. A string or an object `name` is accepted, and blank values are skipped. Otherwise the field stays the order's source name (`sourceName`, or `source.name` when the flat field is absent). Test Lab details have no branch field, so the value stays the source name. A missing branch and source name is written as an empty string. Order dates are written as `YYYY-MM-DD` in the tenant timezone. A stored DATE field is read as a calendar date with no tenant-timezone conversion. Accepted shapes are `YYYY-MM-DD`, legacy `MM-DD-YYYY`, an ISO datetime by its UTC year-month-day (including the midnight UTC string contact search returns, `2026-10-21T00:00:00.000Z`), and epoch milliseconds. `10/21/2026` and other unlisted shapes are rejected. A value has to be a real calendar day, so `2026-02-31` is rejected. `2026-10-21T00:00:00.000Z` stays 2026-10-21 for America/Chicago.

M10 writes only `winback_eligibility` and `winback_tier`.

The workflow owns `winback_cycle_status` and `winback_cycle_started_at`. This service reads `winback_cycle_status` and never writes either field.

## Idempotency keys

| Key | TTL | Meaning |
| --- | --- | --- |
| `evt:{locationId}:{contactId}:{eventId}` | 300s | Only when the payload includes `eventId` or `webhookId`. A derived contact hash is not used. |
| `lock:{locationId}:{contactId}` | 30s | One in-flight computation per contact |
| `rerun:{locationId}:{contactId}` | 120s | A nudge arrived during the lock and must be computed again |
| `m10:{locationId}:{YYYY-MM-DD}` | at least 360 seconds, released when the hop finishes | One in-flight M10 hop per location. The date is the tenant's calendar day. The TTL is longer than the 300 second function limit. |
| `m10cursor:{locationId}:{YYYY-MM-DD}` | 2 hours | `searchAfter` cursor when a tenant hop stops for the time budget. |
| `m06reconcile:{locationId}:{YYYY-MM-DD}` | 36 hours when the scan finishes, 2 hours while a cursor is in progress | Daily order-update reconcile. The in-progress value is the next offset and at most 2000 contact ids already recomputed. |
| `m06full:{locationId}:{YYYY-MM-DD}` | 36 hours when the scan finishes, 2 hours while a cursor is in progress | Weekly full reconcile for the tenant's local weekday. Same cursor shape and 2000-id cap as the daily key. |
| `m10enroll:{locationId}:{contactId}` | 180 days | Workflow enrollment already succeeded for this eligibility stretch. Deleted when the contact is not eligible. |
| `m06:collections:{locationId}` | 24 hours | Collection id to category name for the location. One GET on a hit. Refreshed when the key is missing or a line's collection id is absent. |
| `m10:dist:{locationId}` | 8 days | Previous completed value distribution: sorted spend, qualifying-order counts, and value scores. No contact id. One GET on the webhook. Replaced when the next contact scan finishes. |
| `m10:dist-build:{locationId}:{YYYY-MM-DD}` | 2 hours | Samples collected before the current contact cursor. Deleted when the scan finishes or the tenant hop throws. Not read by the webhook. |

`YYYY-MM-DD` is the date in the tenant timezone.

## GoHighLevel client

Orders: `GET /payments/orders` with `locationId`, `altId`, `altType=location`, `contactId`, `limit=100`, and `offset`. The default order is newest-first by `createdAt`. Pages continue until `totalCount` is covered. The client does not issue one `limit=500` request and does not send `startAt` or `endAt`. A page cap throws instead of writing metrics from a partial history. Orders for a different `contactId` are dropped. The daily reconcile uses the same path without `contactId`, still with `limit=100`, and reads one page at a time. `fixtures/list-orders-sample.json` is a redacted live list payload: `amount` is major units after discount, `paymentStatus` and `liveMode` are present, and `markAsTest` is absent. The list does not include checkout type. The latest qualifying order is then read with `GET /payments/orders/{orderId}?altType=location&altId=`, which is where `delivery.method` lives. That call uses the same per-location spacing and timeout as other reads. `fixtures/order-detail-shipping.json`, `fixtures/order-detail-pickup.json`, and `fixtures/order-detail-no-delivery.json` are redacted detail payloads with no contact snapshot.

Contacts for the cron: `POST /contacts/search` with `pageLimit` and `searchAfter`. `fixtures/contact-search-dates.json` is a redacted search page whose `last_order_date` values are `YYYY-MM-DD`, `YYYY-MM-DDT00:00:00.000Z`, `MM-DD-YYYY`, and epoch milliseconds.

Custom fields: `PUT /contacts/{contactId}` sends `{ id, key, field_value }` for the fields being changed.

Per-location spacing defaults to 100ms between requests on a warm instance. It is process-local. Idempotent reads retry HTTP 429, HTTP 5xx, and network failures with exponential backoff and jitter, capped at 20 seconds. `Retry-After` is honored up to 60 seconds. Workflow enrollment `POST` is not retried.

## Divergences from the STENZ custom code

The attached M06 resolver is the starting point. These locked rules replace it:

- Qualifying orders are `liveMode && !markAsTest && amount > 0`, with order status other than `cancelled`, `refunded`, or `partially_refunded`, and `paymentStatus` in `paid`, `unpaid`, or `partially_paid`. The resolver instead required `status === "completed"` and ignored payment status, so a completed refunded order qualified and an unpaid COD order only qualified when its status was exactly `completed`. Fulfillment status still does not disqualify an order. The resolver also required `contactId`; this service does not, because orders are already fetched for one contact.
- `total_orders`, `qualifying_order_count`, and lifetime value count every qualifying order. Interval math collapses orders that share a calendar day in the tenant timezone, so there are no 0-day gaps. The resolver pushed a 0-day interval for same-day orders. Two orders on day 1 and one on day 11 are 3 orders and intervals `[10]`. Three orders on one day produce `intervals = []`, `typical_order_interval_days` empty, and `overdue_ratio` empty.
- The resolver computed win-back eligibility inside M06 (`>= 2` orders, no 21-day minimum) and a tier even when the contact was not eligible. M06 here does not write eligibility or tier. The daily cron uses the M10 calculator rule: at least 3 qualifying orders, at least 21 days since the last order, typical interval greater than 0, and overdue ratio at least 1.5.
- The resolver ranked value and VIP from every qualifying order held in memory, rounded the score to an integer, and labeled High Value, Mid Value, or Standard. This service ranks against the previous night's stored distribution, rounds percentiles and the score to two decimals, and sets VIP at the 90th percentile of value scores when at least 10 customers were ranked.
- The resolver left `daysOverdue` unrounded. Values here are rounded to two decimals, including inside M06.
- The resolver set `lastOrderType` to null on purpose. It is the checkout `delivery.method` on the latest qualifying order's detail: `shipping` writes Delivery and `pickup` writes Pickup. Any other value, including a missing `delivery` object, `sourceSubType`, a shipping fee, or a payment method name, is left off the contact update. A detail `markAsTest: true` excludes that order and the next latest is tried, up to three detail calls.
- The resolver's last lifecycle label was `LOST / DORMANT`. The field is written as `LOST`. Zero qualifying orders stay `NO QUALIFYING ORDERS`, which is the resolver's label and is not one of the six non-empty stages.
- `qualifying_order_count`, `lifecycle_stage`, and `metrics_hash` were not written by the resolver. They are written now. `m06_intelligence_updated_at` is the updated-at field. There is no `metrics_updated_at`.
- The resolver's contact update reformatted dates to `MM-DD-YYYY`. DATE custom fields are written as `YYYY-MM-DD`. Contact search returns those same fields as ISO midnight UTC, and a legacy value may still be `MM-DD-YYYY`. Reading a stored DATE field takes the UTC calendar date of an ISO datetime and of epoch milliseconds, so a negative-offset tenant does not move the day backward. `YYYY-MM-DD` and legacy `MM-DD-YYYY` are accepted on read. Other shapes, including `10/21/2026`, and impossible days such as `2026-02-31` are not.
- The resolver loaded orders with one `limit=500` request. Orders are paged with `offset` until `totalCount`.
- `total_orders` stays the qualifying count, matching the resolver. `qualifying_order_count` is that same full count, not the count of distinct days.
- The mapping note cited overdue-ratio id `utMAZhK2y8laZAfqAJXb`. The test-lab snapshot id is `PysK1ynJ47hCLa8y2G6u`. Runtime mapping uses the key, and the snapshot is the id fixture.

Preserved from the resolver: average interval is the mean, typical interval is the median, customer type/status bands, 30-day trend comparison, and trailing-12-month frequency labels (those labels are computed and not written; no contact field is assigned to them).

## Dependencies

The application does not import zod. `@vercel/functions` depends on `@vercel/oidc`, which depends on `@vercel/cli-config`, which depends on zod. That transitive copy resolved to `4.1.11`, which is below the patched `4.6.7` release. `package.json` overrides zod to `4.6.7` so `npm audit` stays clean.

## Checks

```bash
npm install
npm test
npm run typecheck
npm run lint
```

Node.js 22.18 or newer. Tests use mocked `fetch`, in-memory stores, and the test-lab fixture. They do not call GoHighLevel, Neon, or Upstash.
