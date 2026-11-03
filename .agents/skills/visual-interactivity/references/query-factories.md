# Runtime Query Factories

Parameterize factories only when runtime state changes DAX or a Vega-Lite spec; otherwise keep them parameterless. Follow the template's [query-factory conventions](../../../../AGENTS.md#query-and-spec-organization) for file names, metadata, barrel exports, and validation.

## Factory contract

- Accept typed, use-case-specific state.
- Return `connection`, `query`, `columnMetadata`, and `vegaLiteSpec`.
- Import `.dax` queries with `?raw` and specs from `.json`; never inline a full base query.
- Map identifiers through closed maps of known model columns; reject unknown IDs.
- Escape values for their DAX literal type; in strings, replace `"` with `""`.
- Assemble small value substitutions or `CALCULATETABLE` wrappers in TypeScript, not arbitrary model identifiers.

## Structural variants

When grouping, measures, or result shape changes, use separate complete `.dax` files. With shared `connection`, `columnMetadata`, and `vegaLiteSpec` defined:

```ts
import monthlyQuery from "./revenue-trend-monthly.dax?raw";
import quarterlyQuery from "./revenue-trend-quarterly.dax?raw";
import yearlyQuery from "./revenue-trend-yearly.dax?raw";

type Granularity = "monthly" | "quarterly" | "yearly";

const queryByGranularity: Record<Granularity, string> = {
    monthly: monthlyQuery,
    quarterly: quarterlyQuery,
    yearly: yearlyQuery,
};

export function revenueTrend(params: { granularity: Granularity }) {
    return {
        connection,
        query: queryByGranularity[params.granularity],
        columnMetadata,
        vegaLiteSpec,
    };
}
```

Select matching metadata and specs if the result shape differs. Do not add query variants for presentation-only changes.

## Component wiring

Call the factory before the query hook:

```tsx
const config = revenueTrend({ granularity });
const result = useSemanticModelQuery({
    connection: config.connection,
    query: config.query,
});
```

Changed queries trigger requests; repeated query keys reuse the app-level cache. Keep the previous successful render while loading, and surface failures rather than returning empty success results.
