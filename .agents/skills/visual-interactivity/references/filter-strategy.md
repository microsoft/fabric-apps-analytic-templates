# Cross-Filtering

Choose where to filter by dimension cardinality, measure cost, and result size.

| Approach | Method | Best when |
|---|---|---|
| **Client-side** | Group by the filter dimension, fetch once, filter rows in TypeScript | Few dimension values (roughly a few dozen), cheap measures, and a manageable payload |
| **DAX** | Pass the selection as a query parameter and re-query | High cardinality (dates, customers), costly measures such as `DISTINCTCOUNT`, or oversized results |

Estimate rows x columns against browser memory; frequent changes favor prefetching only when it fits.

## Client-side filtering

Include the filter dimension in the result:

```dax
EVALUATE
    SUMMARIZECOLUMNS(
        'Region'[Name],
        'Product'[Category],
        "Revenue", [Total Revenue]
    )
ORDER BY 'Region'[Name], 'Product'[Category]
```

Using the metadata alias `RegionName`, filter the `DataTable`; `null` clears the selection:

```tsx
const dataTable: DataTable = toDataTable(data.table, columnMetadata);
const regionIndex: number = dataTable.columns.findIndex(column => column.name === "RegionName");
if (regionIndex < 0) throw new Error("Missing RegionName column");

const filteredTable: DataTable = {
    columns: dataTable.columns,
    rows: selectedRegion === null
        ? dataTable.rows
        : dataTable.rows.filter(row => row[regionIndex] === selectedRegion),
};

<VegaVisual spec={vegaLiteSpec} data={filteredTable} theme={theme} />
```

For chart-local filtering, use a Vega-Lite selection parameter with `transform.filter` instead; see [Native selections](native-selections.md).

## DAX filtering

Filter before aggregation to avoid computing every date:

```dax
DEFINE
    VAR _DateFilter = TREATAS({DATE(2024, 3, 15)}, 'Calendar'[Date])
EVALUATE
    SUMMARIZECOLUMNS(
        'Product'[Category],
        _DateFilter,
        "Revenue", [Total Revenue],
        "Units Sold", [Total Quantity]
    )
ORDER BY 'Product'[Category]
```

Each change requires a round-trip. Apply runtime values through a typed [query factory](query-factories.md).
