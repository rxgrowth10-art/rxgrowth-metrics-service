# Graph Report - rxgrowth-metrics-service  (2026-10-30)

## Corpus Check
- 129 files · ~52,877 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 2 file(s) not represented in the graph (top: .example 1, (none) 1)

## Summary
- 790 nodes · 2228 edges · 26 communities (22 shown, 4 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7ddc4a5d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Customer Metrics Computation
- Order Summary Cache
- Webhook Ingress
- M10 Tenant Fan-Out
- package.json
- Service Overview
- parse.ts
- devDependencies
- Idempotency Store
- Order Reconcile Cron
- m10.test.ts
- reconcile.test.ts
- IdempotencyStore
- migrate.mjs
- scripts
- CI Workflow
- Field Catalog Generator
- TypeScript Config
- ESM TypeScript Config
- Vercel Runtime Config
- Runtime Dependency Wiring
- MemoryOrderSummaryCache
- MemoryIdempotencyStore
- esm-entrypoints.test.ts
- OrderSummaryRedis
- TypeScript Module Resolver

## God Nodes (most connected - your core abstractions)
1. `computeM06()` - 48 edges
2. `vitest` - 38 edges
3. `GhlClient` - 32 edges
4. `log()` - 27 edges
5. `order()` - 24 edges
6. `IdempotencyStore` - 23 edges
7. `fieldByKey()` - 23 edges
8. `GhlOrder` - 20 edges
9. `MemoryIdempotencyStore` - 20 edges
10. `formatM06Values()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `fixtureOrder()` --calls--> `parseOrderPage()`  [EXTRACTED]
  tests/cron/reconcile.test.ts → src/ghl/parse.ts
- `loadOrder()` --calls--> `parseOrderPage()`  [EXTRACTED]
  tests/metrics/excluded-orders.test.ts → src/ghl/parse.ts
- `fixture()` --calls--> `parseOrderResource()`  [EXTRACTED]
  tests/ghl/latest-order-type.test.ts → src/ghl/parse.ts
- `shippingFixture()` --calls--> `parseOrderResource()`  [EXTRACTED]
  tests/metrics/location.test.ts → src/ghl/parse.ts
- `summaryClient()` --calls--> `fieldByKey()`  [EXTRACTED]
  tests/ghl/order-summary.test.ts → src/schema/fields.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **M06 Webhook Recompute Flow** — readme_m06_webhook, readme_webhook_auth, readme_contact_lock, readme_qualifying_order_rule, readme_ghl_http_client, readme_metrics_hash, readme_m06_fields [EXTRACTED 1.00]
- **Daily M10 Tenant Hop** — readme_m10_dispatcher, readme_m10_tenant_hop, readme_m06_daily_reconcile, readme_m06_full_reconcile, readme_m10_eligibility, readme_m10_enrollment, readme_vercel_cron, readme_vercel_functions [EXTRACTED 1.00]
- **Tenant Secret Handling** — readme_tenant_store, readme_aes_256_gcm, readme_webhook_auth, readme_log_redaction, readme_tenant_upsert [INFERRED 0.85]

## Communities (26 total, 4 thin omitted)

### Community 0 - "Customer Metrics Computation"
Cohesion: 0.06
Nodes (83): decisionFromContact(), CategoryRanking, collectCollectionIds(), namesForLine(), rankCategories(), ChannelRanking, CHECKOUT_METHOD, checkoutKey() (+75 more)

### Community 1 - "Order Summary Cache"
Cohesion: 0.10
Nodes (32): hydrateOrders(), mergeOrder(), ORDER_DETAIL_CONCURRENCY, orderNeedsDetail(), runWithConcurrency(), asStoredIds(), asStoredNumber(), asStoredRecord() (+24 more)

### Community 2 - "Webhook Ingress"
Cohesion: 0.09
Nodes (38): GET(), DELETE(), GET(), HEAD(), OPTIONS(), PATCH(), POST(), PUT() (+30 more)

### Community 3 - "M10 Tenant Fan-Out"
Cohesion: 0.06
Nodes (56): GET(), POST(), postTenant(), run(), GET(), POST(), run(), scheduleTenantContinuation() (+48 more)

### Community 4 - "package.json"
Cohesion: 0.15
Nodes (14): dependencies, @upstash/redis@^1.35.6, @vercel/functions@^3.10.3, description, engines, node, name, overrides (+6 more)

### Community 5 - "Service Overview"
Cohesion: 0.13
Nodes (33): AES-256-GCM API Key Encryption, Tenant Timezone Calendar Dates, Cron Bearer Secret, API Key Encrypt Script, Environment Tenant Store, Field Catalog Generator, GoHighLevel HTTP Client, GoHighLevel (+25 more)

### Community 6 - "parse.ts"
Cohesion: 0.06
Nodes (73): backoff(), buildUrl(), COLLECTIONS_PAGE_LIMIT, CONTACT_PAGE_SIZE, createGhlClient(), requestJson(), searchContacts(), searchContactsPage() (+65 more)

### Community 7 - "devDependencies"
Cohesion: 0.17
Nodes (12): devDependencies, eslint@^9.39.0, @eslint/js@^9.39.0, @types/node@^22.19.0, typescript@^5.9.3, typescript-eslint@^8.46.0, vitest@^5.0.5, eslint (+4 more)

### Community 8 - "Idempotency Store"
Cohesion: 0.24
Nodes (6): createIdempotencyStore(), Entry, createUpstashIdempotency(), createUpstashIdempotencyFromEnv(), redisRestCredentials(), RedisSetNx

### Community 9 - "Order Reconcile Cron"
Cohesion: 0.17
Nodes (18): boundedSeen(), DEFAULT_FULL_RECONCILE_WEEKDAY, DEFAULT_RECONCILE_HOURS, drainOrderBackfill(), FULL_RECONCILE_PAGE_CAP, fullReconcileKey(), isFullReconcileDay(), MAX_CURSOR_SEEN (+10 more)

### Community 10 - "m10.test.ts"
Cohesion: 0.05
Nodes (45): cipher, ciphertext, iv, key, payload, plaintext, tag, hash (+37 more)

### Community 11 - "reconcile.test.ts"
Cohesion: 0.05
Nodes (58): vitest, applyLatestOrderDetail(), latestFirst(), MAX_LATEST_ORDER_DETAIL_CALLS, OrderLine, FIELD_INDEX, fieldByKey(), FieldDefinition (+50 more)

### Community 12 - "IdempotencyStore"
Cohesion: 0.22
Nodes (4): readReconcileCursor(), saveCursor(), IdempotencyStore, CountingStore

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

### Community 20 - "Runtime Dependency Wiring"
Cohesion: 0.31
Nodes (11): readFullReconcileWeekday(), readReconcileHours(), readReconcileMaxPages(), createOrderSummaryCache(), createRedisClient(), createUpstashOrderSummaryCache(), Entry, createDefaultDeps() (+3 more)

### Community 26 - "TypeScript Module Resolver"
Cohesion: 0.83
Nodes (3): isModuleNotFound(), isRelativeJs(), resolve()

## Knowledge Gaps
- **3 isolated node(s):** `./tsconfig.json`, `Health Check`, `Webhook Token Script`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 213 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `reconcile.test.ts` to `Customer Metrics Computation`, `Order Summary Cache`, `Webhook Ingress`, `M10 Tenant Fan-Out`, `package.json`, `parse.ts`, `devDependencies`, `Idempotency Store`, `m10.test.ts`, `esm-entrypoints.test.ts`?**
  _High betweenness centrality (0.121) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `computeM06()` (e.g. with `compareOrderTime()` and `isQualifyingOrder()`) actually correct?**
  _`computeM06()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `./tsconfig.json`, `Health Check`, `Webhook Token Script` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Customer Metrics Computation` be split into smaller, more focused modules?**
  _Cohesion score 0.06227106227106227 - nodes in this community are weakly interconnected._
- **Why does `GhlClient` connect `M10 Tenant Fan-Out` to `Order Summary Cache`, `Webhook Ingress`, `parse.ts`, `Order Reconcile Cron`, `m10.test.ts`, `reconcile.test.ts`, `Runtime Dependency Wiring`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `Order Summary Cache` be split into smaller, more focused modules?**
  _Cohesion score 0.09634551495016612 - nodes in this community are weakly interconnected._
- **Why does `computeM06()` connect `Customer Metrics Computation` to `Order Summary Cache`, `Webhook Ingress`, `M10 Tenant Fan-Out`, `parse.ts`, `reconcile.test.ts`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._