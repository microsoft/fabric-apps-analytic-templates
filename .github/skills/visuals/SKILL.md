---
name: visuals
description: Use when user wants to incorporate charts, graphs, data grid, or other visual representations of data into their project.
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

**Power BI query results → `data` prop** (standard pattern): use `toDataTable()` from `@/lib/to-data-table` to convert SDK results into a `DataTable`, then pass it via the `data` prop. The `DataTable` carries column metadata that the visual uses for formatting.

**Static/inline data → `data` in spec**: for static data, transformed data, or plain arrays, put `data: { values: [...] }` directly in the Vega-Lite spec and omit the `data` prop.

```tsx
import { revenueByRegion } from "@/queries/sales/revenue-by-region";
import { toDataTable } from "@/lib/to-data-table";
import { useSemanticModelQuery } from "@/hooks/use-semantic-model-query";
import { VegaVisual, useCssTheme } from "@microsoft/fabric-visuals";
import { DataGrid } from "@microsoft/fabric-datagrid";

// Call the factory function — optionally pass semantic filters
const { connection, query, columnMetadata, vegaLiteSpec } = revenueByRegion();
const { data } = useSemanticModelQuery({ connection, query });

// useCssTheme() reads --color-* vars from global.css and updates automatically
// when the theme changes (e.g. dark-mode toggle adds/removes the .dark class).
const theme = useCssTheme();

if (data?.status === "success") {
  const dataTable = toDataTable(data.table, columnMetadata);

  // Charts — metadata flows to axis titles, tooltips, formatting
  <VegaVisual spec={vegaLiteSpec} data={dataTable} theme={theme} />

  // Grids — displayName becomes column headers, format applies to cells
  <DataGrid data={dataTable} theme={theme} />
}

// With parameters — each factory function defines its own parameter shape
const viz = revenueByRegion({
  categories: ["Electronics"],
  minRevenue: 1000,
});
const { data: filtered } = useSemanticModelQuery({
  connection: viz.connection,
  query: viz.query,
});

// Static/inline data — no data prop needed
const inlineSpec = {
  data: { values: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
  mark: "point",
  encoding: { ... },
};

<VegaVisual spec={inlineSpec} theme={theme} />
```

For the `DataTable` schema and `ColumnDef` fields, see [references/data-table.md](references/data-table.md).

## Formatting & Theme
- **Formatting rules**: Number formatting, color palettes, chart-specific encoding rules, highlighting guidelines, and a default theme. See [references/formatting.md](references/formatting.md).

## Spec Placement

**Always define Vega-Lite specs as `.json` files in `src/queries/`, alongside their `.dax` query file** — never inline in component files. A barrel `.ts` file imports both and re-exports them. See the "Query & Spec Organization" section in `copilot-instructions.md` for the full convention.

## Custom visuals
Always use the above mentioned ways to create visual when possible. If the user's request doesn't allow creation using the above methods, ask the user if they are ok with using another library for creating the visual. If they are ok with it, use the library to create the visual. If they are not ok with it, then build that visual from scratch using HTML, CSS, and JS/TS. Make sure to ask the user for any specific requirements they have for the visual, such as colors, labels, etc.

## Container Layout

- **`DataGrid`** — the direct parent must apply `overflow-auto` so content remains scrollable when it exceeds the container bounds (many rows).