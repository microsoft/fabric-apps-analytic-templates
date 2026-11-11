---
name: visuals
description: >
  Use when user wants to incorporate charts, graphs, KPI cards, data grids, slicers,
  or other visual representations of data into their project.
  Use VegaVisual, KpiCard and DataGrid components to create these visuals,
  utilizing shared data contracts, formatting, theme, and interactivity.
  Covers controlled selections, selectableFields and onInteraction source props, named
  multi-table data input for layered overlays and reference lines, and
  Vega-Lite native selections. Triggers: chart, graph, plot, dashboard, KPI,
  metric, trend, scorecard, data grid, visualize.
---

# Visuals

## Types of visuals

There are 4 different types of visuals that can be used in a project:
1. Charts and Graphs: These are used to represent data in a visual format, such as bar charts, line charts, pie charts, etc. These are built using vega-lite, see [references/vega-lite-visual.md](references/vega-lite-visual.md) for more details.
2. Data Grids: These are used to display tabular data in a structured format, allowing for sorting, filtering, and pagination. See [references/data-grid-visual.md](references/data-grid-visual.md) for more details.
3. Slicers: Prefer built-in components for app/page filtering. Read the installed `@microsoft/fabric-slicers` README for component selection and usage.
4. KPI Cards: Use `KpiCard` for a primary metric, optional change, supporting chart and reference metrics. See [KPI card authoring](references/kpi-card-visual.md).

## Packages & Imports

The visual components and data contracts are provided by four packages. **Always use these package imports when creating visuals.**

| Package | Primary exports | Example import |
|---|---|---|
| `@microsoft/fabric-visuals` | `VegaVisual`, `KpiCard`, types: `VisualizationSpec`, `VegaLiteConfig`, `VegaVisualProps` | `import { VegaVisual, KpiCard } from "@microsoft/fabric-visuals"` |
| `@microsoft/fabric-datagrid` | `DataGrid`, types: `GridColumnDef`, `Row`, `CellValue`, `DataGridProps`, `DataGridTheme`, `SortConfig` | `import { DataGrid } from "@microsoft/fabric-datagrid"` |
| `@microsoft/fabric-slicers` | `DropdownSlicer`, `ListSlicer`, `DateSlicer`, `RangeSlicer` | `import { DropdownSlicer } from "@microsoft/fabric-slicers"` |
| `@microsoft/fabric-visuals-core` | `isDataTable`, `convertDataTableToRows`, design tokens | `import { isDataTable } from "@microsoft/fabric-visuals-core"` |

The `DataTable` type (used by both components) is defined in `@microsoft/fabric-visuals-core` and re-exported by the visual packages' type definitions.

## Data Format

The chart and data grid components share a unified `data` prop of type `DataTable` (from `@microsoft/fabric-visuals-core`). This structured format carries column metadata (`displayName`, `format`, `semanticType`) that the components use for axis titles, grid headers, number formatting, and tooltips.

`KpiCard` takes scalar callout values and optional chart/reference tables, not a
card-level `data` prop. Follow the [KPI card reference](references/kpi-card-visual.md).

**Using `DataTable`**: Pass a `DataTable` via the `data` prop. The visual uses its column metadata for formatting, axis titles, and tooltips.

**From a query result**: the pack copies in `toDataTable()` at
`src/lib/to-data-table.ts` relative to the frontend, which merges a query's table with the
`columnMetadata` its factory exports to produce a `DataTable`. Its parameter is
`QueryTableLike` — `{ columns: { name }[], rows }` — which the Fabric SDK's
`QueryTable` satisfies, so it accepts a semantic-model result without this pack
depending on the `analytics` one.

**Inline spec data — Vega-Lite only**: the `data` prop takes a `DataTable`
whatever the rows are, query results and static rows alike, and for `DataGrid` it
is the only option. A Vega-Lite spec additionally accepts its own
`data: { values: [...] }`, with the `data` prop omitted. That second form
discards the `DataTable` metadata — `displayName`, `format` and `semanticType` —
so axis titles and number formatting have to be part of the Vega-Lite spec; prefer the prop
whenever that metadata exists, which is normally the case for anything a query
returned.

**Multiple tables in one visual**: the `data` prop also accepts a `Record<string, DataTable>` for specs that bind separate layers to more than one dataset by name such as layered overlays, reference lines, and axis spines. See [references/multi-data-input.md](references/multi-data-input.md).

```tsx
import { VegaVisual, useCssTheme } from "@microsoft/fabric-visuals";
import type { VisualizationSpec } from "@microsoft/fabric-visuals";
import { DataGrid } from "@microsoft/fabric-datagrid";
import type { DataTable } from "@microsoft/fabric-visuals-core";

// useCssTheme() reads --color-* vars from the page and updates automatically
// when the theme changes (e.g. dark-mode toggle adds/removes the .dark class).
const theme = useCssTheme();

// Charts — pass a DataTable and Vega-Lite spec
<VegaVisual spec={vegaLiteSpec} data={dataTable} theme={theme} />

// Grids — displayName becomes column headers, format applies to cells
<DataGrid data={dataTable} theme={theme} />

// Inline spec data — Vega-Lite only, no data prop needed
const inlineSpec: VisualizationSpec = {
  data: { values: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
  mark: "point",
  encoding: { ... },
};

<VegaVisual spec={inlineSpec} theme={theme} />
```

**Type every spec you write**, with `VisualizationSpec` from
`@microsoft/fabric-visuals` — on the constant, or as `useMemo<VisualizationSpec>`
when it is built per render. Without the annotation the object widens (`type:
"nominal"` becomes `string`) and the compiler stops checking the parts that
matter. With it, build the spec however the chart needs — from a filter
selection, a theme token, whatever — and the template's TypeScript gate still checks the
mark, encoding and field shapes.

Follow the consuming app's visual validation instructions. Type checks or spec
shape checks alone do not prove that the visual renders meaningful marks.

For the `DataTable` schema and `ColumnDef` fields, see [references/data-table.md](references/data-table.md).

## Formatting & Theme

- **Formatting rules**: Number formatting, color palettes, chart-specific encoding rules, highlighting guidelines, and a default theme. See [references/formatting.md](references/formatting.md).

## Custom visuals

Always use the above mentioned ways to create visual when possible. If the user's request doesn't allow creation using the above methods, ask the user if they are ok with using another library for creating the visual. If they are ok with it, use the library to create the visual. If they are not ok with it, then build that visual from scratch using HTML, CSS, and JS/TS. Make sure to ask the user for any specific requirements they have for the visual, such as colors, labels, etc.

## Container Layout

`VegaVisual`, `DataGrid` and `KpiCard` frame themselves in a VisualContainer by default.
Pass `header={{ title, subtitle }}` rather than drawing a second header/card.
Copy Visual is built in. See [visual-container.md](references/visual-container.md).
Give virtualized grids a definite height; the grid scrolls its own rows, so do
not add an unnecessary outer `overflow-auto`.

## Field names and grid totals

Key `columnMetadata` by exact raw query output names such as `Calendar[Year]`.
Give each entry a bracket-free `name` alias such as `Year`, and use that alias
in encodings. Dots and brackets in raw names can otherwise render `undefined`.
Calendar years used as ordered categories are `ordinal`, not measured quantities.
For pies/donuts with built-in labels, use `legend: null` to avoid redundant legends.

Use `toRollupDataTables()` to split a `ROLLUPADDISSUBTOTAL` result into
`bodyTable` and `grandTotalTable`; pass the latter through `grandTotals.data`.
Computed totals are an alternative only for additive sums or counts of fetched
leaf rows. See [multi-grain patterns](../query-design/references/multi-grain-patterns.md).

## Interactivity

Both `VegaVisual` and `DataGrid` expose `selections`, `selectableFields` and
`onInteraction` selection props. For app-owned records, implement any requested
coordination through app-owned selection and filtering state; do not introduce
a semantic model or DAX just to coordinate record-backed charts.

For semantic-model-backed components, follow the `visual-interactivity` skill's
coordination policy and
[Interaction Manager](../visual-interactivity/references/interaction-manager.md) reference.

**Key concepts**:
- Clicking a different data point emits a new `select` (replaces the prior selection — no preceding `clear`).
- Re-clicking the same item or background space in a vega-lite visual emits `clear`.

## Data-app visuals instructions

These data-app-specific validation and theme instructions supplement the shared
visuals guidance above.

### Data-app visual validation

After completing each single-table VegaVisual query factory or KPI embedded
Vega-chart factory, and before UX design, `src/global.css`, or component work, run:

```sh
npm run validate:visual -- <query-factory.ts> [factory-params-json] [<query-factory.ts> [factory-params-json] ...]
```

Repeat factory paths for relevant parameter variants; validate completed factories
in one command when possible. Run directly without a pipe hiding failures.
The template's local validator executes DAX through a signed-in connector,
renders headlessly, fails on zero visible marks, and checks at most the first
1,000 rows. Do not broaden its input contract to inline rows or several named
tables. Use browser checks for flows outside that contract. Do not proceed until
required results pass.

Spec-less KPI callout, change and custom-region factories cannot use this
Vega validator. Follow the shared KPI reference's DAX validation and rendered-card
checks instead; do not invent a dummy Vega spec to pass validation.

### Local visual types and context

For KPI cards, follow the shared [KPI card authoring](references/kpi-card-visual.md).
For Flint specifications, follow [Flint spec authoring](data-app/flint-authoring.md).

Follow [app-design](../app-design/SKILL.md) for presentation and
[visual-interactivity](../visual-interactivity/SKILL.md) for the template's
managed interactions, query factories, highlighting and grid totals.
Use the resolved `useThemeContext().theme` from the local theme hook.
It derives from the same source as the shared examples' `useCssTheme()`.

### VisualContainer defaults for every visual

Follow the shared [container reference](references/visual-container.md)
for framing and actions; KPI-specific framing is documented in the shared KPI reference.
