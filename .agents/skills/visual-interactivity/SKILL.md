---
name: visual-interactivity
description: >
  Coordinates Power BI semantic-model-backed visuals, grids and slicers through
  the Interaction Manager. Use for managed selections, cross-filtering,
  cross-highlighting, filter-aware grid totals and runtime DAX query factories.
---

# Visual Interactivity

Use this skill for coordinated semantic-model interactions. Visual components
emit selections and render their supplied tables; the Interaction Manager owns
accepted selections and compiles them into DAX filters.
The consuming template owns execution caching, client/bootstrap wiring and UI sequencing.

## Managed semantic-model interactions

Semantic-model-backed components on a page interact by default. When a page has
more than one semantic-model-backed visual, grid or slicer, wire those components
through one Interaction Manager even when the user did not explicitly request
interactions. Preserve both source wiring and the appropriate cross-highlight
or cross-filter behavior.

Record-backed components do not participate in this default. On mixed pages,
do not wire unrelated record-backed visuals into semantic-model coordination.

Both `VegaVisual` and `DataGrid` expose selection props. Bind them to the
manager-owned source; do not mirror accepted selections into local state.
Register raw model identity fields through `selectableFields` and preserve every
complete compiled filter argument without extracting, splitting or dropping predicates.

## Implementation workflow

1. Identify the semantic model, selectable field identities, sources and targets.
   For purely chart-local emphasis, use [native selections](references/native-selections.md).
2. Configure one manager per interaction boundary and wrap the coordinated
   components in its provider. Follow [manager configuration](references/interaction-manager.md#configure-the-manager)
   and choose each target's capabilities from [coordinated visuals](references/interaction-manager.md#coordinated-visuals).
3. Bind selectable sources with `useManagedInteractionSource` and load receiving
   targets with `useQueryFactoryTarget`. Follow [source binding](references/interaction-manager.md#bind-sources)
   and [query factories](references/query-factories.md). Target-only components use
   `selectableFields: []` and do not receive source props; see
   [target-only components](references/query-factories.md#target-only-components).
4. Configure [highlight alignment](references/highlight-queries.md) for supported
   targets. Pass aligned tables and their highlight flag together, with the existing
   spec unchanged. For Top N or other non-grouped queries, follow
   [advanced query shapes](references/advanced-query-shapes.md).
5. Keep body rows and provided totals together using
   [filter-aware grid totals](references/filter-aware-grid-totals.md).
   On `refresh-error`, show the diagnostic and label retained data as stale.
   With no previous data, explain that the visual could not load. Follow
   [loading and failure guidance](references/query-factories.md#present-loading-and-failures).
6. Verify repeated selection, deselection, empty results and query failures in the implementation.
   Preserve the consuming template's resolved theme and runtime conventions.
   Interaction tests are an optional follow-up on user request.

## Reference materials

Read only the references needed for the page:

| Topic | Reference |
|---|---|
| API surface, manager configuration, source binding and target capabilities | [Interaction Manager](references/interaction-manager.md) |
| Runtime variants, complete DAX filters and target loading | [Query factories](references/query-factories.md) |
| Baseline/subset alignment and rendering | [Highlight queries](references/highlight-queries.md) |
| Measures-only, multiple-base, outer-context and Top N queries | [Advanced query shapes](references/advanced-query-shapes.md) |
| DataGrid local filters and provided totals | [Filter-aware grid totals](references/filter-aware-grid-totals.md) |
| Chart-local click and hover emphasis | [Native selections](references/native-selections.md) |

## Data-app throttling feedback

These data-app-specific instructions supplement the shared loading and failure
guidance above.

Detect throttling with `isThrottlingError` from `@/lib/semantic-model-errors`.
When `result.status === "refresh-error"` and `isThrottlingError(result.error)`,
keep the previous visual visible and show a persistent, accessible warning
beside it. Explain that the update was throttled and the retained results do
not reflect the latest interaction. Keep the warning visible until a successful
replacement load; do not rely on a transient toast.

Keep the retained data and its highlight flag together, and preserve accepted
selections. With no previous data, explain that the visual could not load
instead of rendering a successful result.
