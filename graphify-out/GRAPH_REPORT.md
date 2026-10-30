# Graph Report - rxgrowth-metrics-service  (2026-10-30)

## Corpus Check
- 139 files · ~60,982 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 2 file(s) not represented in the graph (top: .example 1, (none) 1)

## Summary
- 898 nodes · 2564 edges · 40 communities (38 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `339a8674`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- metrics/index.ts
- order-summary.test.ts
- ghl.test.ts
- src/cron/m10.ts
- package.json
- Service Overview
- m06.ts
- devDependencies
- idempotency/index.ts
- Order Reconcile Cron
- encryptApiKey
- reconcile.test.ts
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
- profile.ts
- tenants/index.ts
- log
- parse.ts
- TypeScript Module Resolver
- distribution.ts
- json
- recompute.ts
- json
- handleM10Tenant
- value-read.test.ts
- OrderSummaryCache
- deps.ts
- IdempotencyStore
- env.ts
- encrypt-api-key.mjs
- MemoryIdempotencyStore
- recompute.ts

## God Nodes (most connected - your core abstractions)
1. `computeM06()` - 49 edges
2. `vitest` - 43 edges
3. `GhlClient` - 33 edges
4. `log()` - 31 edges
5. `fieldByKey()` - 28 edges
6. `order()` - 26 edges
7. `IdempotencyStore` - 24 edges
8. `MemoryIdempotencyStore` - 21 edges
9. `GhlOrder` - 20 edges
10. `formatM06Values()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `summaryClient()` --calls--> `fieldByKey()`  [EXTRACTED]
  tests/ghl/order-summary.test.ts → src/schema/fields.ts
- `tenant()` --calls--> `encryptApiKey()`  [EXTRACTED]
  tests/cron/m10.test.ts → src/tenants/crypto.ts
- `tenant()` --calls--> `encryptApiKey()`  [EXTRACTED]
  tests/webhook/ghl.test.ts → src/tenants/crypto.ts
- `run()` --calls--> `handleM10Tenant()`  [EXTRACTED]
  api/cron/m10-tenant.ts → src/cron/m10.ts
- `run()` --calls--> `json()`  [EXTRACTED]
  api/cron/m10-tenant.ts → src/http/json.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **M06 Webhook Recompute Flow** — readme_m06_webhook, readme_webhook_auth, readme_contact_lock, readme_qualifying_order_rule, readme_ghl_http_client, readme_metrics_hash, readme_m06_fields [EXTRACTED 1.00]
- **Daily M10 Tenant Hop** — readme_m10_dispatcher, readme_m10_tenant_hop, readme_m06_daily_reconcile, readme_m06_full_reconcile, readme_m10_eligibility, readme_m10_enrollment, readme_vercel_cron, readme_vercel_functions [EXTRACTED 1.00]
- **Tenant Secret Handling** — readme_tenant_store, readme_aes_256_gcm, readme_webhook_auth, readme_log_redaction, readme_tenant_upsert [INFERRED 0.85]

## Communities (40 total, 2 thin omitted)

### Community 0 - "metrics/index.ts"
Cohesion: 0.06
Nodes (83): applyLatestOrderDetail(), latestFirst(), CategoryRanking, collectCollectionIds(), namesForLine(), rankCategories(), ChannelRanking, CHECKOUT_METHOD (+75 more)

### Community 1 - "order-summary.test.ts"
Cohesion: 0.08
Nodes (32): hydrateOrders(), mergeOrder(), ORDER_DETAIL_CONCURRENCY, orderNeedsDetail(), runWithConcurrency(), asStoredIds(), asStoredNumber(), asStoredRecord() (+24 more)

### Community 2 - "ghl.test.ts"
Cohesion: 0.25
Nodes (15): DELETE(), GET(), HEAD(), OPTIONS(), PATCH(), POST(), PUT(), handleGhlWebhook() (+7 more)

### Community 3 - "src/cron/m10.ts"
Cohesion: 0.18
Nodes (24): valueSampleFromContact(), addSummary(), cursorKey(), decisionFromContact(), emptySummary(), enrollMarker(), fanOutTenants(), FRESH_METRIC_KEYS (+16 more)

### Community 4 - "package.json"
Cohesion: 0.15
Nodes (14): dependencies, @upstash/redis@^1.35.6, @vercel/functions@^3.10.3, description, engines, node, name, overrides (+6 more)

### Community 5 - "Service Overview"
Cohesion: 0.13
Nodes (33): AES-256-GCM API Key Encryption, Tenant Timezone Calendar Dates, Cron Bearer Secret, API Key Encrypt Script, Environment Tenant Store, Field Catalog Generator, GoHighLevel HTTP Client, GoHighLevel (+25 more)

### Community 6 - "m06.ts"
Cohesion: 0.06
Nodes (46): backoff(), buildUrl(), COLLECTIONS_PAGE_LIMIT, CONTACT_PAGE_SIZE, requestJson(), GHL_API_BASE_URL, GHL_API_VERSION, GhlClientOptions (+38 more)

### Community 7 - "devDependencies"
Cohesion: 0.17
Nodes (12): devDependencies, eslint@^9.39.0, @eslint/js@^9.39.0, @types/node@^22.19.0, typescript@^5.9.3, typescript-eslint@^8.46.0, vitest@^5.0.5, eslint (+4 more)

### Community 8 - "idempotency/index.ts"
Cohesion: 0.30
Nodes (5): createIdempotencyStore(), createUpstashIdempotency(), createUpstashIdempotencyFromEnv(), redisRestCredentials(), RedisSetNx

### Community 9 - "Order Reconcile Cron"
Cohesion: 0.15
Nodes (20): M10Summary, boundedSeen(), DEFAULT_FULL_RECONCILE_WEEKDAY, DEFAULT_RECONCILE_HOURS, drainOrderBackfill(), FULL_RECONCILE_PAGE_CAP, fullReconcileKey(), isFullReconcileDay() (+12 more)

### Community 10 - "encryptApiKey"
Cohesion: 0.15
Nodes (13): hash, token, statementsFromSql(), parseActive(), TENANT_UPSERT_SQL, tenantUpsertPlan, decryptApiKey(), encryptApiKey() (+5 more)

### Community 11 - "reconcile.test.ts"
Cohesion: 0.05
Nodes (57): vitest, MAX_LATEST_ORDER_DETAIL_CALLS, parseOrderResource(), OrderLine, FIELD_INDEX, fieldByKey(), FieldDefinition, FIELDS (+49 more)

### Community 12 - "m10.test.ts"
Cohesion: 0.10
Nodes (3): KEY, NOW, tenant()

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
Cohesion: 0.14
Nodes (26): ascending(), buildValueDistribution(), CONSISTENCY_SCORE, CONSISTENCY_WEIGHT, consistencyScore(), countAtMost(), customerValueScore(), EMERGING_VIP_MIN_SCORE (+18 more)

### Community 21 - "MemoryOrderSummaryCache"
Cohesion: 0.19
Nodes (5): createOrderSummaryCache(), createRedisClient(), createUpstashOrderSummaryCache(), Entry, MemoryOrderSummaryCache

### Community 22 - "profile.ts"
Cohesion: 0.10
Nodes (26): applyFresh(), count(), diversityCount(), fieldState(), GATED_KEYS, matches(), nightlyProfile, text() (+18 more)

### Community 23 - "tenants/index.ts"
Cohesion: 0.18
Nodes (10): AppDeps, cloneTenant(), MemoryTenantStore, asString(), mapTenantRow(), Tenant, TenantStore, WebhookDeps (+2 more)

### Community 24 - "log"
Cohesion: 0.57
Nodes (5): contactLogRef(), log(), LogLevel, redact(), redactString()

### Community 25 - "parse.ts"
Cohesion: 0.11
Nodes (40): createGhlClient(), searchContacts(), searchContactsPage(), asFieldValue(), asRecord(), asString(), asText(), asTimestamp() (+32 more)

### Community 26 - "TypeScript Module Resolver"
Cohesion: 0.83
Nodes (3): isModuleNotFound(), isRelativeJs(), resolve()

### Community 27 - "distribution.ts"
Cohesion: 0.24
Nodes (11): clearValueBuild(), numberArray(), parseValueBuild(), publishValueDistribution(), readValueBuild(), VALUE_DISTRIBUTION_BUILD_TTL_SECONDS, VALUE_DISTRIBUTION_TTL_SECONDS, ValueBuild (+3 more)

### Community 28 - "json"
Cohesion: 0.43
Nodes (5): GET(), POST(), run(), scheduleTenantContinuation(), { waitUntil }

### Community 29 - "recompute.ts"
Cohesion: 0.17
Nodes (16): WEBHOOK_DETAIL_FETCH_LIMIT, DUMMY_WEBHOOK_HASH, hashWebhookToken(), readWebhookToken(), webhookTokenMatches(), ALPHANUMERIC_ID, asRecord(), authorized() (+8 more)

### Community 30 - "json"
Cohesion: 0.36
Nodes (7): GET(), POST(), postTenant(), run(), GET(), handleM10Cron(), json()

### Community 31 - "handleM10Tenant"
Cohesion: 0.60
Nodes (4): handleM10Tenant(), bearerMatches(), headerMatches(), safeEqual()

### Community 33 - "OrderSummaryCache"
Cohesion: 0.25
Nodes (3): M10Deps, OrderSummaryCache, OrderSummaryPass

### Community 36 - "deps.ts"
Cohesion: 0.35
Nodes (9): readFullReconcileWeekday(), readReconcileHours(), readReconcileMaxPages(), createDefaultDeps(), createTenantStore(), emptyToNull(), createEnvTenantStore(), createNeonTenantStore() (+1 more)

### Community 37 - "IdempotencyStore"
Cohesion: 0.20
Nodes (4): readReconcileCursor(), Entry, IdempotencyStore, CountingStore

### Community 38 - "env.ts"
Cohesion: 0.49
Nodes (9): assertAlphanumericId(), optionalText(), parseActive(), parseTenantConfig(), readTenantInput(), requiredText(), TenantInput, toTenant() (+1 more)

### Community 39 - "encrypt-api-key.mjs"
Cohesion: 0.22
Nodes (7): cipher, ciphertext, iv, key, payload, plaintext, tag

### Community 41 - "recompute.ts"
Cohesion: 0.27
Nodes (12): loadValueDistribution(), CollectionNames, COLLECTIONS_TTL_SECONDS, collectionsCacheKey(), loadCollectionNames(), readCache(), uniqueIds(), contactLockKey() (+4 more)

## Knowledge Gaps
- **3 isolated node(s):** `./tsconfig.json`, `Health Check`, `Webhook Token Script`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 250 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `reconcile.test.ts` to `metrics/index.ts`, `order-summary.test.ts`, `ghl.test.ts`, `package.json`, `m06.ts`, `devDependencies`, `idempotency/index.ts`, `encryptApiKey`, `m10.test.ts`, `value.ts`, `profile.ts`, `tenants/index.ts`, `log`, `json`, `recompute.ts`, `json`, `handleM10Tenant`, `value-read.test.ts`, `deps.ts`, `recompute.ts`?**
  _High betweenness centrality (0.121) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `computeM06()` (e.g. with `compareOrderTime()` and `isQualifyingOrder()`) actually correct?**
  _`computeM06()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `./tsconfig.json`, `Health Check`, `Webhook Token Script` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `metrics/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.060483159936519135 - nodes in this community are weakly interconnected._
- **Why does `GhlClient` connect `m06.ts` to `value-read.test.ts`, `OrderSummaryCache`, `order-summary.test.ts`, `src/cron/m10.ts`, `deps.ts`, `ghl.test.ts`, `Order Reconcile Cron`, `recompute.ts`, `reconcile.test.ts`, `m10.test.ts`, `tenants/index.ts`, `recompute.ts`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Should `order-summary.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08156028368794327 - nodes in this community are weakly interconnected._
- **Why does `computeM06()` connect `metrics/index.ts` to `order-summary.test.ts`, `m06.ts`, `recompute.ts`, `reconcile.test.ts`, `value.ts`, `parse.ts`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._