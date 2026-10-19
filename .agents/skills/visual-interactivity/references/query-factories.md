# Query Factories for Runtime Interaction

Use a parameterized query factory when runtime interaction state changes a DAX query or Vega-Lite spec. Follow the template's [query-factory conventions](../../../../AGENTS.md#query-and-spec-organization) for every visual; keep factories without runtime inputs parameterless.

## File organization

Keep the same kebab-case base name used by query factories. Add variant `.dax` files when runtime state changes the query's structure.

```
src/queries/
    index.ts
    {page-or-domain}/
        {visualization-name}.dax
        {visualization-name}-{variant}.dax  # Only for structural variants
        {visualization-name}.json
        {visualization-name}.ts             # Parameterized factory
        index.ts
```

## Factory contract

Factory parameters are use-case-specific and typed. They translate runtime interaction state into a query or spec while returning the same shape as a parameterless factory.

```ts
import type { ColumnMetadataMap } from "@/lib/to-data-table";
import baseQuery from "./revenue-by-region.dax?raw";
import baseSpec from "./revenue-by-region.json";

const connection: string = "{connection-alias}";

const columnMetadata: ColumnMetadataMap = {
    "Products[Region]": { name: "ProductsRegion", displayName: "Region" },
    "[Total Revenue]": {
        name: "Total Revenue",
        displayName: "Total Revenue",
        format: "$#,0.00",
    },
};

interface RevenueByRegionParams {
    selectedCategories?: readonly string[];
}

export function revenueByRegion(params?: RevenueByRegionParams) {
    let query: string = baseQuery;

    if (params?.selectedCategories?.length) {
        // Apply the selected values to a known model column. Escape every DAX
        // string literal; never accept a runtime column or table identifier.
    }

    return {
        connection,
        query,
        columnMetadata,
        vegaLiteSpec: baseSpec,
    };
}
```

The base query must remain in a `.dax` file. Small value substitutions or a `CALCULATETABLE` wrapper may be assembled in TypeScript, but do not inline the full base query or accept arbitrary model identifiers from component state.

## Structural variants

When interaction changes grouping columns, measures, or result shape, keep each complete query in its own `.dax` file and select it from a closed typed map:

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

Do not use structural variants when one stable query can return the required shape and the interaction only changes client-side presentation.

## Component wiring

Call the factory with interaction state before invoking `useSemanticModelQuery`. A changed query key causes a new request and uses the app-level query cache for previously seen values.

```tsx
const config = revenueByRegion({ selectedCategories });
const result = useSemanticModelQuery({
    connection: config.connection,
    query: config.query,
});
```

Keep the previous successful visual rendered while the replacement query loads. Surface query failures instead of converting them into empty success results.
