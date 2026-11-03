---
name: visual-interactivity
description: >
  Implements VegaVisual and DataGrid interactions: native Vega-Lite selections,
  onInteraction events, cross-filtering, cross-highlighting, filter-aware totals,
  and parameterized query factories.
---

# Visual Interactivity

Visuals emit selections and render supplied tables. The host owns selection state and decides how other visuals and queries respond.

## Choose the smallest interaction

| Behavior | Implementation |
|---|---|
| Restyle marks within one chart | [Native selections](references/native-selections.md) |
| Consume selections in application code | [`onInteraction`](#handle-selections) |
| Narrow rows in another visual | [Cross-filtering](references/filter-strategy.md) |
| Overlay a selected subset on the full baseline | [Cross-highlighting](references/highlight-queries.md) |
| Change DAX or a spec from runtime state | [Query factories](references/query-factories.md) |
| Update provided DataGrid totals after local filtering | [Filter-aware totals](references/filter-aware-grid-totals.md) |

## Handle selections

`VegaVisual` and `DataGrid` emit predicate-based `InteractionEvent[]` through `onInteraction`. For a single selection source, store its predicates in the host:

```tsx
import { useState } from "react";
import type { DataPointSelection, InteractionEvent } from "@microsoft/fabric-visuals-core";

const [selections, setSelections] = useState<DataPointSelection[] | null>(null);

function handleInteraction(events: InteractionEvent[]): void {
    for (const event of events) {
        setSelections(event.action === "select" ? event.selections : null);
    }
}

<VegaVisual spec={vegaLiteSpec} data={dataTable} theme={theme} onInteraction={handleInteraction} />
```

- A new `select` replaces the previous selection without a preceding `clear`.
- Re-clicking the same item, or clicking Vega-Lite background space, emits `clear`.
- Predicates include all datum fields; use only those relevant to the target.

Track the source alongside the selection when multiple visuals emit events.

## Implementation workflow

1. Identify the source and target behavior; choose the smallest interaction above.
2. Keep shared state in the nearest common host and derive target tables; never mutate another visual directly.
3. Parameterize a query factory only when state changes DAX or a spec.
4. Preserve the last successful render while replacement queries load; surface failures.
5. Verify selection replacement, repeated clicks, clearing, empty results, and query failures.
