---
name: fabric-sdk
description: >
  How to use @microsoft/fabric-app-data to connect web applications to Fabric data
  sources at runtime. Build browser-based apps that query semantic models
  via DAX using the FabricClient API.
---

# Fabric SDK Usage

## Overview

`@microsoft/fabric-app-data` lets web applications query Fabric semantic models at
runtime. The SDK provides a `FabricClient` that handles querying, result
parsing, caching, and error handling. Transport and authentication are
delegated to an `IFabricApiProxy` implementation, keeping the SDK
environment-agnostic (browser, Node.js, Fabric extensions).

## Quick Start

```typescript
import { FabricClient } from "@microsoft/fabric-app-data";

const client = new FabricClient({
  proxy,                               // provided by host environment
  semanticModels: {
    sales: { workspaceId: "...", itemId: "..." },
  },
});

const result = await client.semanticModel("sales").query(
  "EVALUATE SUMMARIZECOLUMNS(Product[Category], \"Total\", [Sales Amount])"
);

if (result.status === "success") {
  // result.table.columns — [{name, dataType}]
  // result.table.rows    — unknown[][]
} else {
  // result.error.category — "api" | "query" | "overflow" | "network" | "unknown"
  // result.error.message
}
```

## Key Concepts

### FabricClient Configuration

The `FabricClient` is constructed with a config object. The `proxy` and
connection details are typically provided by the host environment — your
code just needs to pass them through:

```typescript
new FabricClient({
  proxy,                               // Provided by host environment
  semanticModels: {                    // Named connections
    alias: { workspaceId, itemId },
  },
  cache: {                             // Optional
    enabled: true,                     // Default: true
    maxEntries: 64,                    // Default: 64 (LRU eviction)
  },
});
```

- `workspaceId` can be a GUID or `"me"` for My Workspace items.

### Managing Connections

Use the `fabric-app-data` CLI to manage connections in a `fabric.yaml` file.
This keeps workspace/item IDs out of your source code and supports
multiple profiles (dev, staging, production).

**Recommended workflow:**

1. `npx fabric-app-data init` — create `fabric.yaml`
2. `npx fabric-app-data add` — add connections (by IDs or Fabric portal URL)
3. `npx fabric-app-data generate -o src/fabric.generated.ts` — codegen a TypeScript config file
4. Import the generated config in your app

```typescript
import { fabricConfig } from "./fabric.generated.js";

const client = new FabricClient({ proxy, ...fabricConfig });
```

Run `npx fabric-app-data generate -o src/fabric.generated.ts` whenever `fabric.yaml` changes.

For full CLI documentation, load the **fabric-cli** skill.

### Querying

There is **one method** for DAX queries:

```typescript
const result = await client.semanticModel("alias").query(dax);

// To skip the cache:
const fresh = await client.semanticModel("alias").query(dax, { bypassCache: true });
```

### Result Handling

**Always check `result.status`** — queries never throw.

Each query must contain exactly one `EVALUATE` statement. On success, the
result contains a single `table` with:
- `columns`: `Array<{ name: string, dataType: string }>` — column metadata
- `rows`: `unknown[][]` — row-major array, values match column order by index

```typescript
const result = await model.query("EVALUATE ...");

if (result.status === "success") {
  // result.table.columns = [{ name: "Product[Name]", dataType: "String" },
  //                          { name: "[Sales]", dataType: "Int64" }]
  // result.table.rows    = [["Widget", 42], ["Gadget", 17]]
  // result.table.rows[0][0] → "Widget" (matches columns[0])
  // result.table.rows[0][1] → 42       (matches columns[1])
} else {
  console.error(result.error.message);
  // result.error.category: "query" (bad DAX), "overflow" (value too large),
  //                        "api" (HTTP error), "network" (connectivity), "unknown"
}
```

### Caching

Results are cached in memory by default (LRU, 64 entries).

```typescript
const r1 = await model.query("EVALUATE T");  // r1.fromCache === false
const r2 = await model.query("EVALUATE T");  // r2.fromCache === true

// Check cache age
if (r2.fromCache && r2.cachedAt) {
  const ageMs = Date.now() - r2.cachedAt.getTime();
}

// Force fresh result
const fresh = await model.query("EVALUATE T", { bypassCache: true });

// Clear cache
client.clearCache();                          // all sub-clients
model.clearCache();                           // this model only
```

**What gets cached:**
- ✅ Success results
- ✅ Query errors (bad DAX — won't fix itself)
- ❌ API errors (401, 500 — transient)
- ❌ Network errors (transient)

### Error Categories

| Category | Meaning | Cached? | Example |
|----------|---------|---------|---------|
| `query` | Invalid DAX syntax | Yes | `"Syntax error at position 18"` |
| `overflow` | Integer/decimal exceeds safe range | Yes | Value > MAX_SAFE_INTEGER |
| `api` | HTTP error from Fabric | No | 401 Unauthorized, 500 Server Error |
| `network` | Connection failure | No | DNS resolution, timeout |
| `unknown` | Unexpected error | No | Parse failure |

### Data Types and DateTime Semantics

The SDK converts all DAX data types to standard JS values:

| DAX type | JS value type | Example |
|----------|--------------|---------|
| Integer (Int64) | `number` | `42` |
| Double (Float64) | `number` | `3.14` |
| Currency/Decimal | `number` | `100.50` |
| Boolean | `boolean` | `true` |
| String | `string` | `"hello"` |
| DateTime/Date | `string` (ISO) | `"2024-01-15T10:30:00.000"` |
| BLANK | `null` | `null` |

**DateTime values** are returned as ISO 8601 strings **without a timezone
suffix** (no `Z`, no `±HH:MM`). This matches the semantics of Analysis
Services semantic models, where datetimes are timezone-unaware.

```typescript
// DateTime column values look like:
"2024-01-15T10:30:00.000"   // no timezone — interpret as-is
"2023-06-01T00:00:00.000"
```

This format is directly compatible with Vega-Lite's `temporal` encoding type
and ensures consistent display across all browser timezones. The JSON and
Arrow protocols both return the same format.

**Integer overflow**: If an integer value exceeds `±Number.MAX_SAFE_INTEGER`
(±9,007,199,254,740,991), the query returns an error with
`category: "overflow"` rather than silently losing precision.

## Common Patterns

### Multiple Models

```typescript
const client = new FabricClient({
  proxy,
  semanticModels: {
    sales: { workspaceId: "ws-1", itemId: "item-1" },
    inventory: { workspaceId: "ws-2", itemId: "item-2" },
  },
});

const salesResult = await client.semanticModel("sales").query("EVALUATE ...");
const invResult = await client.semanticModel("inventory").query("EVALUATE ...");
```

### My Workspace Items

```typescript
semanticModels: {
  myModel: { workspaceId: "me", itemId: "..." },
}
```

### Disabling Cache

```typescript
new FabricClient({
  proxy,
  cache: { enabled: false },
  semanticModels: { ... },
});
```

## Anti-Patterns

- **Don't catch errors from `query()`** — it never throws. Check `result.status`.
- **Don't hardcode endpoint URLs** — the proxy handles transport.
- **Don't construct `SemanticModelClient` directly** — use `client.semanticModel(alias)`.
- **Don't import from internal paths** — only import from `"@microsoft/fabric-app-data"`.

## Type Reference

All types are exported from the `"@microsoft/fabric-app-data"` package entry point.

Key types to import when needed:
```typescript
import type {
  FabricClientConfig,
  FabricItemRef,
  QueryResult,
  CachedQueryResult,
  QueryCacheOptions,
  QueryTable,
  QueryColumn,
  QueryError,
} from "@microsoft/fabric-app-data";
```

For full type definitions, see `references/types.md` in this skill.
