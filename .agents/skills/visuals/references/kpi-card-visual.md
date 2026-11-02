# KPI Card

A React component for a primary metric, optional change, supporting chart, and
reference metrics, in the fixed order **callout -> visual -> references**.
It wraps itself in a `VisualContainer` by default, like `VegaVisual` and `DataGrid`.
Pass `header` directly to `KpiCard`; no external wrapper is needed.
Use `chromeless` to omit the frame. An existing `VisualContainer` is reused
without adding a second frame; configure that outer container instead.

### Props

Refer to the installed package's public declarations for available component APIs.
This reference covers the KPI-card patterns and constraints needed when building
the template.

Import `KpiCard` and its types from `@microsoft/fabric-visuals`.

Follow [query-design](../../query-design/SKILL.md) for measure selection, grain,
and data preparation, and [DataTable](data-table.md) for column metadata and rows.

### Validation

1. **Query correctness:** Use the
   [DAX validation gates](../../dax-authoring/SKILL.md#testing--iteration) to check every
   callout/change, chart, and reference query, including metric-only cards.
2. **Factory contract:** Callout/change and custom-region-only query factories
   return `{ connection, query, columnMetadata }`. They do not need a Vega-Lite
   `.json` file or `vegaLiteSpec`; do not invent a dummy spec to satisfy a tool.
   A factory supplying an embedded Vega chart also returns `vegaLiteSpec`.
3. **Embedded Vega charts:** Check that the chart renders the query results using
   `npm run validate:visual -- <chart-query-factory.ts> [factory-params-json]`
   for each relevant chart parameter variant. This validator renders Vega only;
   do not run it on spec-less KPI factories or treat its success as validation
   of the callout or custom chart/reference renderers.
4. **Complete card:** After wiring the component, verify rendered metric, change,
   and reference text and formats against the validated live results for every
   included region. Cover null-to-em-dash and real-zero rendering in component
   tests using representative fixtures matching the actual query column shape.
   Query success and prop/spec-shape assertions alone do not validate card output.

### Callout and formatting

Only `theme` and `callout.metric` are required. Obtain metric values and formats
from successful live query results; the host owns query-state handling.

Map the validated metric cell `table.rows[rowIndex][columnIndex]` to
`metricValue` and its matching `table.columns[columnIndex].format` to
`metricFormat`. Select the row and column from the query schema rather than
assuming the first cell is the metric; preserve null values and check the value
type before passing it to `callout.metric`.

```tsx
import { KpiCard } from "@microsoft/fabric-visuals";
import { useThemeContext } from "@/hooks/theme.context";

const { theme } = useThemeContext();

<KpiCard
    header={{ title: "Revenue", subtitle: "Current period" }}
    theme={theme}
    callout={{
        metric: { value: revenueValue, format: revenueColumn.format },
    }}
/>
```

- **Formatting:** Preserve the semantic-model format. Do not guess a currency,
  alter the model, or abbreviate by default. Set `metric.displayUnits: "compact"`
  only when K/M units are explicitly requested.
- **Missing values:** A null metric displays an em dash; a real zero remains zero.
  Do not coerce missing data to zero.
- **Layout:** Omit `callout.layout` for the default wrapping, baseline-aligned row
  of metric, change, and metric subtext. `"change-above"` and `"change-below"`
  put the change on a separate row; the metric and its subtext stay together.
  Do not invent `"single-row"` or `"vertical"` values.
- **Change:** Supply its `value` and caller-resolved `color`; optional fields
  include `format`, `displayUnits`, explanatory `subtext`, and a text/Unicode
  `icon`. Resolve direction and favorable/unfavorable meaning in the app; an
  increase is not always favorable.

### Embedded charts

Use `chart={{ data: trendTable, spec: vegaLiteSpec, theme }}` for a Vega-Lite chart.
It uses the `VegaVisualProps` contract, including the required `theme`, with native
`configVegaLite`, `style`, `className`, `capabilities`, `onEvent`, and `onInteraction`.
Keep formats in `DataTable.columns`; follow the existing
[Vega-Lite](vega-lite-visual.md) and [formatting](formatting.md) guidance.

- Embedded charts are chromeless. Put titles and subtitles in `KpiCard.header`,
  not in the embedded spec. Use the shared [framing props](visual-container.md)
  to style the card's container or disable its Copy action.
- Omit `chart.style.height` for a responsive chart. The visual receives the space
  left by callout and references, with a 100px fallback in content-sized hosts.
  An explicit height remains an override; `"100%"` opts into fill behavior.
  Give the host a definite height for a fixed-height tile.
- Omit absent chart/reference regions rather than adding empty objects or spacers.

### Reference metrics

Interpret the user's request before generating query factories. Include references
only when requested context needs them, such as targets, comparisons, or breakdowns.
Plan their measures, dimensions, grain, period, filters, and formats alongside the
callout and chart; references do not have to summarize or align with the chart.

```tsx
<KpiCard
    theme={theme}
    callout={callout}
    chart={{ data: trendTable, spec: vegaLiteSpec, theme }}
    referenceMetrics={{ dataTable: referenceTable, render: renderReferences }}
/>
```

- **Dedicated input:** Populate `referenceTable` specifically for the requested
  metrics. Do not reuse a chart table instance, wrap it under another name, or
  clone its raw rows. Shared instances are rejected, including within named
  inputs. A separate object alone does not establish correct metrics semantics.
- **Data preparation:** A dedicated table does not necessarily require a separate
  query when the needed metrics are already returned at the correct grain.
  There is no universal reference schema; use the query-design and DataTable
  rules linked above.
- **Scope:** Do not infer reference totals from sampled/top-N chart rows.
  For comparisons, account for filters, transforms, population, and units;
  label intentional differences in period or scope.
- **Binding:** Author `renderReferences` against the supplied table's actual
  columns, not unrelated closed-over data. References work without a chart.
  The component renders supplied content; it does not query data or infer measures.
- **Updates:** Apply filters according to each metric's intended scope. References
  are not automatically selection-aware. Verify rendered values, units, and period
  labels against live results and intended calculations after data/filter changes.

### Theming and accessibility

Pass the resolved `theme` from `useThemeContext()` to both `KpiCard` and its
`chart.theme`. Custom renderers receive that same theme; use it or inherited card
tokens instead of introducing an independent palette.

- Callout typography uses `--font-numeric`, `--text-600` (24px default), and
  `--font-weight-bold`, not container-title typography. Scope token overrides and
  expose editing UX when adding tokens.
- The change value/icon uses a tinted badge; its explanation stays outside.
  Container padding belongs to `VisualContainer`, not another inner wrapper.
- The card generates an accessible name from formatted callout text when
  `ariaLabel` is omitted or blank. Supply a descriptive override when needed.
  Icons are decorative and excluded from the generated name; provide meaningful
  change text rather than relying on icons or color alone.
- Custom content owns semantic markup, keyboard/focus behavior, contrast,
  resizing, and reduced-motion support. Check wrapping and light/dark/forced colors.

### Custom rendering

Custom charts and references use `CardCustomContent`, pairing their own
`dataTable` with a `render` callback. There is no card-level `dataTable`.
Callbacks receive `(dataTable, theme)` and return React nodes.

The following child components are app-defined against the actual query schemas:

```tsx
<KpiCard
    theme={theme}
    callout={callout}
    chart={{
        dataTable: trendTable,
        render: (table, callbackTheme) => <CustomChart data={table} theme={callbackTheme} />,
    }}
    referenceMetrics={{
        dataTable: referenceTable,
        render: (table, callbackTheme) => <ReferenceList data={table} theme={callbackTheme} />,
    }}
/>
```

Each input can be a `DataTable` or `Record<string, DataTable>`, for example
`dataTable: { target: targetTable, comparison: comparisonTable }`. Keep callbacks
pure, use shared formatting helpers, fetch in the host, and put hooks
in child components. Custom charts must resize within the flexible visual region;
reference content keeps its natural height.

### When to use a custom card

Use custom app code for reordered/side-by-side regions, flexible grids, in-card
slicers/navigation, descriptive icons, footers, or unsupported styling. Do not
contort the component API to fit. Keep app filters outside the card and titles
in `KpiCard.header`; omit optional regions when they are not needed.
