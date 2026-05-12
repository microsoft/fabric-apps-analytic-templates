---
name: data-fetching
description: "Fetch Power BI data in React components using the useSemanticModelQuery hook. Query results, caching, error handling, connection aliases."
---

# Data Runtime (App Code Phase)

Generate React app code that fetches Power BI data at runtime using the
Fabric SDK. Queries should already be validated and saved as `.dax` files
(use the `data-discovery` skill for that).

## Data Fetching

- The `useSemanticModelQuery` hook (`src/hooks/use-semantic-model-query.ts`) is the primary way to fetch data in React components. It wraps the Fabric SDK client.
- The hook uses `getFabricClient()` internally — components should use the hook, not the client directly.
- For details on the SDK's caching behavior, error handling, and protocol options, see the `fabric-sdk` skill.

### Basic usage

```tsx
const query = 'EVALUATE SUMMARIZE(Sales, Products[Name], "Total", SUM(Sales[Amount]))'; // can also be the result of factory function
const { data, isLoading } = useSemanticModelQuery({
  connection: "salesModel",
  query: query,
});
```

### Result shape

The hook returns `data: CachedQueryResult | undefined`. Each query must
contain exactly one `EVALUATE` statement. On success:

```typescript
data.status         // "success"
data.table.columns  // Array<{ name: string, dataType: string }>
data.table.rows     // unknown[][] — row-major, values match column order
data.requestId      // string
data.fromCache      // boolean
data.cachedAt       // Date | undefined
```

**Important:** The SDK returns rows as arrays (`unknown[][]`), not objects.
Column names map to row positions by index. For example:
```typescript
// data.table.columns = [{ name: "Product[Name]", dataType: "String" },
//                       { name: "[Total]", dataType: "Int64" }]
// data.table.rows    = [["Widget", 42], ["Gadget", 17]]
//
// rows[0][0] = "Widget" corresponds to columns[0].name = "Product[Name]"
// rows[0][1] = 42      corresponds to columns[1].name = "[Total]"
```

### Handling errors

The SDK never throws — always check `result.status`:

```tsx
if (data?.status === "error") {
  // data.error.code, data.error.message
}
```

See the `fabric-sdk` skill for error categories and caching behavior of errors.

### Cache behavior

Results are cached by the SDK. Use `bypassCache` to force a fresh fetch:

```tsx
const { data } = useSemanticModelQuery({
  connection: "salesModel",
  query: 'EVALUATE ...',
  bypassCache: true,
});

// data.fromCache — true if served from SDK cache
// data.cachedAt — when the cached result was originally fetched
```

To clear cached results (e.g., after a data refresh or model change):

```tsx
import { clearQueryCache } from "@/hooks/use-semantic-model-query";

clearQueryCache();              // clear all models
clearQueryCache("salesModel");  // clear a specific model
```

See the `fabric-sdk` skill for full caching semantics (LRU eviction, what
gets cached, TTL patterns).

## Rules

- Never hardcode, mock, or store data — always fetch live from Power BI.
- Always use connection aliases from `fabric.yaml`, not raw dataset IDs.
- Surface query and service errors with meaningful UI messages.
