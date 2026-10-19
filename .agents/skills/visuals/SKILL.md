---
name: visuals
description: >
  Use when user wants to incorporate charts, graphs, data grid, 
  or other visual representations of data into their project.
  Use VegaVisual and DataGrid components to create these visuals, 
  utilizing the shared DataTable input, formatting, and theme.
  Covers the VisualContainer chrome every visual gets by default,
  plus named multi-table data input for layered overlays and reference lines.
---

# Visuals

## Types of visuals
There are 2 different types of visuals that can be used in a project:
1. Charts and Graphs: These are used to represent data in a visual format, such as bar charts, line charts, pie charts, etc. These are built using vega-lite, see [references/vega-lite-visual.md](references/vega-lite-visual.md) for more details.
2. Data Grids: These are used to display tabular data in a structured format, allowing for sorting, filtering, and pagination. See [references/data-grid-visual.md](references/data-grid-visual.md) for more details.

## Packages & Imports

The visual components are provided by three packages. **Always use these package imports when creating visuals.**

| Package | Primary exports | Example import |
|---|---|---|
| `@microsoft/fabric-visuals` | `VegaVisual`, types: `VisualizationSpec`, `VegaLiteConfig`, `VegaVisualProps` | `import { VegaVisual } from "@microsoft/fabric-visuals"` |
| `@microsoft/fabric-datagrid` | `DataGrid`, types: `GridColumnDef`, `Row`, `CellValue`, `DataGridProps`, `DataGridTheme`, `SortConfig` | `import { DataGrid } from "@microsoft/fabric-datagrid"` |
| `@microsoft/fabric-visuals-core` | `isDataTable`, `convertDataTableToRows`, design tokens | `import { isDataTable } from "@microsoft/fabric-visuals-core"` |

The `DataTable` type (used by both components) is defined in `@microsoft/fabric-visuals-core` and re-exported by the visual packages' type definitions.

## Data Format
The chart and data grid components share a unified `data` prop of type `DataTable` (from `@microsoft/fabric-visuals-core`). This structured format carries column metadata (`displayName`, `format`, `semanticType`) that the components use for axis titles, grid headers, number formatting, and tooltips.

**Using `DataTable`**: Pass a `DataTable` via the `data` prop. The visual uses its column metadata for formatting, axis titles, and tooltips.

**Static/inline data**: For static data, transformed data, or plain arrays, put `data: { values: [...] }` directly in the Vega-Lite spec and omit the `data` prop.

**Multiple tables in one visual**: the `data` prop also accepts a `Record<string, DataTable>` for specs that bind separate layers to more than one dataset by name such as layered overlays, reference lines, and axis spines. See [references/multi-data-input.md](references/multi-data-input.md).

```tsx
import { useThemeContext } from "@/hooks/theme.context";
import { VegaVisual } from "@microsoft/fabric-visuals";
import { DataGrid } from "@microsoft/fabric-datagrid";
import type { DataTable } from "@microsoft/fabric-visuals-core";

const { theme } = useThemeContext();

// Charts — pass a DataTable and Vega-Lite spec
<VegaVisual spec={vegaLiteSpec} data={dataTable} theme={theme} />

// Grids — displayName becomes column headers, format applies to cells
<DataGrid data={dataTable} theme={theme} />

// Static/inline data — no data prop needed
const inlineSpec = {
  data: { values: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
  mark: "point",
  encoding: { ... },
};

<VegaVisual spec={inlineSpec} theme={theme} />
```

For the `DataTable` schema and `ColumnDef` fields, see [references/data-table.md](references/data-table.md).

## VisualContainer defaults for every visual

`VegaVisual` and `DataGrid` wrap **themselves** in a `VisualContainer` by default. The container draws the chrome — border, padding, header (title/subtitle) — plus its built-in actions, all enabled by default. Do not add a wrapper of your own unless absolutely required.

```tsx
<VegaVisual
    spec={vegaLiteSpec}
    data={dataTable}
    theme={theme}
    header={{ title: "Revenue by Region", subtitle: "Last 12 months" }}
/>

<DataGrid data={dataTable} theme={theme} header={{ title: "Top Products" }} />
```

Anything the default container doesn't cover — custom actions, programmatic capture, the same chrome around a non-visual etc: [references/visual-container.md](references/visual-container.md).

## Formatting & Theme
- **Encoding semantics**: Choose encoding types by field meaning, not storage type. Use `ordinal` for integer years shown as ordered categories, `nominal` for identifiers, `quantitative` for measured quantities, and `temporal` for actual date/time values. See [Encoding Type Selection](references/vega-lite-visual.md#encoding-type-selection) for examples and continuous-time guidance.
- **Formatting rules**: Number formatting, color palettes, chart-specific encoding rules, highlighting guidelines, and a default theme. See [references/formatting.md](references/formatting.md).

## Custom visuals
Always use the above mentioned ways to create visual when possible. If the user's request doesn't allow creation using the above methods, ask the user if they are ok with using another library for creating the visual. If they are ok with it, use the library to create the visual. If they are not ok with it, then build that visual from scratch using HTML, CSS, and JS/TS. Make sure to ask the user for any specific requirements they have for the visual, such as colors, labels, etc.

## Interactivity

**Always use the `onInteraction` prop** on `VegaVisual` and `DataGrid` to surface user selections. Follow the [visual-interactivity](../visual-interactivity/SKILL.md) skill for event handling, native Vega-Lite selections, coordinated filtering and highlighting, filter-aware grid totals, and parameterized query factories.
