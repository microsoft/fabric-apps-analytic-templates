# Managed Visual Interactivity

Use this reference to implement semantic-model-backed visual selections and coordinated behavior. Visual components emit selections and render the tables they receive. For report interactions, an `InteractionManager` from `@microsoft/fabric-interaction-manager` owns the selection state and compiles it into DAX filters for the other visuals' queries.

## Choose the implementation

This file covers manager configuration, source binding, and target capabilities. Read a reference only when the page needs it:

| Behavior | Read |
|---|---|
| Highlight or dim marks inside one chart | [Native selections](native-selections.md) |
| Coordinate the visuals, grids, and slicers on a page | [Interaction Manager](#interaction-manager) below, then [Query factories](query-factories.md) for every target's filter insertion and loading |
| Cross-highlight a bar, column, pie, or donut target | [Highlight queries](highlight-queries.md) |
| Filter a measures-only, columns-only, multiple-base, or Top N query, or one with an outer filter context | [Advanced query shapes](advanced-query-shapes.md) |
| Keep a provided DataGrid total aligned with local filters, including a managed grid | [Filter-aware grid totals](filter-aware-grid-totals.md) |
| Change DAX or a spec from other runtime state | [Query factories](query-factories.md#structural-variants) |
| Publish predicates from a custom control | The installed Interaction Manager package README: sets, ranges, BLANK, dates, text |

Prefer native Vega-Lite behavior for styling that is entirely local to one chart. Route selections that affect other visuals through the Interaction Manager.

The API surface below and the references' examples cover every export a template page needs, so do not search the package's `.d.ts` files.

## API surface

```ts
// Root entry: no React dependency.
import {
    InteractionManager,          // new InteractionManager(configuration: InteractionConfiguration)
    createHighlightData,         // (all, highlightedSubset, groupingFields: readonly string[], missingMeasureReplacementValues: Record<string, number | null>, plottedMeasureFields: readonly string[]) => { all: DataTable; highlighted: DataTable }
} from "@microsoft/fabric-interaction-manager";
import type {
    InteractionConfiguration,    // { semanticModelId: string; fields: Record<string, InteractionField>; components: Record<string, InteractionComponent>; rules?: InteractionRule[] }
    InteractionField,            // { table: string; column: string; dataType: "string" | "number" | "boolean" | "date" | "datetime" }
    InteractionComponent,        // { kind?: "visual" | "grid" | "slicer" | "custom"; selectableFields?: string[]; sourceEffect?: "filter" | "auto"; canFilter?: boolean; canHighlight?: boolean; receivesInteractionsByDefault?: boolean }
    InteractionRule,             // { sourceId: string; targetId: string; targetEffect: "filter" | "highlight" | "none" }
    ManagedQueryFactoryParams,   // { interactionFilters?: readonly string[] }
    InteractionTargetLoadContext,// { isCrossHighlightActive: boolean; compiledFilters: CompiledDaxFilters }
    CompiledDaxFilters,          // getFilters(mode: "baseline" | "highlight"): readonly string[]
    InteractionTargetData,       // DataTable | { all: DataTable; highlighted: DataTable }
    ManagedTargetLoadState,      // loading | ready | refreshing | refresh-error (retained data and error) | error (no data)
    ManagedInteractionSource,    // { selections; selectableFields; onInteraction; error?: Error }
} from "@microsoft/fabric-interaction-manager";

// React entry.
import {
    InteractionManagerProvider,  // <InteractionManagerProvider manager={manager}>
    useManagedInteractionSource, // (sourceId: string) => ManagedInteractionSource
    useManagedInteractionTarget, // (targetId: string, loader: (context: InteractionTargetLoadContext) => Promise<InteractionTargetData>) => ManagedTargetLoadState
    useInteractionManager,       // () => InteractionManager; call .clearAll() to reset every source
} from "@microsoft/fabric-interaction-manager/react";

// Template helpers.
import { useQueryFactoryTarget } from "@/hooks/use-query-factory-target";
// useQueryFactoryTarget(targetId, factory, params, highlightAlignment?: HighlightAlignment) => QueryFactoryTargetState
//   data is DataTable, or { all, highlighted } with highlightAlignment: { groupingFields; missingMeasureReplacementValues; plottedMeasureFields }
import { executeQueryFactory, insertInteractionFilters } from "@/lib/query-factory";
// executeQueryFactory(factory: { connection, query, columnMetadata }): Promise<DataTable>; for custom loaders
// insertInteractionFilters(query, filters, marker, position: "beforeMeasures" | "afterTable"): string
```

Selection types (`SemanticSelection`, `InteractionPredicate`, `InteractionValue`, `RangeBoundary`) and `isDataTable` come from `@microsoft/fabric-visuals-core`.

## Interaction Manager

### Configure the manager

Configure one `InteractionManager` per interaction boundary, at the nearest common host of the coordinated components, and wrap that part of the page in `InteractionManagerProvider`. Create it once with `useState(() => new InteractionManager(configuration))`; configuration is fixed for the manager's lifetime. The installed package README's Configure a manager section lists each component kind's defaults and pair overrides through `rules`; read it only when the page needs to change those defaults.

When writing the configuration for a template page:

- Set `semanticModelId` to the one semantic model whose fields this manager configures.
- Key `fields` by the bracket-free column aliases in query results, and map each to its model table, column, and data type.
- List each source's `selectableFields` explicitly; an omitted list means every configured field. Keep those columns, with their raw model values rather than formatted labels, in the source's data even when hidden.
- Use `kind: "visual"` for charts, `"grid"` for `DataGrid`, and `"slicer"` for slicers. Set `canHighlight` on each visual as described in [Coordinated visuals](#coordinated-visuals).
- For `kind: "custom"` components, including target-only KPIs, explicitly set `sourceEffect` (`"filter"` or `"auto"`), `canFilter`, and `canHighlight`; custom components have no defaults for these three properties.

### Bind sources

Bind each component that has selectable model-field identities as a source. Charts and grids that receive interactions are sources too; slicers and custom controls add sources rather than replacing them:

```tsx
const source = useManagedInteractionSource("salesChart");

<VegaVisual spec={vegaLiteSpec} data={result.data} theme={theme}
    isCrossHighlightActive={result.isCrossHighlightActive}
    selections={source.selections} selectableFields={source.selectableFields}
    onInteraction={source.onInteraction} />
{source.error && <div role="alert">{source.error.message}</div>}
```

- `DataGrid` takes the same source props. Controlled chart selection requires a Vega-Lite spec.
- Each click publishes the component's complete selection. When the manager rejects a selection, it sets `source.error` and keeps the previously accepted selection.
- The manager owns accepted selections. Do not mirror them into component state.
- Slicers only report selections: pass `source.onInteraction` and render `source.error`. Slicers that report interactions reject JavaScript `Date` values, so pass dates as the strings the model returns.
- Clear one source by passing `[{ action: "clear" }]` to its `onInteraction`, or every source with `useInteractionManager().clearAll()`. Controlled components update without raising selection events.

Load every component that receives interactions with `useQueryFactoryTarget`; see [Query factories](query-factories.md). A shared chart or grid wrapper binds both hooks and passes the source props; render target-only components through a separate path.

A component is target-only when its rows have no selectable identities, such as a measures-only grid, or when the user asks for it. Register it with `selectableFields: []`, load it as a target, and render it without source props as shown in [Query factories](query-factories.md#load-the-target).

## Coordinated visuals

- **Cross-filtering** re-evaluates the target under the manager's compiled DAX filters. Do not filter pre-aggregated results in the browser; it cannot recalculate distinct counts, ratios, totals, or selections on unprojected columns. See [Query factories](query-factories.md).
- **Cross-highlighting** keeps the full baseline visible, dimmed, and draws the selected subset bright on top. Re-aggregate the subset at the baseline's grouping, measures, and row set rather than filtering an already aggregated baseline table. See [Highlight queries](highlight-queries.md).
- **Local presentation filters**, such as a search box over loaded grid rows or a Vega-Lite filter inside one unmanaged visual, only restrict displayed rows and can run in the browser. Label any subtotal over locally filtered rows accordingly.

Choose each visual target's `canHighlight` from its mark type and measures:

| Visual | Target configuration |
|---|---|
| Bar and column, including stacked and clustered | Cross-highlight with a highlight alignment; pass the spec unchanged |
| Pie and donut | Cross-highlight when the measures are non-negative and additive; otherwise `canHighlight: false` |
| Line and scatter | `canHighlight: false`; they receive cross-filters |
| Other shapes and layered combinations | `canHighlight: false` unless the target draws its own layers from named data; see [Highlight queries](highlight-queries.md#render-the-target) |

Implement the manager configuration and highlight alignment together. `createHighlightData` falls back to showing the highlighted values as the main values when they cannot be drawn as a part of the baseline, so wire highlighting by visual type without checking each source's relationships or measure definitions.

## Implementation workflow

1. Identify the sources, targets, and each target's behavior from [Coordinated visuals](#coordinated-visuals).
2. Discover the model fields, then register fields and components in one `InteractionManager` at the nearest common host of the coordinated visuals.
3. Read [Query factories](query-factories.md). Accept `ManagedQueryFactoryParams` in each target's query factory and load it with `useQueryFactoryTarget`. Before loading a bar, column, pie, or donut target, read [Highlight queries](highlight-queries.md); for other query shapes, use the table in [Choose the implementation](#choose-the-implementation).
4. Bind every source with `useManagedInteractionSource` and pass its props to the rendered component.
5. Keep showing the previous result while a replacement query is loading.
   A `refresh-error` preserves prior data and its highlight flag; show the error
   and label the retained result as stale. An `error` has no successful data.
6. Verify repeated selection, deselection, empty results, and query failures.
