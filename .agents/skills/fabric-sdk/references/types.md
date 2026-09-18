# Fabric Connector — Full Type Reference

All types are exported from `@microsoft/rayfin-connector-fabric-semanticmodel`.

## Operation Input

```typescript
interface ExecuteQueryInput {
  /** A DAX query string. */
  query: string;
  /**
   * Optional cap on rows returned. Positive integer.
   * No default: omit it and every row comes back.
   * A non-positive or non-integer value is silently dropped.
   */
  resultSetRowCountLimit?: number;
}
```

The connector's `workspaceId` and `itemId` are declared in `rayfin.yml` and
injected server-side, so they are not part of the input.

## Wire Response

What `executeQuery` resolves to, before normalization.

```typescript
interface FabricSemanticModelTabularResponse {
  status: string;                       // FuncSet status, e.g. "Succeeded"
  output: FabricSemanticModelOutput;
  errors: unknown[];                    // empty on success
}

interface FabricSemanticModelOutput {
  tables: FabricSemanticModelTable[];
  requestId?: string;
  queryError?: FabricSemanticModelError | null;     // per-query failure
  responseError?: FabricSemanticModelError | null;  // dataset-level failure
  informationProtectionLabel?: { id: string; name: string };
}

interface FabricSemanticModelTable {
  rows: Array<Record<string, unknown>>; // keys are column names
  error?: FabricSemanticModelError;     // set when row/byte caps are exceeded
  columns?: Array<{ name: string; dataType?: string }>; // reserved, not populated today
}

interface FabricSemanticModelError {
  code?: string;
  message: string;
}
```

Note `status: "Succeeded"` describes the *invocation*, not the query. A failed
query still reports `"Succeeded"` with the detail in `queryError` or
`tables[].error`.

## Normalized Result

What `toQueryResult(response)` returns.

```typescript
interface QueryColumn {
  name: string;
  /** Real Power BI type when metadata was present, else "unknown". */
  dataType: string;
}

interface QueryTable {
  columns: QueryColumn[];
  rows: unknown[][];                    // row-major, aligned with columns
}

type QueryErrorCategory =
  | "api" | "query" | "network" | "overflow" | "unknown";

interface QueryError {
  category: QueryErrorCategory;
  message: string;
  code?: string;
}

type SemanticModelQueryResult =
  | { status: "success"; table: QueryTable; requestId: string }
  | { status: "error"; error: QueryError; requestId: string };
```

Error precedence, highest first:

1. non-empty `errors[]` → `api`
2. `output.responseError` → `api`
3. `output.queryError` → `query`
4. `output.tables[0].error` → `overflow`

**Column caveat.** Columns come from `tables[0].columns` when the payload
carried metadata, in which case `dataType` is a real Power BI type such as
`Int64`. Arrow responses carry it; the JSON `executeQueries` endpoint does not.
When it is absent, names are inferred from `Object.keys(rows[0])` and every
`dataType` is `"unknown"`. In that fallback a query returning no rows yields no
columns.

## Client Surface

```typescript
type AppConnectorsSchema = Record<string, FabricSemanticModel<"executeQuery">>;

// getRayfinClient().connectors.<name>
interface TypedConnectorClient {
  executeQuery(
    input: ExecuteQueryInput,
    options?: { headers?: Record<string, string> },
  ): Promise<FabricSemanticModelTabularResponse>;
}
```

`executeQuery` **throws** on transport, auth, and server failures. Only
Power BI level failures come back in the resolved response.

## App-Level Cache

```typescript
type CachedQueryResult<T> = T & {
  fromCache: boolean;
  cachedAt?: Date;
};
```

Added by `src/lib/query-cache.ts`, not by the connector.
