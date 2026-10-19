# Filter-Aware DataGrid Totals

DataGrid filtering is enabled by default. Keep server-provided totals synchronized with local grid filters; DataGrid does not recompute provided totals automatically.

## Query shape

Start with the query-design skill's [flagged rollup](../../query-design/references/multi-grain-patterns.md#datagrid-grand-total-query), including its metadata and payload-limiting rules. Keep body rows and the grand total in one flagged query. Pass the current grid filter through `ROLLUPADDISSUBTOTAL`'s optional `grandtotalFilter` so it constrains the total without removing body rows that DataGrid still needs:

```dax
DEFINE
    VAR _GrandTotalFilter =
        TREATAS({<selected-values>}, '<GridDimension>'[<GridColumn>])

    VAR _RollupResult =
        SUMMARIZECOLUMNS(
            ROLLUPADDISSUBTOTAL(
                _GrandTotalFilter,
                ROLLUPGROUP(
                    '<Dimension1>'[<Column1>],
                    '<Dimension2>'[<Column2>]
                ),
                "IsGrandTotal"
            ),
            "<MetricAlias>", [<Measure>]
        )

EVALUATE _RollupResult
ORDER BY
    '<Dimension1>'[<Column1>] ASC,
    '<Dimension2>'[<Column2>] ASC
```

When no local filter is active, omit `_GrandTotalFilter` and the first `ROLLUPADDISSUBTOTAL` argument. For multiple grid filters, create one `TREATAS` table per known filterable column and combine them with `CROSSJOIN` for the `grandtotalFilter`.

## Factory safety

Use a typed [query factory](query-factories.md) to accept filter state.

- Map `GridColumnDef.id` values through a closed map of known DAX columns.
- Reject unknown column IDs; never interpolate an arbitrary identifier.
- Escape every selected value according to its DAX literal type.
- Keep application/page filters applied to both body and total evaluation.
- Apply local grid filters only through `grandtotalFilter`.

## Component wiring

```tsx
import { useState } from "react";
import type { CellValue } from "@microsoft/fabric-datagrid";
import { toRollupDataTables } from "@/lib/to-data-table";

const [gridFilters, setGridFilters] = useState<Record<string, CellValue[]>>({});
const config = revenueByRegion({ filters: gridFilters });
const result = useSemanticModelQuery({
    connection: config.connection,
    query: config.query,
});

if (result.error) return <ErrorMessage message={result.error.message} />;
if (!result.data && result.isLoading) return <LoadingSpinner />;
if (result.data?.status === "error") {
    return <ErrorMessage message={result.data.error.message} />;
}
if (result.data?.status !== "success") return null;

const { bodyTable, grandTotalTable } = toRollupDataTables(
    result.data.table,
    config.columnMetadata,
    { rollupFlagColumns: ["[IsGrandTotal]"] },
);

<DataGrid
    data={bodyTable}
    grandTotals={{ position: "bottom", data: grandTotalTable }}
    onFilterChange={(columnId, selectedValues) =>
        setGridFilters((current) => ({ ...current, [columnId]: selectedValues }))
    }
    theme={theme}
/>
```

Changing `gridFilters` re-executes the combined query. The hook retains the previous result during a replacement request, allowing DataGrid to keep rendering and filtering the complete body table. Replace the provided total only after the updated query succeeds. Always pass the returned `grandTotalTable` through `grandTotals.data`; omitting `data` selects client-computed mode.
