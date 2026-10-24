# rxgrowth-metrics-service

Multi-tenant customer metrics for restaurant locations on GoHighLevel. A workflow Webhook action sends `locationId` and `contactId`. This service loads that tenant's API key, re-fetches the contact's orders, computes metrics, and writes them back to contact custom fields.

This revision is the foundation: field contract, tenant store, GoHighLevel client, idempotency, and health check. The M06 webhook and the M10 daily cron are the next changes on top of these modules. Nothing here calls GoHighLevel or provisions a Vercel project.

## Layout

- `api/health.ts` — liveness check.
- `src/schema/fields.ts` — generated catalog of the RX Test Lab custom fields, keyed for runtime lookup. Test-lab ids are fixtures only.
- `src/tenants/` — `TenantStore`. `TENANT_STORE=neon` uses Neon Postgres. `TENANT_STORE=env` loads one tenant from the environment for the test phase. API keys are AES-256-GCM ciphertext. Tests use the in-memory store.
- `src/ghl/` — HTTP client. Timeout, retry with backoff on 429 and 5xx, per-location spacing, order pages via `offset`, contact search via `searchAfter`.
- `src/idempotency/` — `SET NX` with TTL. Upstash Redis when configured, memory otherwise.
- `src/time/business-date.ts` — tenant-timezone calendar dates.
- `migrations/001_tenants.sql` — Neon schema.
- `fixtures/test-lab-fields.json` — final custom-field snapshot for location `ekxOqjUKW7M6OV9XAVnx`.

Planned handlers, built on this foundation:

- `api/webhooks/ghl.ts` — M06. Accepts only `locationId` and `contactId`, returns 202, ignores every other payload value.
- `api/cron/m10.ts` — daily win-back pass, authorized with `Authorization: Bearer $CRON_SECRET`.

## Environment

Copy `.env.example` to `.env.local`. Values are names only; do not commit secrets.

| Name | Required | Purpose |
| --- | --- | --- |
| `TENANT_STORE` | no | `neon` (default) or `env`. Selects where tenant records are loaded from. |
| `DATABASE_URL` | when `TENANT_STORE=neon` | Neon Postgres connection string |
| `TENANT_ENCRYPTION_KEY` | yes | 32-byte key, base64 or 64-char hex, for tenant API keys |
| `TENANT_CONFIG` | `env` store, one of two forms | JSON object for the single test-phase tenant. When set, discrete `TENANT_*` fields below are ignored. |
| `TENANT_LOCATION_ID` | `env` store, if `TENANT_CONFIG` is unset | Location id of the single tenant |
| `TENANT_NAME` | no | Display name. Defaults to the location id. |
| `TENANT_API_KEY` | `env` store, one key form | Plaintext GoHighLevel token. Encrypted in memory with `TENANT_ENCRYPTION_KEY`. Do not set this together with `TENANT_API_KEY_ENCRYPTED`. |
| `TENANT_API_KEY_ENCRYPTED` | `env` store, the other key form | `v1:` ciphertext from `scripts/encrypt-api-key.mjs`. |
| `TENANT_TIMEZONE` | no | IANA timezone. Defaults to `UTC`. |
| `TENANT_CURRENCY` | no | Defaults to `USD`. Stored only; amounts are not rescaled. |
| `TENANT_M10_WORKFLOW_ID` | no | Workflow id used when M10 enrollment is enabled. |
| `TENANT_ACTIVE` | no | `false` or `0` disables the tenant. Defaults to active. |
| `TENANT_WEBHOOK_TOKEN_HASH` | production webhook | SHA-256 hex of this tenant's webhook query token. Also accepted as `webhookTokenHash` inside `TENANT_CONFIG`. |
| `UPSTASH_REDIS_REST_URL` | required when `VERCEL_ENV=production` | Upstash Redis REST URL. Production fails closed if this is unset. |
| `UPSTASH_REDIS_REST_TOKEN` | required when `VERCEL_ENV=production` | Upstash Redis REST token. |
| `CRON_SECRET` | yes, for the cron | Bearer token Vercel Cron sends |
| `GHL_API_BASE_URL` | no | Defaults to `https://services.leadconnectorhq.com`. Version header is `2021-07-28`. |
| `M10_ENROLL_ENABLED` | no | `true` enrolls newly eligible contacts into `m10_workflow_id`. Default off. |

Logs are JSON on stdout. The logger redacts `apiKey`, `authorization`, `token`, `secret`, bearer strings, and every query string. Do not log tenant API keys or webhook tokens.

## Add a tenant

`TENANT_STORE` selects the backend. `neon` is the multi-tenant store. `env` is a single-tenant store for the test phase and does not need `DATABASE_URL`. Both decrypt the API key only in memory for the GoHighLevel call. Unknown or inactive locations do no work.

### Neon (`TENANT_STORE=neon`)

1. Apply `migrations/001_tenants.sql` and `migrations/002_webhook_token.sql` to the Neon database.
2. Encrypt the location's GoHighLevel private-integration token. The token is read from stdin and is not passed as an argument:

```bash
export TENANT_ENCRYPTION_KEY="base64-32-byte-key"
printf '%s' "$GHL_TOKEN" | node scripts/encrypt-api-key.mjs
```

3. Insert the ciphertext. `timezone` is an IANA name used for calendar-day math. `currency` is stored for the tenant and is not used to rescale order amounts. `m10_workflow_id` is optional until enrollment is turned on.

```sql
INSERT INTO tenants (
  location_id, name, api_key_encrypted, timezone, currency, m10_workflow_id, webhook_token_hash, active
) VALUES (
  'LOCATION_ID',
  'Restaurant name',
  'v1:...',
  'Africa/Cairo',
  'EGP',
  NULL,
  'sha256-hex',
  TRUE
);
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

`apiKey` and `apiKeyEncrypted` are mutually exclusive. A plaintext `apiKey` is encrypted with `TENANT_ENCRYPTION_KEY` before the rest of the service sees it.

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

`metrics_hash` is a sha256 of the written values. `m06_intelligence_updated_at` is excluded from that hash so an unchanged metric set can skip the contact update entirely.

M10 writes only `winback_eligibility` and `winback_tier`.

The workflow owns `winback_cycle_status` and `winback_cycle_started_at`. This service reads `winback_cycle_status` and never writes either field.

## Idempotency keys

| Key | TTL | Meaning |
| --- | --- | --- |
| `evt:{locationId}:{contactId}:{eventId-or-derived}` | 300s | One webhook computation per event |
| `lock:{locationId}:{contactId}` | 30s | One in-flight computation per contact |
| `m10:{locationId}:{YYYY-MM-DD}` | through the tenant's calendar day | One daily cron pass per location |

`YYYY-MM-DD` is the date in the tenant timezone.

## GoHighLevel client

Orders: `GET /payments/orders` with `locationId`, `altId`, `altType=location`, `contactId`, `limit`, and `offset`. Pages continue until `totalCount` is covered. The client does not issue one `limit=500` request. A page cap throws instead of writing metrics from a partial history.

Contacts for the cron: `POST /contacts/search` with `pageLimit` and `searchAfter`.

Custom fields: `PUT /contacts/{contactId}` sends `{ id, key, field_value }` for the fields being changed.

Per-location spacing defaults to 100ms between requests on a warm instance. It is process-local. Idempotent reads retry HTTP 429, HTTP 5xx, and network failures with exponential backoff and jitter, capped at 20 seconds. `Retry-After` is honored up to 60 seconds. Workflow enrollment `POST` is not retried.

## Checks

```bash
npm install
npm test
npm run typecheck
npm run lint
```

Node.js 22 or newer. Tests use mocked `fetch`, in-memory stores, and the test-lab fixture. They do not call GoHighLevel, Neon, or Upstash.
