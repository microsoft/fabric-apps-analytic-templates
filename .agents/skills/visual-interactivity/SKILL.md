---
name: visual-interactivity
description: >
  Implements visual selections and coordinated visual behavior.
  Covers Vega-Lite native selections, VegaVisual and DataGrid interaction
  events, cross-filtering, cross-highlighting, filter-aware grid totals,
  and parameterized query factories for runtime visual state.
---

# Visual Interactivity

Use this skill to implement visual selections and coordinated behavior. Visual components emit selections and render the tables they receive; the host application owns the state and decides how other visuals or queries respond.

## Choose the smallest interaction

| Behavior | Implementation |
|---|---|
| Highlight or dim marks inside one chart | Vega-Lite native selection; see [Native selections](references/native-selections.md) |
| Let application code consume a visual selection | `onInteraction` |
| Remove or narrow rows in another visual | Cross-filtering; see [Filter strategy](references/filter-strategy.md) |
| Keep the full baseline visible and emphasize a selected subset | Cross-highlighting; see [Highlight queries](references/highlight-queries.md) |
| Change DAX or a spec from runtime state | Parameterized query factory; see [Query factories](references/query-factories.md) |
| Keep a provided DataGrid total aligned with local filters | See [Filter-aware grid totals](references/filter-aware-grid-totals.md) |

Prefer native Vega-Lite behavior for styling that is entirely local to one chart. Handle host-consumable selections through `onInteraction`.

## Host-consumable interaction events

Both `VegaVisual` and `DataGrid` expose an `onInteraction` prop that emits structured, predicate-based events when the user clicks a data point or row. The component emits the selection; the host decides what to update.

```tsx
import type { InteractionEvent } from "@microsoft/fabric-visuals-core";

function handleInteraction(source: string, events: InteractionEvent[]): void {
    for (const event of events) {
        if (event.action === "select") {
            // event.selections describes the clicked data as predicates
        } else if (event.action === "clear") {
            // user deselected by re-clicking the same item or clicking empty space
        }
    }
}

<VegaVisual
    spec={vegaLiteSpec}
    data={dataTable}
    theme={theme}
    onInteraction={(events) => handleInteraction("salesChart", events)}
/>
<DataGrid
    data={dataTable}
    theme={theme}
    onInteraction={(events) => handleInteraction("detailTable", events)}
/>
```

Key event behavior:

- Clicking a different data point emits a new `select`, replacing the prior selection without a preceding `clear`.
- Re-clicking the same item or clicking background space in a Vega-Lite visual emits `clear`.
- Predicates include all fields from the datum; consumers select only the fields relevant to the target behavior.

## Coordinated visuals

Keep selection state in the host component and derive target data from that state. Do not make visual components mutate each other directly.

- **Cross-filtering** removes or narrows non-matching rows in another visual. Decide whether to filter a low-cardinality result in TypeScript or push the filter into DAX and re-query. See [Filter strategy](references/filter-strategy.md).
- **Cross-highlighting** keeps the full baseline visible, dimmed, and draws the selected subset bright on top. Re-aggregate the subset at the baseline's grouping, measures, and row set rather than filtering an already aggregated baseline table. See [Highlight queries](references/highlight-queries.md).

`VegaVisual` can draw coordinated layers from a named `Record<string, DataTable>`, such as `data={{ all, highlighted }}`. The component renders the tables it receives; the host remains responsible for deriving them. See the visuals skill's [multi-table input](../visuals/references/multi-data-input.md) reference.

## Query factories

Parameterize a query factory when runtime state must change the query or spec. Keep factories without runtime inputs parameterless.

Factories must:

- Import every base query from a `.dax` file.
- Accept typed, use-case-specific interaction state.
- Return `connection`, `query`, `columnMetadata`, and `vegaLiteSpec`.
- Map only known field or column identifiers; never interpolate arbitrary identifiers.
- Escape runtime values before inserting them into DAX.
- Keep structural query variants in separate `.dax` files.

Follow [Query factories](references/query-factories.md) for file organization and examples.

For a DataGrid with provided totals, follow [Filter-aware grid totals](references/filter-aware-grid-totals.md). Keep the complete body table available for DataGrid's local filtering while applying those filters only to the authoritative total.

## Implementation workflow

1. Identify the source event and the exact target behavior.
2. Choose native selection, client-side filtering, server-side filtering, or aligned cross-highlighting.
3. Add state only at the nearest common host of the coordinated visuals.
4. Parameterize a query factory only if that state changes DAX or a spec.
5. Preserve the previous rendered result while a replacement query is loading.
6. Handle `select` and `clear`, then verify repeated selection, deselection, empty results, and query failures.
