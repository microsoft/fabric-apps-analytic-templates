# Runtime Query Factories

Parameterize factories only when runtime state changes DAX or a Vega-Lite spec; otherwise keep them parameterless. Follow the template's [query-factory conventions](../../../../AGENTS.md#query-and-spec-organization) for file names, metadata, barrel exports, and validation.

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
template's tested marker helper:

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

`useQueryFactoryTarget` passes the manager's baseline filters to the factory as
`interactionFilters` and returns the target's load state with one `DataTable`.
It loads on mount, when the factory's other inputs change, and when interactions
that affect this target change. Here `"details"` is a registered target loading
the `categoryChart` factory above:

```tsx
import { useQueryFactoryTarget } from "@/hooks/use-query-factory-target";
import { categoryChart } from "@/queries/sales/category-chart";

const result = useQueryFactoryTarget("details", categoryChart, {});
```

Pass the factory's other inputs as the third argument, such as `{ granularity }`
for a `revenueTrend` factory that also accepts `ManagedQueryFactoryParams`. The hook compares them by their JSON contents, so an inline object
reloads only when its values change.

Register a target-only component, such as a measures-only grid, with
`selectableFields: []` and render it without source props. If you pass
`onInteraction`, its clicks are still published and the manager rejects them as
not selectable:

```tsx
if (result.status === "loading") return <div>Loading...</div>;
if (result.status === "error") return <div role="alert">{result.error.message}</div>;
return <>
    {result.status === "refresh-error" && <div role="alert">{result.error.message}</div>}
    <DataGrid data={result.data} theme={theme} />
</>;
```

The hook runs factories through `executeQueryFactory`, which uses the same
Rayfin execution, error normalization, and session-lifetime cache as
`useSemanticModelQuery`, then calls `toDataTable` with the factory metadata.
A failed query's error carries the query error, including its `category`, as
its `cause`.

`result.status` is `"loading"` when there is no data to show, including the
load after an error; `"refreshing"` while a newer load runs, keeping the previous
`data` and its `isCrossHighlightActive` together; `"ready"` with the latest load's
data; `"refresh-error"` when a newer load failed, retaining the previous successful
`data` and `isCrossHighlightActive` and exposing the failure as `error`; or `"error"`
when a load failed with no previous data. Keep the visual visible on `"refresh-error"`
and show the error alongside it. A result from a superseded load is ignored but not cancelled.

Invalid selections throw during compilation, and the load fails before any
query runs. A failed query also fails the load. Surface `result.error`; do not
retry without the interaction filters.

A highlight-capable target also loads a highlighted subset and returns
`{ all, highlighted }`; see [highlight queries](highlight-queries.md).
