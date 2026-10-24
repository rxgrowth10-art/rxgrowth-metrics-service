# rxgrowth-metrics-service

Multi-tenant customer metrics for restaurant locations on GoHighLevel. A workflow Webhook action sends `locationId` and `contactId`. This service loads that tenant's API key, re-fetches the contact's orders, computes metrics, and writes them back to contact custom fields.

This revision adds the M06 webhook on top of the foundation. The M10 daily cron is the next change. Nothing here calls GoHighLevel or provisions a Vercel project.

## Layout

- `api/health.ts` — liveness check.
- `src/schema/fields.ts` — generated catalog of the RX Test Lab custom fields, keyed for runtime lookup. Test-lab ids are fixtures only.
- `src/tenants/` — `TenantStore`. `TENANT_STORE=neon` uses Neon Postgres. `TENANT_STORE=env` loads one tenant from the environment for the test phase. API keys are AES-256-GCM ciphertext. Tests use the in-memory store.
- `src/ghl/` — HTTP client. Timeout, retry with backoff on 429 and 5xx, per-location spacing, order pages via `offset`, contact search via `searchAfter`.
- `src/idempotency/` — `SET NX` with TTL. Upstash Redis via `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_REST_*` pair when the KV pair is unset). Production fails closed. Other environments use memory when neither pair is set.
- `src/time/business-date.ts` — tenant-timezone calendar dates.
- `migrations/001_tenants.sql` — Neon schema.
- `fixtures/test-lab-fields.json` — final custom-field snapshot for location `ekxOqjUKW7M6OV9XAVnx`.

- `api/webhooks/ghl.ts` — M06 nudge. `POST` JSON `{ "locationId", "contactId" }`. Any other property is ignored. Unknown or inactive tenants return 202 without calling GoHighLevel. A second nudge is not dropped; an unchanged metrics hash skips the write.
- `api/cron/m10.ts` — daily win-back pass, still to be added. It will require `Authorization: Bearer $CRON_SECRET`.

## Webhook

```bash
curl -X POST 'https://<deployment>/api/webhooks/ghl?t=TENANT_WEBHOOK_TOKEN' \
  -H 'content-type: application/json' \
  -d '{"locationId":"LOCATION_ID","contactId":"CONTACT_ID"}'
```

The handler returns 202 after it re-fetches orders and either writes metrics or skips an unchanged hash. It returns 400 when `locationId` or `contactId` is missing, 401 when the tenant's `?t=` token does not match `webhook_token_hash`, and 500 when processing fails so the sender can retry. In production the hash is required. Outside production a tenant with no hash is accepted so tests can run. The payload is only a signal. There is no shared webhook secret: a standard GoHighLevel Webhook action cannot set headers, so each location's workflow URL carries that tenant's token. Query strings are stripped from logs.

A nudge with no `eventId` is always computed, guarded by a 30 second per-contact lock. If a second nudge arrives while that lock is held, it is queued and the in-flight run computes once more after it finishes, so a new order a few seconds later is not dropped. An explicit `eventId` or `webhookId` is still deduped for 300 seconds.

List items that already include `paymentStatus` and `liveMode` are used as-is. `markAsTest` is often absent and then means not a test order. If `paymentStatus` or `liveMode` is missing, the service fetches `GET /payments/orders/{orderId}` with `altId` and `altType=location` before applying the qualifying rule. Orders whose `contactId` is some other contact are dropped. `altId` and `altType=location` are sent on every order request.

M06 never writes `winback_eligibility` or `winback_tier`.

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
| `TENANT_WEBHOOK_TOKEN_HASH` | production webhook | SHA-256 hex of this tenant's webhook query token. Also accepted as `webhookTokenHash` inside `TENANT_CONFIG`. |
| `KV_REST_API_URL` | required when `VERCEL_ENV=production` | Upstash Redis REST URL (Vercel KV name). Production fails closed when this pair is missing. |
| `KV_REST_API_TOKEN` | required when `VERCEL_ENV=production` | Upstash Redis REST token (Vercel KV name). |
| `UPSTASH_REDIS_REST_URL` | fallback | Used only together with `UPSTASH_REDIS_REST_TOKEN`, and only when the `KV_REST_API_*` pair is unset. |
| `UPSTASH_REDIS_REST_TOKEN` | fallback | Pair with `UPSTASH_REDIS_REST_URL`. A URL from one pair and a token from the other are ignored. |
| `CRON_SECRET` | yes, for the cron | Bearer token Vercel Cron sends |
| `GHL_API_BASE_URL` | no | Defaults to `https://services.leadconnectorhq.com`. Version header is `2021-07-28`. |
| `M10_ENROLL_ENABLED` | no | `true` enrolls newly eligible contacts into `m10_workflow_id`. Default off. |

The Vercel Marketplace also injects `POSTGRES_URL`, `KV_URL`, `REDIS_URL`, and `KV_REST_API_READ_ONLY_TOKEN`. This service does not read those.

Logs are JSON on stdout. The logger redacts `apiKey`, `authorization`, `token`, `secret`, bearer strings, and every query string. Do not log tenant API keys or webhook tokens.

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

Rotate by generating a new pair and replacing that tenant's hash. The previous token stops matching as soon as the hash is saved. In production (`VERCEL_ENV=production`) a tenant with no hash is rejected. Outside production, a missing hash leaves the check off so local tests can run. When a hash is set, it is required in every environment.

Regenerate the field catalog after a fixture change:

```bash
npm run generate:fields
```

Runtime writes resolve custom-field ids with `GET /locations/{locationId}/customFields?model=contact` and match `fieldKey`. The ids in `src/schema/fields.ts` are the test-lab reference, not ids to send for other locations.

## Field contract

`contact.customerdaysoverdue` and `contact.winback_status` are not in the catalog. Do not reference them.

M06 writes these keys (and does not write win-back eligibility):

`total_orders`, `qualifying_order_count`, `first_order_date`, `last_order_date`, `lifetime_value`, `average_order_value`, `highest_order_value`, `lowest_order_value`, `customer_type`, `customer_status`, `lifecycle_stage`, `last_order_location`, `last_order_type`, `average_order_interval_days`, `typical_order_interval_days`, `orders_last_30_days`, `orders_previous_30_days`, `spend_last_30_days`, `spend_previous_30_days`, `order_frequency_trend`, `spending_trend`, `days_since_last_order`, `expected_next_order_date`, `days_overdue`, `overdue_ratio`, `metrics_hash`, `m06_intelligence_updated_at`.

`metrics_hash` is a sha256 of the formatted values M06 would write. `m06_intelligence_updated_at` is excluded from that hash. When the stored hash matches, the contact `PUT` is skipped entirely, which stops a Contact Changed workflow from looping on its own write. The timestamp therefore moves only when some other written value changes.

`average_order_interval_days` is the mean of the collapsed intervals. `typical_order_interval_days` is the median. `days_overdue` and `overdue_ratio` are rounded to two decimals. `total_orders` and `qualifying_order_count` are the same full qualifying count. Zero qualifying orders write `lifecycle_stage` as `NO QUALIFYING ORDERS`. `last_order_type` is written only when the latest qualifying order's `sourceSubType` maps to Delivery, Pickup, or Dine-in (case-insensitive, with `dine_in` and `dinein` accepted as Dine-in). Any other value is omitted from the contact update so a picklist rejection cannot fail the rest of the write. `last_order_location` comes from `sourceName`. Dates are `YYYY-MM-DD` in the tenant timezone.

M10 writes only `winback_eligibility` and `winback_tier`.

The workflow owns `winback_cycle_status` and `winback_cycle_started_at`. This service reads `winback_cycle_status` and never writes either field.

## Idempotency keys

| Key | TTL | Meaning |
| --- | --- | --- |
| `evt:{locationId}:{contactId}:{eventId}` | 300s | Only when the payload includes `eventId` or `webhookId`. A derived contact hash is not used. |
| `lock:{locationId}:{contactId}` | 30s | One in-flight computation per contact |
| `rerun:{locationId}:{contactId}` | 120s | A nudge arrived during the lock and must be computed again |
| `m10:{locationId}:{YYYY-MM-DD}` | through the tenant's calendar day | One daily cron pass per location |

`YYYY-MM-DD` is the date in the tenant timezone.

## GoHighLevel client

Orders: `GET /payments/orders` with `locationId`, `altId`, `altType=location`, `contactId`, `limit`, and `offset`. Pages continue until `totalCount` is covered. The client does not issue one `limit=500` request. A page cap throws instead of writing metrics from a partial history. Orders for a different `contactId` are dropped. `fixtures/list-orders-sample.json` is a redacted live list payload: `amount` is major units after discount, `paymentStatus` and `liveMode` are present, and `markAsTest` is absent.

Contacts for the cron: `POST /contacts/search` with `pageLimit` and `searchAfter`.

Custom fields: `PUT /contacts/{contactId}` sends `{ id, key, field_value }` for the fields being changed.

Per-location spacing defaults to 100ms between requests on a warm instance. It is process-local. Idempotent reads retry HTTP 429, HTTP 5xx, and network failures with exponential backoff and jitter, capped at 20 seconds. `Retry-After` is honored up to 60 seconds. Workflow enrollment `POST` is not retried.

## Divergences from the STENZ custom code

The attached M06 resolver is the starting point. These locked rules replace it:

- Qualifying orders are `liveMode && !markAsTest && amount > 0 && status !== cancelled && paymentStatus in paid, unpaid, partially_paid`. The resolver instead required `status === "completed"` and ignored payment status, so a completed refunded order qualified and an unpaid COD order only qualified when its status was exactly `completed`. Fulfillment status still does not disqualify an order. The resolver also required `contactId`; this service does not, because orders are already fetched for one contact.
- `total_orders`, `qualifying_order_count`, and lifetime value count every qualifying order. Interval math collapses orders that share a calendar day in the tenant timezone, so there are no 0-day gaps. The resolver pushed a 0-day interval for same-day orders. Two orders on day 1 and one on day 11 are 3 orders and intervals `[10]`. Three orders on one day produce `intervals = []`, `typical_order_interval_days` empty, and `overdue_ratio` empty.
- The resolver computed win-back eligibility inside M06 (`>= 2` orders, no 21-day minimum) and a tier even when the contact was not eligible. M06 here does not write eligibility or tier. The daily cron will use the M10 calculator rule.
- The resolver left `daysOverdue` unrounded. Values here are rounded to two decimals, including inside M06.
- The resolver set `lastOrderType` to null on purpose. It is now `sourceSubType` when that maps onto Delivery, Pickup, or Dine-in. Any other value is left off the contact update.
- The resolver's last lifecycle label was `LOST / DORMANT`. The field is written as `LOST`. Zero qualifying orders stay `NO QUALIFYING ORDERS`, which is the resolver's label and is not one of the six non-empty stages.
- `qualifying_order_count`, `lifecycle_stage`, and `metrics_hash` were not written by the resolver. They are written now. `m06_intelligence_updated_at` is the updated-at field. There is no `metrics_updated_at`.
- The resolver's contact update reformatted dates to `MM-DD-YYYY`. DATE custom fields are written as `YYYY-MM-DD`.
- The resolver loaded orders with one `limit=500` request. Orders are paged with `offset` until `totalCount`.
- `total_orders` stays the qualifying count, matching the resolver. `qualifying_order_count` is that same full count, not the count of distinct days.
- The mapping note cited overdue-ratio id `utMAZhK2y8laZAfqAJXb`. The test-lab snapshot id is `PysK1ynJ47hCLa8y2G6u`. Runtime mapping uses the key, and the snapshot is the id fixture.

Preserved from the resolver: average interval is the mean, typical interval is the median, customer type/status bands, 30-day trend comparison, and trailing-12-month frequency labels (those labels are computed and not written; no contact field is assigned to them).

## Checks

```bash
npm install
npm test
npm run typecheck
npm run lint
```

Node.js 22.18 or newer. Tests use mocked `fetch`, in-memory stores, and the test-lab fixture. They do not call GoHighLevel, Neon, or Upstash.
