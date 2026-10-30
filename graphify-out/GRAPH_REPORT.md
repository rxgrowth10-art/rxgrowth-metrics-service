# Graph Report - rxgrowth-metrics-service  (2026-10-30)

## Corpus Check
- 133 files · ~57,856 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 2 file(s) not represented in the graph (top: .example 1, (none) 1)

## Summary
- 862 nodes · 2464 edges · 44 communities (40 shown, 4 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 45 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9984ad2f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- metrics/index.ts
- Order Summary Cache
- ghl.test.ts
- src/cron/m10.ts
- package.json
- Service Overview
- parse.ts
- devDependencies
- idempotency/index.ts
- Order Reconcile Cron
- encryptApiKey
- computeM06
- m10.test.ts
- migrate.mjs
- scripts
- CI Workflow
- Field Catalog Generator
- TypeScript Config
- ESM TypeScript Config
- Vercel Runtime Config
- value.ts
- MemoryOrderSummaryCache
- categories.test.ts
- tenants/index.ts
- log
- order-summary.test.ts
- TypeScript Module Resolver
- list-orders-sample.test.ts
- json
- recompute.ts
- schema/fields.ts
- format.ts
- value-read.test.ts
- OrderSummaryCache
- GhlOrder
- reconcile.test.ts
- deps.ts
- IdempotencyStore
- env.ts
- encrypt-api-key.mjs
- MemoryIdempotencyStore
- collections.ts
- webhook-token.ts
- OrderSummaryRedis

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
- `loadOrder()` --calls--> `parseOrderPage()`  [EXTRACTED]
  tests/metrics/excluded-orders.test.ts → src/ghl/parse.ts
- `run()` --calls--> `handleM10Tenant()`  [EXTRACTED]
  api/cron/m10-tenant.ts → src/cron/m10.ts
- `run()` --calls--> `log()`  [EXTRACTED]
  api/cron/m10-tenant.ts → src/log/logger.ts
- `run()` --calls--> `createDefaultDeps()`  [EXTRACTED]
  api/cron/m10-tenant.ts → src/runtime/deps.ts
- `run()` --calls--> `json()`  [EXTRACTED]
  api/cron/m10.ts → src/http/json.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **M06 Webhook Recompute Flow** — readme_m06_webhook, readme_webhook_auth, readme_contact_lock, readme_qualifying_order_rule, readme_ghl_http_client, readme_metrics_hash, readme_m06_fields [EXTRACTED 1.00]
- **Daily M10 Tenant Hop** — readme_m10_dispatcher, readme_m10_tenant_hop, readme_m06_daily_reconcile, readme_m06_full_reconcile, readme_m10_eligibility, readme_m10_enrollment, readme_vercel_cron, readme_vercel_functions [EXTRACTED 1.00]
- **Tenant Secret Handling** — readme_tenant_store, readme_aes_256_gcm, readme_webhook_auth, readme_log_redaction, readme_tenant_upsert [INFERRED 0.85]

## Communities (44 total, 4 thin omitted)

### Community 0 - "metrics/index.ts"
Cohesion: 0.06
Nodes (80): CategoryRanking, namesForLine(), rankCategories(), ChannelRanking, CHECKOUT_METHOD, checkoutKey(), classifyOrderSource(), DELIVERY_TOKENS (+72 more)

### Community 1 - "Order Summary Cache"
Cohesion: 0.23
Nodes (16): asStoredIds(), asStoredNumber(), asStoredRecord(), asStoredString(), ORDER_SUMMARY_MGET_CHUNK, ORDER_SUMMARY_TTL_SECONDS, orderSummaryKey(), parseStoredItems() (+8 more)

### Community 2 - "ghl.test.ts"
Cohesion: 0.28
Nodes (14): DELETE(), GET(), HEAD(), OPTIONS(), PATCH(), POST(), PUT(), handleGhlWebhook() (+6 more)

### Community 3 - "src/cron/m10.ts"
Cohesion: 0.06
Nodes (56): clearValueBuild(), numberArray(), parseValueBuild(), publishValueDistribution(), readValueBuild(), ValueBuild, valueDistributionBuildKey(), valueDistributionKey() (+48 more)

### Community 4 - "package.json"
Cohesion: 0.15
Nodes (14): dependencies, @upstash/redis@^1.35.6, @vercel/functions@^3.10.3, description, engines, node, name, overrides (+6 more)

### Community 5 - "Service Overview"
Cohesion: 0.13
Nodes (33): AES-256-GCM API Key Encryption, Tenant Timezone Calendar Dates, Cron Bearer Secret, API Key Encrypt Script, Environment Tenant Store, Field Catalog Generator, GoHighLevel HTTP Client, GoHighLevel (+25 more)

### Community 6 - "parse.ts"
Cohesion: 0.06
Nodes (69): backoff(), buildUrl(), COLLECTIONS_PAGE_LIMIT, CONTACT_PAGE_SIZE, createGhlClient(), requestJson(), searchContacts(), searchContactsPage() (+61 more)

### Community 7 - "devDependencies"
Cohesion: 0.17
Nodes (12): devDependencies, eslint@^9.39.0, @eslint/js@^9.39.0, @types/node@^22.19.0, typescript@^5.9.3, typescript-eslint@^8.46.0, vitest@^5.0.5, eslint (+4 more)

### Community 8 - "idempotency/index.ts"
Cohesion: 0.24
Nodes (6): createIdempotencyStore(), Entry, createUpstashIdempotency(), createUpstashIdempotencyFromEnv(), redisRestCredentials(), RedisSetNx

### Community 9 - "Order Reconcile Cron"
Cohesion: 0.16
Nodes (20): boundedSeen(), DEFAULT_FULL_RECONCILE_WEEKDAY, DEFAULT_RECONCILE_HOURS, drainOrderBackfill(), FULL_RECONCILE_PAGE_CAP, fullReconcileKey(), isFullReconcileDay(), MAX_CURSOR_SEEN (+12 more)

### Community 10 - "encryptApiKey"
Cohesion: 0.13
Nodes (16): hash, token, statementsFromSql(), parseActive(), TENANT_UPSERT_SQL, tenantUpsertPlan, decryptApiKey(), encryptApiKey() (+8 more)

### Community 11 - "computeM06"
Cohesion: 0.15
Nodes (13): vitest, listed(), NOW, order(), consistency(), NOW, cancelled, loadOrder() (+5 more)

### Community 12 - "m10.test.ts"
Cohesion: 0.10
Nodes (4): VALUE_DISTRIBUTION_BUILD_TTL_SECONDS, harness(), KEY, NOW

### Community 13 - "migrate.mjs"
Cohesion: 0.22
Nodes (8): @neondatabase/serverless@^1.0.2, @neondatabase/serverless, jsFiles(), applyMigrations(), main(), redact(), main(), redact()

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
Cohesion: 0.15
Nodes (25): ascending(), buildValueDistribution(), CONSISTENCY_SCORE, CONSISTENCY_WEIGHT, consistencyScore(), countAtMost(), customerValueScore(), EMERGING_VIP_MIN_SCORE (+17 more)

### Community 22 - "categories.test.ts"
Cohesion: 0.13
Nodes (14): M06_VALUE_FIELD_KEYS, fieldByKey(), contactClient(), summaryClient(), clientWith(), fieldCatalog(), NAMES, NOW (+6 more)

### Community 23 - "tenants/index.ts"
Cohesion: 0.20
Nodes (9): M10Deps, cloneTenant(), MemoryTenantStore, asString(), mapTenantRow(), Tenant, TenantStore, WebhookDeps (+1 more)

### Community 24 - "log"
Cohesion: 0.29
Nodes (11): GET(), POST(), postTenant(), run(), handleM10Cron(), M10Summary, contactLogRef(), log() (+3 more)

### Community 25 - "order-summary.test.ts"
Cohesion: 0.16
Nodes (6): EXCLUDED, metricsHash(), M06_DETAIL_FIELD_KEYS, FIXTURE_HASHES, hashOrders(), NOW

### Community 26 - "TypeScript Module Resolver"
Cohesion: 0.83
Nodes (3): isModuleNotFound(), isRelativeJs(), resolve()

### Community 27 - "list-orders-sample.test.ts"
Cohesion: 0.39
Nodes (6): hydrateOrders(), mergeOrder(), ORDER_DETAIL_CONCURRENCY, orderNeedsDetail(), runWithConcurrency(), sample

### Community 28 - "json"
Cohesion: 0.28
Nodes (7): GET(), POST(), run(), GET(), scheduleTenantContinuation(), json(), { waitUntil }

### Community 29 - "recompute.ts"
Cohesion: 0.16
Nodes (21): loadValueDistribution(), applyLatestOrderDetail(), latestFirst(), MAX_LATEST_ORDER_DETAIL_CALLS, WEBHOOK_DETAIL_FETCH_LIMIT, ALPHANUMERIC_ID, collectCollectionIds(), isQualifyingOrder() (+13 more)

### Community 30 - "schema/fields.ts"
Cohesion: 0.24
Nodes (11): FIELD_INDEX, FieldDefinition, FIELDS, FieldWriter, M06_HASH_EXCLUDED_KEYS, M06_WRITTEN_KEYS, M10_WRITTEN_KEYS, REMOVED_FIELD_KEYS (+3 more)

### Community 31 - "format.ts"
Cohesion: 0.29
Nodes (8): CHECKOUT_METHOD, coerceLastOrderType(), decimal(), formatM06Values(), integer(), picklist(), text(), NOW

### Community 33 - "OrderSummaryCache"
Cohesion: 0.25
Nodes (3): OrderSummaryCache, AppDeps, OrderSummaryPass

### Community 34 - "GhlOrder"
Cohesion: 0.27
Nodes (7): ParsedOrderPage, ResolveOrderSummariesResult, GhlOrder, OrderDetailSummary, OrderLine, M06RecomputeResult, NOW

### Community 35 - "reconcile.test.ts"
Cohesion: 0.32
Nodes (5): harness(), KEY, NOW, run(), tenant()

### Community 36 - "deps.ts"
Cohesion: 0.31
Nodes (11): readFullReconcileWeekday(), readReconcileHours(), readReconcileMaxPages(), createOrderSummaryCache(), createRedisClient(), createUpstashOrderSummaryCache(), Entry, createDefaultDeps() (+3 more)

### Community 37 - "IdempotencyStore"
Cohesion: 0.25
Nodes (3): readReconcileCursor(), IdempotencyStore, CountingStore

### Community 38 - "env.ts"
Cohesion: 0.45
Nodes (10): assertAlphanumericId(), createEnvTenantStore(), optionalText(), parseActive(), parseTenantConfig(), readTenantInput(), requiredText(), TenantInput (+2 more)

### Community 39 - "encrypt-api-key.mjs"
Cohesion: 0.22
Nodes (7): cipher, ciphertext, iv, key, payload, plaintext, tag

### Community 41 - "collections.ts"
Cohesion: 0.43
Nodes (6): CollectionNames, COLLECTIONS_TTL_SECONDS, collectionsCacheKey(), loadCollectionNames(), readCache(), uniqueIds()

### Community 42 - "webhook-token.ts"
Cohesion: 0.52
Nodes (5): DUMMY_WEBHOOK_HASH, hashWebhookToken(), readWebhookToken(), webhookTokenMatches(), authorized()

## Knowledge Gaps
- **3 isolated node(s):** `./tsconfig.json`, `Health Check`, `Webhook Token Script`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 242 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `computeM06` to `metrics/index.ts`, `ghl.test.ts`, `src/cron/m10.ts`, `package.json`, `parse.ts`, `devDependencies`, `idempotency/index.ts`, `encryptApiKey`, `m10.test.ts`, `value.ts`, `categories.test.ts`, `tenants/index.ts`, `log`, `order-summary.test.ts`, `list-orders-sample.test.ts`, `json`, `schema/fields.ts`, `format.ts`, `value-read.test.ts`, `GhlOrder`, `reconcile.test.ts`, `webhook-token.ts`?**
  _High betweenness centrality (0.117) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `computeM06()` (e.g. with `compareOrderTime()` and `isQualifyingOrder()`) actually correct?**
  _`computeM06()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `./tsconfig.json`, `Health Check`, `Webhook Token Script` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `metrics/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06301161241195508 - nodes in this community are weakly interconnected._
- **Why does `GhlClient` connect `src/cron/m10.ts` to `value-read.test.ts`, `OrderSummaryCache`, `ghl.test.ts`, `reconcile.test.ts`, `deps.ts`, `parse.ts`, `Order Reconcile Cron`, `collections.ts`, `m10.test.ts`, `categories.test.ts`, `tenants/index.ts`, `order-summary.test.ts`, `recompute.ts`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Should `src/cron/m10.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06385964912280702 - nodes in this community are weakly interconnected._
- **Why does `computeM06()` connect `metrics/index.ts` to `GhlOrder`, `reconcile.test.ts`, `src/cron/m10.ts`, `computeM06`, `value.ts`, `categories.test.ts`, `order-summary.test.ts`, `list-orders-sample.test.ts`, `recompute.ts`, `format.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._