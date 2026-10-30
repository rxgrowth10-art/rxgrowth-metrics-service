# Graph Report - rxgrowth-metrics-service  (2026-10-30)

## Corpus Check
- 133 files · ~57,478 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 2 file(s) not represented in the graph (top: .example 1, (none) 1)

## Summary
- 859 nodes · 2458 edges · 36 communities (34 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 45 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `76534448`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- channels.ts
- Order Summary Cache
- Webhook Ingress
- M10 Tenant Fan-Out
- package.json
- Service Overview
- parse.ts
- devDependencies
- idempotency/index.ts
- Order Reconcile Cron
- m10.test.ts
- computeM06
- parse.ts
- migrate.mjs
- scripts
- CI Workflow
- Field Catalog Generator
- TypeScript Config
- ESM TypeScript Config
- Vercel Runtime Config
- value.ts
- order-summary-cache.ts
- categories.test.ts
- esm-entrypoints.test.ts
- compute.ts
- metrics/index.ts
- TypeScript Module Resolver
- location.test.ts
- business-date.ts
- recompute.ts
- schema/fields.ts
- format.ts
- value-read.test.ts
- OrderSummaryCache
- GhlOrder
- reconcile.test.ts

## God Nodes (most connected - your core abstractions)
1. `computeM06()` - 49 edges
2. `vitest` - 40 edges
3. `GhlClient` - 33 edges
4. `log()` - 31 edges
5. `order()` - 26 edges
6. `fieldByKey()` - 25 edges
7. `IdempotencyStore` - 24 edges
8. `MemoryIdempotencyStore` - 21 edges
9. `GhlOrder` - 20 edges
10. `formatM06Values()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `contactClient()` --calls--> `fieldByKey()`  [EXTRACTED]
  tests/ghl/collections.test.ts → src/schema/fields.ts
- `summaryClient()` --calls--> `fieldByKey()`  [EXTRACTED]
  tests/ghl/order-summary.test.ts → src/schema/fields.ts
- `listCustomFields()` --calls--> `fieldByKey()`  [EXTRACTED]
  tests/writeback/field-cache.test.ts → src/schema/fields.ts
- `tenant()` --calls--> `encryptApiKey()`  [EXTRACTED]
  tests/cron/m10.test.ts → src/tenants/crypto.ts
- `run()` --calls--> `json()`  [EXTRACTED]
  api/cron/m10-tenant.ts → src/http/json.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **M06 Webhook Recompute Flow** — readme_m06_webhook, readme_webhook_auth, readme_contact_lock, readme_qualifying_order_rule, readme_ghl_http_client, readme_metrics_hash, readme_m06_fields [EXTRACTED 1.00]
- **Daily M10 Tenant Hop** — readme_m10_dispatcher, readme_m10_tenant_hop, readme_m06_daily_reconcile, readme_m06_full_reconcile, readme_m10_eligibility, readme_m10_enrollment, readme_vercel_cron, readme_vercel_functions [EXTRACTED 1.00]
- **Tenant Secret Handling** — readme_tenant_store, readme_aes_256_gcm, readme_webhook_auth, readme_log_redaction, readme_tenant_upsert [INFERRED 0.85]

## Communities (36 total, 2 thin omitted)

### Community 0 - "channels.ts"
Cohesion: 0.16
Nodes (24): CategoryRanking, namesForLine(), rankCategories(), ChannelRanking, CHECKOUT_METHOD, checkoutKey(), classifyOrderSource(), DELIVERY_TOKENS (+16 more)

### Community 1 - "Order Summary Cache"
Cohesion: 0.14
Nodes (21): asStoredIds(), asStoredNumber(), asStoredRecord(), asStoredString(), ORDER_SUMMARY_MGET_CHUNK, ORDER_SUMMARY_TTL_SECONDS, orderBackfillKey(), orderSummaryKey() (+13 more)

### Community 2 - "Webhook Ingress"
Cohesion: 0.13
Nodes (29): GET(), DELETE(), GET(), HEAD(), OPTIONS(), PATCH(), POST(), PUT() (+21 more)

### Community 3 - "M10 Tenant Fan-Out"
Cohesion: 0.05
Nodes (46): GET(), POST(), postTenant(), run(), GET(), POST(), run(), scheduleTenantContinuation() (+38 more)

### Community 4 - "package.json"
Cohesion: 0.15
Nodes (14): dependencies, @upstash/redis@^1.35.6, @vercel/functions@^3.10.3, description, engines, node, name, overrides (+6 more)

### Community 5 - "Service Overview"
Cohesion: 0.13
Nodes (33): AES-256-GCM API Key Encryption, Tenant Timezone Calendar Dates, Cron Bearer Secret, API Key Encrypt Script, Environment Tenant Store, Field Catalog Generator, GoHighLevel HTTP Client, GoHighLevel (+25 more)

### Community 6 - "parse.ts"
Cohesion: 0.05
Nodes (56): backoff(), buildUrl(), COLLECTIONS_PAGE_LIMIT, CONTACT_PAGE_SIZE, requestJson(), GHL_API_BASE_URL, GHL_API_VERSION, GhlClientOptions (+48 more)

### Community 7 - "devDependencies"
Cohesion: 0.17
Nodes (12): devDependencies, eslint@^9.39.0, @eslint/js@^9.39.0, @types/node@^22.19.0, typescript@^5.9.3, typescript-eslint@^8.46.0, vitest@^5.0.5, eslint (+4 more)

### Community 8 - "idempotency/index.ts"
Cohesion: 0.11
Nodes (9): createIdempotencyStore(), Entry, MemoryIdempotencyStore, IdempotencyStore, createUpstashIdempotency(), createUpstashIdempotencyFromEnv(), redisRestCredentials(), RedisSetNx (+1 more)

### Community 9 - "Order Reconcile Cron"
Cohesion: 0.16
Nodes (19): boundedSeen(), DEFAULT_FULL_RECONCILE_WEEKDAY, DEFAULT_RECONCILE_HOURS, FULL_RECONCILE_PAGE_CAP, fullReconcileKey(), isFullReconcileDay(), MAX_CURSOR_SEEN, MAX_RECONCILE_PAGES (+11 more)

### Community 10 - "m10.test.ts"
Cohesion: 0.06
Nodes (46): cipher, ciphertext, iv, key, payload, plaintext, tag, hash (+38 more)

### Community 11 - "computeM06"
Cohesion: 0.18
Nodes (13): vitest, computeM06(), frequencyBucket(), order(), NOW, consistency(), NOW, cancelled (+5 more)

### Community 12 - "parse.ts"
Cohesion: 0.11
Nodes (40): createGhlClient(), searchContacts(), searchContactsPage(), asFieldValue(), asRecord(), asString(), asText(), asTimestamp() (+32 more)

### Community 13 - "migrate.mjs"
Cohesion: 0.29
Nodes (7): @neondatabase/serverless@^1.0.2, @neondatabase/serverless, applyMigrations(), main(), redact(), main(), redact()

### Community 14 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, check, db:migrate, db:upsert-tenant, generate:fields, lint, test, typecheck

### Community 15 - "CI Workflow"
Cohesion: 0.11
Nodes (17): runs-on, steps, strategy, jobs, check, node-version, name, on (+9 more)

### Community 16 - "Field Catalog Generator"
Cohesion: 0.13
Nodes (13): fields, fixturePath, HASH_EXCLUDED_KEYS, locationIds, M06_WRITTEN_KEYS, M10_WRITTEN_KEYS, outPath, raw (+5 more)

### Community 17 - "TypeScript Config"
Cohesion: 0.13
Nodes (14): compilerOptions, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution, noEmit, noUncheckedIndexedAccess (+6 more)

### Community 18 - "ESM TypeScript Config"
Cohesion: 0.15
Nodes (12): ./tsconfig.json, compilerOptions, declaration, declarationMap, incremental, noEmit, outDir, rootDir (+4 more)

### Community 19 - "Vercel Runtime Config"
Cohesion: 0.15
Nodes (12): maxDuration, maxDuration, maxDuration, maxDuration, crons, fluid, functions, api/cron/m10-tenant.ts (+4 more)

### Community 20 - "value.ts"
Cohesion: 0.13
Nodes (32): loadValueDistribution(), numberArray(), parseValueBuild(), publishValueDistribution(), ValueBuild, valueDistributionKey(), valueSampleFromContact(), ascending() (+24 more)

### Community 21 - "order-summary-cache.ts"
Cohesion: 0.12
Nodes (6): createOrderSummaryCache(), createRedisClient(), createUpstashOrderSummaryCache(), Entry, MemoryOrderSummaryCache, OrderSummaryRedis

### Community 22 - "categories.test.ts"
Cohesion: 0.14
Nodes (14): CustomFieldWrite, fieldByKey(), metricsHash(), hashOrders(), clientWith(), fieldCatalog(), NAMES, NOW (+6 more)

### Community 24 - "compute.ts"
Cohesion: 0.14
Nodes (21): businessDay(), compareOrderTime(), ComputeM06Options, emptyWindows(), windowCounts(), Windows, purchaseConsistencyLabel(), trailing12MonthOrderCount() (+13 more)

### Community 25 - "metrics/index.ts"
Cohesion: 0.21
Nodes (16): averageIntervalDays(), typicalIntervalDays(), summarizeValue(), ValueSummary, recencyBucket(), mean(), median(), round2() (+8 more)

### Community 26 - "TypeScript Module Resolver"
Cohesion: 0.83
Nodes (3): isModuleNotFound(), isRelativeJs(), resolve()

### Community 27 - "location.test.ts"
Cohesion: 0.19
Nodes (12): applyLatestOrderDetail(), latestFirst(), MAX_LATEST_ORDER_DETAIL_CALLS, parseOrderResource(), isQualifyingOrder(), fixture(), listed(), NOW (+4 more)

### Community 28 - "business-date.ts"
Cohesion: 0.27
Nodes (14): decisionFromContact(), addCalendarDays(), calendarDayDifference(), epochMilliseconds(), instantFromEpoch(), isIsoDate(), isoDateTimeUtcDay(), isoDateToUtc() (+6 more)

### Community 29 - "recompute.ts"
Cohesion: 0.21
Nodes (14): drainOrderBackfill(), hydrateOrders(), mergeOrder(), ORDER_DETAIL_CONCURRENCY, orderNeedsDetail(), runWithConcurrency(), WEBHOOK_DETAIL_FETCH_LIMIT, collectCollectionIds() (+6 more)

### Community 30 - "schema/fields.ts"
Cohesion: 0.21
Nodes (12): FIELD_INDEX, FieldDefinition, FIELDS, FieldWriter, M06_HASH_EXCLUDED_KEYS, M06_WRITTEN_KEYS, M10_WRITTEN_KEYS, REMOVED_FIELD_KEYS (+4 more)

### Community 31 - "format.ts"
Cohesion: 0.23
Nodes (9): OrderLine, CHECKOUT_METHOD, coerceLastOrderType(), decimal(), formatM06Values(), integer(), picklist(), text() (+1 more)

### Community 33 - "OrderSummaryCache"
Cohesion: 0.22
Nodes (4): M10Deps, OrderSummaryCache, AppDeps, OrderSummaryPass

### Community 34 - "GhlOrder"
Cohesion: 0.33
Nodes (8): ParsedOrderPage, ResolveOrderSummariesResult, GhlOrder, contactOrderSummaries(), ContactOrderView, viewContactOrders(), OrderDetailSummary, M06RecomputeResult

### Community 35 - "reconcile.test.ts"
Cohesion: 0.32
Nodes (5): harness(), KEY, NOW, run(), tenant()

## Knowledge Gaps
- **3 isolated node(s):** `./tsconfig.json`, `Health Check`, `Webhook Token Script`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 241 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `computeM06` to `value-read.test.ts`, `Order Summary Cache`, `Webhook Ingress`, `M10 Tenant Fan-Out`, `package.json`, `reconcile.test.ts`, `parse.ts`, `devDependencies`, `idempotency/index.ts`, `m10.test.ts`, `value.ts`, `categories.test.ts`, `esm-entrypoints.test.ts`, `location.test.ts`, `business-date.ts`, `schema/fields.ts`, `format.ts`?**
  _High betweenness centrality (0.117) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `computeM06()` (e.g. with `compareOrderTime()` and `isQualifyingOrder()`) actually correct?**
  _`computeM06()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `./tsconfig.json`, `Health Check`, `Webhook Token Script` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Order Summary Cache` be split into smaller, more focused modules?**
  _Cohesion score 0.135632183908046 - nodes in this community are weakly interconnected._
- **Why does `GhlClient` connect `parse.ts` to `value-read.test.ts`, `OrderSummaryCache`, `Webhook Ingress`, `M10 Tenant Fan-Out`, `reconcile.test.ts`, `Order Summary Cache`, `Order Reconcile Cron`, `m10.test.ts`, `categories.test.ts`, `recompute.ts`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Should `Webhook Ingress` be split into smaller, more focused modules?**
  _Cohesion score 0.12762762762762764 - nodes in this community are weakly interconnected._
- **Why does `computeM06()` connect `computeM06` to `channels.ts`, `Order Summary Cache`, `reconcile.test.ts`, `parse.ts`, `parse.ts`, `value.ts`, `categories.test.ts`, `compute.ts`, `metrics/index.ts`, `location.test.ts`, `business-date.ts`, `recompute.ts`, `format.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._