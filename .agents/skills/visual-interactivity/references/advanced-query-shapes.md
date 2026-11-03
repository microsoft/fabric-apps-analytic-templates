# Advanced Query Shapes

Read this after the grouped-query example in [query factories](query-factories.md)
when a target's query is not a single top-level `SUMMARIZECOLUMNS`.

## Where to insert filters

Apply the complete filter list wherever a base result is evaluated, before any
ranking or combining. The examples below show one filter for brevity.

### Measures-only and columns-only queries

Wrap a measures-only `ROW`, or a columns-only `VALUES`, `DISTINCT`, or
`SUMMARIZE`, in `CALCULATETABLE`. Filters follow the base expression here, so
each needs a leading comma instead of a trailing one:

```dax
EVALUATE
CALCULATETABLE(
    ROW("Sales", [Total Sales], "Quantity", [Total Quantity]),
    TREATAS({ "West" }, 'Geography'[Region])
)
```

```dax
EVALUATE
CALCULATETABLE(
    VALUES('Product'[Name]),
    TREATAS({ "West" }, 'Geography'[Region])
)
```

With no filters, keep the original expression or a wrapper without a dangling
comma. Keep an existing `DISTINCT` or `SUMMARIZE` rather than switching to
`VALUES`, which can change BLANK or distinct results.

Author `CALCULATETABLE(ROW(...)/*__FILTER_ARGUMENTS__*/)` and call
`insertInteractionFilters(baseQuery, interactionFilters, marker, "afterTable")`.
The helper owns the leading commas; do not add a comma beside the marker.

### Multiple bases and nested operations

When a query combines several base results, apply the complete filter list to
each one. Filtering only the final result cannot recalculate the bases:

```dax
DEFINE
    VAR _region = TREATAS({ "West" }, 'Geography'[Region])
    VAR _internet =
        SUMMARIZECOLUMNS(
            'Product'[Name], _region, "Sales", [Internet Sales]
        )
    VAR _reseller =
        SUMMARIZECOLUMNS(
            'Product'[Name], _region, "Sales", [Reseller Sales]
        )
EVALUATE
INTERSECT(
    SUMMARIZE(_internet, 'Product'[Name]),
    SUMMARIZE(_reseller, 'Product'[Name])
)
```

If you use several insertion markers, give each a distinct name, check that
each occurs exactly once, and insert the complete list at every marker.
Call `insertInteractionFilters` once for each marker. Do not parse a completed
query to discover insertion points.

For `TOPN` or `FILTER`, keep the filters inside the base beneath the outer
operation. A columns-only base uses the `CALCULATETABLE` wrapper shown above.

```dax
EVALUATE
TOPN(
    10,
    SUMMARIZECOLUMNS(
        'Product'[Name],
        TREATAS({ "West" }, 'Geography'[Region]),
        "Sales", [Total Sales]
    ),
    [Sales], DESC
)
```

### Queries with an outer filter context

The examples above are top-level queries, so they need no `KEEPFILTERS`. If a
base expression is evaluated inside outer filters, such as a `CALCULATETABLE`
with its own filter arguments, an interaction filter replaces outer filters on
the columns it references. To intersect with them instead, wrap the whole
argument in `KEEPFILTERS(...)`. `SUMMARIZECOLUMNS` currently rejects a mix of
`KEEPFILTERS` and unwrapped filters on the same table, so wrap all of that
table's filters. Do not add `KEEPFILTERS` to top-level queries or to change a
measure's intended behavior.

## Top N highlight targets

Cross-filtering may change which groups make the Top N. Cross-highlighting must
keep the baseline's groups. Do not rerun `TOPN` under highlight filters: a
displayed group can drop out of that ranking even though it has a highlighted
value, and alignment cannot recover a row the query never returned.

Instead, load the baseline first. Serialize its target keys with
`createBaselineKeyFilter`, and pass that filter plus the complete highlight
scope to a separate, **unranked** factory. `useQueryFactoryTarget` runs one
factory for both queries, so write this loader for `useManagedInteractionTarget`:

```tsx
import { useCallback } from "react";
import { createBaselineKeyFilter, createHighlightData } from "@microsoft/fabric-interaction-manager";
import type { InteractionTargetData, InteractionTargetLoadContext } from "@microsoft/fabric-interaction-manager";
import { useManagedInteractionTarget } from "@microsoft/fabric-interaction-manager/react";
import { executeQueryFactory } from "@/lib/query-factory";

const loadData = useCallback(
    async ({ isCrossHighlightActive, compiledFilters }: InteractionTargetLoadContext): Promise<InteractionTargetData> => {
        const all: DataTable = await executeQueryFactory(topCategories({
            interactionFilters: compiledFilters.getFilters("baseline"),
        }));
        if (isCrossHighlightActive && all.rows.length > 0) {
            const baselineKeys: string = createBaselineKeyFilter(all, {
                CategoryKey: { table: "Product", column: "CategoryKey", dataType: "number" },
            });
            const subset: DataTable = await executeQueryFactory(unrankedCategories({
                interactionFilters: [...compiledFilters.getFilters("highlight"), baselineKeys],
            }));
            return createHighlightData(all, subset, ["CategoryKey"], { Value: 0 }, ["Value"]);
        }
        return { all, highlighted: all };
    },
    [],
);
const result = useManagedInteractionTarget("topCategories", loadData);
```

Memoize the loader and list its app inputs as dependencies; each new loader
identity starts a new load. `executeQueryFactory` uses the same cache and errors
as `useQueryFactoryTarget`; do not call React query hooks from a loader.

The key mapping uses the target query's result aliases. Map every tuple key to its physical model column. Do not infer model identifiers
from aliases or hand-write literals. The resulting query has this shape:

```dax
EVALUATE
SUMMARIZECOLUMNS(
    'Product'[Category],
    TREATAS({ "Bikes", "Accessories" }, 'Product'[Category]),
    TREATAS({ "West" }, 'Geography'[Region]),
    "Sales", [Total Sales]
)
```

For an empty baseline, `createBaselineKeyFilter` returns a filter that matches
nothing; the loader above skips the highlight query instead. The displayed
highlight flag still remains true for an active selection matching no baseline groups.
