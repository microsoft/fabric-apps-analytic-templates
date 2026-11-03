# Highlight Queries

Cross-highlighting keeps the baseline visible and draws a re-aggregated subset
over it. Load both with `useQueryFactoryTarget` and a highlight alignment, then
pass them to `VegaVisual` with the target's existing spec. This extends the
filter-only target in [query factories](query-factories.md#load-the-target).

## Load and align

Pass the `createHighlightData` settings as the hook's fourth argument. During an
active cross-highlight, the hook runs the factory under the baseline and
highlight filters and aligns the subset with the baseline. Otherwise it runs
only the baseline and returns it as both datasets.

```ts
import type { HighlightAlignment } from "@/hooks/use-query-factory-target";

const categoryAlignment: HighlightAlignment = {
    groupingFields: ["Category"],
    missingMeasureReplacementValues: { Value: 0 },
    plottedMeasureFields: ["Value"],
};
```

When writing the alignment:

- List every group and series key in `groupingFields`, including hidden
  identifiers. Alignment uses raw key values; never substitute localized display
  labels. A series field requires alignment by both category and series.
- Alignment throws on duplicate tuples and on subset tuples outside the baseline.
- In `missingMeasureReplacementValues`, give each measure the value for a baseline
  group absent from the subset: `0` when absence means zero, as for sums and
  counts, or `null` to keep BLANK, as for ratios.
- List the measures the chart draws in `plottedMeasureFields`.

For Top N, do not rerun the ranking under highlight filters; see
[Top N highlight targets](advanced-query-shapes.md#top-n-highlight-targets).

## Render the target

Pass the target's existing spec unchanged. Do not author overlay layers, sort
fields, or radius calculations. Bind the source and target beneath the same
provider and call all hooks before early returns:

```tsx
const source = useManagedInteractionSource("categoryChart");
const result = useQueryFactoryTarget("categoryChart", categoryChart, {}, categoryAlignment);
const { theme } = useThemeContext();
if (result.status === "loading") return <div>Loading...</div>;
if (result.status === "error") return <div role="alert">{result.error.message}</div>;

return <>
    {source.error && <div role="alert">{source.error.message}</div>}
    <VegaVisual
        spec={vegaLiteSpec}
        data={result.data}
        isCrossHighlightActive={result.isCrossHighlightActive}
        selections={source.selections}
        selectableFields={source.selectableFields}
        onInteraction={source.onInteraction}
        theme={theme}
    />
    {result.status === "refreshing" && <div role="status">Refreshing...</div>}
</>;
```

Always pass `result.data` with `result.isCrossHighlightActive` from the same
result; while refreshing, both still describe the displayed load.

With an active highlight, `VegaVisual` dims the baseline and draws the
highlighted values on top; generated data labels stay on the baseline values.
If it reports a cross-highlight diagnostic and renders only the highlighted rows,
check the supported shapes in the README's
[Cross-highlight overlays](../../../../node_modules/@microsoft/fabric-interaction-manager/README.md#cross-highlight-overlays),
then simplify the spec to a supported shape or set `canHighlight: false`.

A spec that references named datasets receives `all` and `highlighted` and draws
its own layers instead. Use this only when a highlight target needs layers the
automatic overlay cannot draw, and verify that the layers keep the baseline
geometry. See the visuals skill's
[multi-data input](../../visuals/references/multi-data-input.md) for named data.