# Filter-Aware DataGrid Totals

DataGrid filters locally by default but does not recompute provided totals. Re-query the total without removing body rows needed for local filtering.

## Query shape

Extend the [flagged rollup](../../query-design/references/multi-grain-patterns.md#datagrid-grand-total-query), retaining its metadata and payload limits. Return body rows and total in one query; put local filters in `ROLLUPADDISSUBTOTAL`'s optional `grandtotalFilter`:

```dax
DEFINE
    VAR _GrandTotalFilter =
        TREATAS({<selected-values>}, '<GridDimension>'[<GridColumn>])

EVALUATE
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
ORDER BY
    '<Dimension1>'[<Column1>] ASC,
    '<Dimension2>'[<Column2>] ASC
```

With no local filter, omit `_GrandTotalFilter` and its argument. For multiple filters, `CROSSJOIN` one `TREATAS` table per known filterable column.

## Factory safety

Use a typed [query factory](query-factories.md): map `GridColumnDef.id` through a closed DAX-column map, reject unknown IDs, and escape literals by type. Application/page filters affect body and totals; local grid filters go only in `grandtotalFilter`.

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

Changing `gridFilters` re-queries; the hook retains the previous result while loading. Keep rendering the body and replace the total only on success. Always pass `grandTotalTable` through `grandTotals.data`; omitting it selects client-computed totals.
