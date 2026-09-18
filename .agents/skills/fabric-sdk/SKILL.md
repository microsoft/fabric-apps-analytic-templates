---
name: fabric-sdk
description: >
  How to query Fabric data from a running app through the Rayfin connectors
  client. Use getRayfinClient().connectors.<name>.executeQuery to run DAX
  against a semantic model, and toQueryResult to normalize the response.
---

# Fabric Data Access at Runtime

## Overview

The app reaches Fabric through the Rayfin connectors client. Each connector
is declared in `rayfin.yml` and surfaced as
`getRayfinClient().connectors.<name>`, with operations typed by the connector
marker package.

The connector's `workspaceId` and `itemId` are injected server-side from
`rayfin.yml`. The app sends only the query, so no ids reach the bundle and
there is no generated config to keep in sync.

## Quick Start

Prefer the hook. It caches, normalizes, and never throws — every failure
arrives as `data.status === "error"`:

```typescript
import { useSemanticModelQuery } from "@/hooks/use-semantic-model-query";

const { data, isLoading, error, refetch } = useSemanticModelQuery({
  connection: "sales",
  query: 'EVALUATE SUMMARIZECOLUMNS(Product[Category], "Total", [Sales Amount])',
});

if (data?.status === "success") {
  // data.table.columns — [{ name, dataType }]
  // data.table.rows    — unknown[][] (frozen; copy before sorting)
} else if (data?.status === "error") {
  // Both a connector throw and a failure Power BI returned land here.
  // data.error.category — connector union: "api" | "query" | "network" | "overflow" | "unknown"
  // data.error.message
}
```

`error` mirrors `data.error.message` as a convenience for code that just wants
a string. It is never the only signal, so branching on `status` is enough.

Drop to the client only when you need something the hook does not expose:

```typescript
import { toQueryResult } from "@microsoft/rayfin-connector-fabric-semanticmodel";
import { getRayfinClient } from "@/lib/rayfin-client";

const response = await getRayfinClient().connectors.sales.executeQuery({
  query: "EVALUATE ...",
});
const result = toQueryResult(response);
```

## Key Concepts

### Declaring connectors

Connectors come from `rayfin/rayfin.yml`, managed by `rayfin connector add`. See
`AGENTS.md` to register one, and the `rayfin-connectors` skill that `add`
installs for the YAML schema. `AppConnectorsSchema` in
`src/lib/connectors.ts` types the names; it accepts any string by default, so
adding a connector needs no code change.

### Querying

One operation for DAX:

```typescript
await getRayfinClient().connectors[name].executeQuery({ query });
```

Each query must contain exactly one `EVALUATE` statement.

### Bounding rows

There is no default row cap, so bound the DAX with an aggregation or `TOPN(...)`.

The connector's `executeQuery` will also accept an optional
`resultSetRowCountLimit` alongside `query`. Prefer that over `TOPN(...)` when you
want a guard rather than a deliberately ranked subset: exceeding it fails the
query with an `overflow` error, so a truncated result announces itself, where
`TOPN` returns a complete-looking partial answer.

`useSemanticModelQuery` does not forward the field, so from app code shape the
DAX itself. The CLI's `invoke` accepts it.

### The connector throws, the hook does not

This is the one behavior that trips people up.

`executeQuery` **throws** on transport, auth, and server failures. A query
that reaches Power BI and fails there does not throw; it resolves with the
error nested in the response body.

`useSemanticModelQuery` folds both into a single result, so hook callers only
branch on `status`. If you call the client directly, you must handle both:

```typescript
try {
  const result = toQueryResult(await connector.executeQuery({ query }));
  if (result.status === "error") { /* Power BI rejected the query */ }
} catch (err) {
  /* never reached Power BI */
}
```

### Result Handling

`toQueryResult` returns a discriminated union on `status`. On success the
`table` has:
- `columns`: `Array<{ name: string, dataType: string }>`
- `rows`: `unknown[][]`, row-major, values aligned with `columns` by index

```typescript
// result.table.columns = [{ name: "Product[Name]", dataType: "unknown" },
//                          { name: "[Sales]", dataType: "unknown" }]
// result.table.rows    = [["Widget", 42], ["Gadget", 17]]
```

**Do not branch on `dataType`.** It is `"unknown"` whenever the payload carries
no column metadata, which is the common in-app case: column names are then
inferred from the first row. Supply display types yourself through
`columnMetadata` and `toDataTable`.

Because names are inferred from the first row in that fallback, a query whose
first row omits a column (or returns no rows) yields no columns for it. Shape
the DAX so every column is present in the first row.

### Caching

The connectors client does not cache. Caching is an app-level concern and
lives in `src/lib/query-cache.ts`, above the query hooks, so one store serves
every source kind. Use `useSemanticModelQuery` and you get it for free.

Successful results and DAX (`query`) errors are cached. `api`, `network`,
`overflow`, and `unknown` errors are not, since retrying may succeed.

### Error Categories

| Category | Meaning | Example |
|----------|---------|---------|
| `query` | Invalid DAX | `"Syntax error at position 18"` |
| `overflow` | Row or byte cap exceeded, data truncated | `"More than 1000000 rows in a query result"` |
| `api` | Transport, auth, or dataset-level failure | 401 Unauthorized |
| `network` | Direct execution failed before reaching the service | Connection reset |
| `unknown` | Could not categorize | Parse failure |

`overflow` means the result is **truncated but present**. Treat it as a
failure rather than rendering partial data as if it were complete.

## Common Patterns

### Multiple models

```typescript
const sales = useSemanticModelQuery({ connection: "sales", query: salesDax });
const inventory = useSemanticModelQuery({ connection: "inventory", query: invDax });
```

### Forcing fresh data

```typescript
const { data, refetch } = useSemanticModelQuery({ connection: "sales", query });
await refetch();                       // skips the cache
```

`clearQueryCache()` empties the store but does not re-render anything already
mounted — it changes what the next query reads. Use `refetch()` to re-read now.

## Anti-Patterns

- **Don't branch on `dataType`** — it is `"unknown"` whenever column metadata was absent and names had to be inferred from the first row.
- **Don't treat a resolved promise as success** — check `status`.
- **Don't send `workspaceId` or `itemId`** — they come from `rayfin.yml` server-side.
- **Don't build your own cache** — use `useSemanticModelQuery`.
- **Don't return unbounded results** — there is no default row cap, and the cache retains up to 256 results for the session. Bound the DAX with an aggregation or `TOPN(...)`.
- **Don't mutate a result** — tables are frozen. Copy before sorting.

## Type Reference

```typescript
import type {
  ExecuteQueryInput,
  FabricSemanticModelTabularResponse,
  SemanticModelQueryResult,
  QueryTable,
  QueryColumn,
  QueryError,
} from "@microsoft/rayfin-connector-fabric-semanticmodel";
```

For full type definitions, see `references/types.md` in this skill.
