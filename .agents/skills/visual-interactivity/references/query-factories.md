# Runtime Query Factories

Parameterize factories only when runtime state changes DAX or a Vega-Lite spec; otherwise keep them parameterless. Follow the host template's query-factory conventions for file names, metadata, barrel exports, and validation. Configure sources and targets using [Interaction Manager](interaction-manager.md).

## Factory contract

- Accept typed, use-case-specific state, and `ManagedQueryFactoryParams` for Interaction Manager filters; never build filter DAX from selections.
- Return `connection`, `query`, `columnMetadata`, and `vegaLiteSpec`.
- Import `.dax` queries with `?raw` and specs from `.json`; never inline a full base query.
- Map identifiers through closed maps of known model columns; reject unknown IDs.
- Escape values for their DAX literal type; in strings, replace `"` with `""`.
- Assemble small value substitutions or `CALCULATETABLE` wrappers in TypeScript, not arbitrary model identifiers.

## Structural variants

When grouping, measures, or result shape changes, use separate complete `.dax` files named `{visualization-name}-{variant}.dax`. With shared `connection`, `columnMetadata`, and `vegaLiteSpec` defined:

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

## Interaction Manager filters

Interaction filters must run inside the query, before measures are calculated.
For example, a baseline row might show Bikes sales of 1,000 across all
countries, and selecting Canada might reduce that to 200. Filtering the loaded
row cannot produce 200; the query must run again with the Canada filter.

Accept the package's `ManagedQueryFactoryParams`. It declares one property,
`readonly interactionFilters?: readonly string[]`. Default it to `[]` in your
factory; an empty list adds no filtering.

Each string is one source's complete selection as a DAX table-filter argument.
Separate arguments in the same call intersect, so each source narrows the
result. Insert every string unchanged: do not split strings at commas, extract
predicates, drop entries, or pick filters by field. Those operations change
which combinations of values are selected.

## Insert filters into a grouped query

In `SUMMARIZECOLUMNS`, insert the filters after the grouping columns and before
the named expressions. Reserve a marker in your authored query:

```dax
EVALUATE
SUMMARIZECOLUMNS(
    'Product'[Category],
    /*__FILTER_ARGUMENTS__*/"Sales", [Total Sales]
)
ORDER BY 'Product'[Category]
```

Keep the DAX in the factory's `.dax` file and insert the filters with the
shipped, tested marker helper:

```ts
import type { ManagedQueryFactoryParams } from "@microsoft/fabric-interaction-manager";
import { insertInteractionFilters } from "@/lib/query-factory";
import baseQuery from "./category-chart.dax?raw";
import vegaLiteSpec from "./category-chart.json";

export function categoryChart(
    { interactionFilters = [] }: ManagedQueryFactoryParams = {},
) {
    return {
        connection: "sales",
        query: insertInteractionFilters(baseQuery, interactionFilters, "/*__FILTER_ARGUMENTS__*/", "beforeMeasures"),
        columnMetadata: {
            "Product[Category]": { name: "Category", displayName: "Category" },
            "[Sales]": { name: "Value", displayName: "Sales", format: "$0" },
        },
        vegaLiteSpec,
    };
}
```

The helper adds a comma after each filter in this position, removes the marker
for an empty list, and throws when the marker is missing or repeated.

For measures-only or columns-only queries, multiple bases, Top N, and
queries with an outer filter context, see [advanced query shapes](advanced-query-shapes.md).

## Load the target

`useQueryFactoryTarget` loads a registered target through its query factory.
It passes the manager's baseline filters as `interactionFilters` and returns
a load state containing one `DataTable` when data is available:

```tsx
import { useQueryFactoryTarget } from "@/hooks/use-query-factory-target";
import { categoryChart } from "@/queries/sales/category-chart";

const result = useQueryFactoryTarget("details", categoryChart, {});
```

Pass the factory's other inputs as the third argument, such as `{ granularity }`
for a `revenueTrend` factory. The hook compares these inputs by their JSON
serialization; recreating an inline object with the same serialized contents
does not itself trigger a reload.

The target loads on mount and reloads when its factory inputs or interactions
affecting it change. Keep the factory function stable unless changing it is
intended to reload the target.

### Query execution and load states

The hook uses `useManagedInteractionTarget` to manage loading and retain
successful results. Its loader executes factories through `executeQueryFactory`,
which shares the Rayfin execution path and error normalization with
`useSemanticModelQuery`, then converts successful query tables using the
factory's column metadata. Execution caching is template-specific:
the data-app shares its existing session cache, while Universal App is uncached.

`result.status` is `"loading"` while a load is pending with no previous data;
`"refreshing"` while a replacement load is pending, keeping the previous `data`
and `isCrossHighlightActive` together; `"ready"` with the latest successful
load's data; `"refresh-error"` when a load failed, retaining the previous
successful data and highlight flag and exposing the failure as `error`; or
`"error"` when a load failed with no previous data. A result from a superseded
load is ignored but not cancelled.

Query failures appear as `result.error` in the `"error"` or `"refresh-error"`
state. These errors preserve the query category, code, available HTTP status
and workload details, diagnostic text, and original cause. Handle the returned
state; query failures do not throw from `useQueryFactoryTarget`.

Invalid selections throw during compilation, and the load fails before any
query runs. A failed query also fails the load. Surface `result.error`; do not
retry without the interaction filters.

### Present loading and failures

Handle each result state using the app's loading and error UI. On
`"refresh-error"`, keep the previous visual visible and show the failure
alongside it. Explicitly identify retained rows, highlights and totals as stale,
never silently present them as the latest result. With no previous data, show a
load error instead. Preserve accepted selections.

### Target-only components

A target-only component, such as a measures-only grid, should declare
`selectableFields: []` and omit source interaction props. Components that also
publish selections should follow the skill's source-binding guidance.

### Highlighting

A highlight-capable target also loads a highlighted subset and returns
`{ all, highlighted }`; see [highlight queries](highlight-queries.md).
