---
name: semantic-model-data
description: >
  How the app reads semantic model data at runtime: useSemanticModelQuery, its
  normalized result and error shape, error categories and overflow, bounding
  rows, and the app-level query cache.
---

# Semantic Model Data at Runtime

## Overview

The app runs DAX against a semantic model through a connector registered in
`rayfin/rayfin.yml` (see `AGENTS.md`). The app sends only the query; the
connector's `workspaceId` and `itemId` are injected server-side.

## Quick Start

Use the hook. It caches and never throws: every failure, whether the connector
threw or Power BI returned an error, is normalized into the same result shape
and arrives as `data.status === "error"`.

```typescript
import { useSemanticModelQuery } from "@/hooks/use-semantic-model-query";

const { data, isLoading, error, refetch } = useSemanticModelQuery({
  connection: "sales",
  query: 'EVALUATE SUMMARIZECOLUMNS(Product[Category], "Total", [Sales Amount])',
});

if (data?.status === "success") {
  // data.table.columns — one entry per output column
  // data.table.rows    — unknown[][], aligned with columns by index (frozen; copy before sorting)
} else if (data?.status === "error") {
  // data.error.category — see Error Categories
  // data.error.message
}
```

`error` mirrors `data.error.message` as a convenience for code that just wants
a string. It is never the only signal, so branching on `status` is enough.

The hook's options, result type, and error normalization are in
`src/hooks/use-semantic-model-query.ts`; read it when you need more than this
skill covers. Calling `getRayfinClient().connectors.<name>.executeQuery()`
directly skips both that normalization (on the deployed path it can throw) and
the cache, so use the hook.

## Key Concepts

### Querying

Each query must contain exactly one `EVALUATE` statement.

### Bounding rows

There is no default row cap, so bound the DAX with an aggregation or `TOPN(...)`.

The connector's `executeQuery` also accepts an optional `resultSetRowCountLimit`
alongside `query`. It **silently truncates**: the query succeeds with at most
that many rows and no error or flag. It is not a completeness guard. If you use
it, treat a result with exactly `resultSetRowCountLimit` rows as possibly
incomplete.

`useSemanticModelQuery` does not forward the field, so from app code shape the
DAX itself. The CLI's `invoke` accepts it in the payload file.

### Result Handling

On success, `data.table` holds the result:

- `rows` line up with `columns` by index.
- Each column `name` (for example `Product[Name]` or `[Sales]`) is that
  column's `columnMetadata` key. Take it from the query's actual output.
- Do not branch on `dataType`. It is a wire type such as `Int64`, or
  `"unknown"` when the response carried no column metadata, not a display
  type. Supply display types through `columnMetadata` and `toDataTable`.

Without column metadata, names are inferred from the first row, so a column
missing from the first row (or a result with no rows) yields no column. Shape
the DAX so every column is present in the first row.

### Caching

The connectors client does not cache. Caching is an app-level concern and
lives in `src/lib/query-cache.ts`, above the query hooks, so one store serves
every source kind. Use `useSemanticModelQuery` and you get it for free.

Successful results and DAX (`query`) errors are cached. `api`, `network`,
`overflow`, and `unknown` errors are not, since retrying may succeed.

### Error Categories

Every failure, thrown or returned, carries one of these categories:

| Category | Meaning | What to do |
|----------|---------|------------|
| `query` | Power BI ran the query and rejected it, typically invalid DAX | Fix the DAX |
| `overflow` | A value cannot be represented as a JavaScript number | See below |
| `network` | No response arrived (offline, DNS, CORS) | Retry |
| `api` | The service answered with a failure, typically auth or permissions | Check sign-in and access |
| `unknown` | Anything else | Read `message` |

`overflow` is an error result with **no table**: nothing partial comes back to
render. It means a value in the result cannot be turned into a JavaScript
`number` without losing precision, so the connector refuses the whole result:

- an Int64 beyond `Number.MAX_SAFE_INTEGER` (±9,007,199,254,740,991), or
- a fixed-decimal value whose unscaled digits exceed it. Power BI's
  fixed-decimal type carries four decimal places, so its limit is about
  ±900 billion (±900,719,925,474.0991).

Row limits and `TOPN` do not help, and the CLI's generic recovery text ("Lower
resultSetRowCountLimit, or narrow the query") does not apply to this case.
Change the value in DAX: convert it to text (`FORMAT([Measure], "0.00")` or
`CONVERT([Measure], STRING)`) and treat it as a string, convert it to a
floating-point number (`CONVERT([Measure], DOUBLE)`) if approximate values are
acceptable, or scale it down (for example report thousands or millions).

Too many rows is **not** an `overflow`: `resultSetRowCountLimit` truncates
silently (see Bounding rows).

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

- **Don't branch on `dataType`** — it is a wire type (or `"unknown"` when column metadata was absent and names had to be inferred from the first row), not a display type.
- **Don't treat a resolved promise as success** — check `status`.
- **Don't send `workspaceId` or `itemId`** — they come from `rayfin.yml` server-side.
- **Don't build your own cache** — use `useSemanticModelQuery`.
- **Don't return unbounded results** — there is no default row cap, and the cache retains up to 256 results for the session. Bound the DAX with an aggregation or `TOPN(...)`.
- **Don't mutate a result** — tables are frozen. Copy before sorting.

## Type Reference

`useSemanticModelQuery` returns `data` as
`CachedQueryResult<SemanticModelQueryResult>`: the connector's result union plus
the `fromCache` and `cachedAt` fields the app cache adds
(`src/lib/query-cache.ts`). Import these types rather than redefining them.
