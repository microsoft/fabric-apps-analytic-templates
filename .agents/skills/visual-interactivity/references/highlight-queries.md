# Cross-Highlight Queries

Cross-highlighting draws a bright selected subset over a dimmed baseline. For chart-local dimming without recomputation, use [native selections](native-selections.md).

## Re-aggregate the subset

Derive baseline and subset queries from the same [factory](query-factories.md), preserving:

- Grouping columns and order, measure expressions, field aliases, and raw types.
- Outer time and scope filters; the selection adds to them rather than replacing them.
- The baseline's row keys, including groups with no selected facts.

Wrap the baseline aggregation in `CALCULATETABLE`. Here, the selection filters an unprojected dimension:

```dax
EVALUATE
    CALCULATETABLE(
        SUMMARIZECOLUMNS('Product'[Category], "Sales", [Total Sales]),
        KEEPFILTERS(TREATAS({"PG", "PG-13"}, 'Movie'[Rating]))
    )
ORDER BY 'Product'[Category]
```

Let DAX evaluate measures under model relationships and RLS. Filtering the aggregated baseline cannot recompute non-additive measures or resolve unprojected columns. Target dimension columns rather than replacing these filters with `FILTER('FactTable', ...)`, and return raw values, not `FORMAT()` strings.

## Preserve row keys

`SUMMARIZECOLUMNS` drops groups whose measures are all BLANK. Every baseline key still needs a subset counterpart:

- When zero is meaningful, use `COALESCE([Total Sales], 0)` to retain all-BLANK groups.
- When BLANK must remain (for example, ratios), left-join the filtered aggregation onto the baseline's exact key table with `NATURALLEFTOUTERJOIN`.

Verify every baseline key survives; use the key-table join if filters remove groups despite `COALESCE`.

## Translate selection predicates

`DataPointSelection[]` means OR between selections, AND between predicates within each selection.

| Predicate | DAX |
|---|---|
| `SetPredicate`: `{ type: "set", name, values }` | `TREATAS(<values>, '<Table>'[<Column>])` |
| `RangePredicate`: `{ type: "range", name, min, max }` | `FILTER('<Table>', '<Table>'[<Column>] >= min && '<Table>'[<Column>] <= max)`; omit absent bounds |
| AND | Multiple filter arguments in one `CALCULATETABLE` |
| OR | `UNION` compatible per-selection filter tables inside one `KEEPFILTERS` |

## Component wiring

The host receives `onInteraction`, queries the subset with `useSemanticModelQuery`, and supplies [named datasets](../../visuals/references/multi-data-input.md). Both layers share encodings:

```json
{
    "encoding": {
        "x": { "field": "Category", "type": "nominal" },
        "y": { "field": "Sales", "type": "quantitative" }
    },
    "layer": [
        {
            "data": { "name": "all" },
            "mark": { "type": "bar", "opacity": 0.3 }
        },
        {
            "data": { "name": "highlighted" },
            "mark": "bar"
        }
    ]
}
```

```tsx
<VegaVisual
    spec={vegaLiteSpec}
    data={highlighted ? { all, highlighted } : { all }}
    theme={theme}
/>
```

Set `highlighted` to `null` when no selection is active. When the baseline changes, refresh the subset too; replace the pair only after both requests succeed, never mixing fresh and stale tables.
