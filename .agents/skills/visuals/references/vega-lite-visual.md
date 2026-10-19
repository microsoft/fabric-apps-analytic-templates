# Vega-Lite Visual

A React component from the `@microsoft/fabric-visuals` package for rendering Vega-Lite visuals.

```tsx
import type { DataTable } from "@microsoft/fabric-visuals-core";
import { useThemeContext } from "@/hooks/theme.context";
import { VegaVisual } from "@microsoft/fabric-visuals";
import type { VisualizationSpec, VegaLiteConfig } from "@microsoft/fabric-visuals";

const { theme } = useThemeContext();

const spec: VisualizationSpec = {
  $schema: "https://vega.github.io/schema/vega-lite/v6.json",
  description: "An example vega-lite spec",
  data: { }, // filled in by the `DataTable` below
  mark: "bar",
  encoding: {
    x: { field: "category", type: "nominal" },
    y: { field: "value", type: "quantitative" },
  },
};

const data: DataTable = {
  columns: [
    { name: "category", displayName: "Category" },
    { name: "value", displayName: "Value" },
  ],
  rows: [
    ["A", 28],
    ["B", 55],
    ["C", 43],
  ]
}

<VegaVisual
  spec={spec}
  data={data}
  theme={theme}
  style={{ height: 400 }}
  header={{ title: "Revenue by Region", subtitle: "Last 12 months" }}
/>
```

## Valid spec structures

### Use a unit spec for a single mark

```json
{
  "mark": "bar",
  "encoding": {
    "x": { "field": "category", "type": "nominal" },
    "y": { "field": "value", "type": "quantitative" }
  }
}
```

### Use `layer` for composite visuals

When you need multiple marks (e.g., bars with text labels), put **all** marks inside the `layer` array. An optional shared `encoding` at the same level as `layer` is inherited by every layer entry, so you only need to specify mark-specific encodings inside each entry:

```json
{
  "encoding": {
    "x": { "field": "category", "type": "nominal" },
    "y": { "field": "value", "type": "quantitative" }
  },
  "layer": [
    {
      "mark": "bar"
    },
    {
      "mark": { "type": "text", "align": "center", "dy": -5 },
      "encoding": {
        "text": { "field": "value", "type": "quantitative" }
      }
    }
  ]
}
```

### Rules

1. **Never combine `mark` with `layer`** at the same level.
2. **Each layer entry must define a valid spec at its own level** — it may be a unit spec with its own `mark` (and optional `encoding`), or a nested composition such as another `layer` spec.

## Field names

`field` values must match `ColumnDef.name` from the `DataTable` — **not** the raw DAX column
name. Vega-Lite parses `.`, `[`, and `]` in a `field` string as nested-property and array
accessors, so a raw DAX name such as `Store[StoreNumberName]` is read as "property
`StoreNumberName` of object `Store`", resolves to nothing, and the visual renders `undefined`
labels with zero-valued marks. No error is raised.

`toDataTable` looks each result column up in `columnMetadata` **by its raw DAX name** and emits
that entry's `name`. Key the metadata by the raw name and give every column a bracket-free alias:

```typescript
// ✅ key = raw DAX column name, name = Vega-safe alias
export const columnMetadata: ColumnMetadataMap = {
  "Store[StoreNumberName]": { name: "StoreName",  displayName: "Store" },
  "[Margin YoY]":           { name: "MarginYoY",  displayName: "Gross margin gain", format: "$#,0" },
};
```

```json
{ "encoding": { "y": { "field": "StoreName" }, "x": { "field": "MarginYoY" } } }
```

```typescript
// ❌ raw DAX name reused as `name` — every field silently resolves to undefined
"Store[StoreNumberName]": { name: "Store[StoreNumberName]", displayName: "Store" }
```

The same alias is what `sort.field`, `tooltip`, and `text` encodings must reference.

## Encoding Type Selection

### Choose encoding types by meaning, not storage type

A numeric query result does not necessarily represent a quantitative measure. Inspect both the returned values and the field's role in the chart before choosing its encoding type.

| Field meaning | Encoding | Example |
|---|---|---|
| Ordered categories, including integer calendar years | `ordinal` | Release year: 1996, 1997, 1998 |
| Unordered categories or identifiers, even when numeric | `nominal` | Store ID, product code |
| Measured quantities where numeric distance matters | `quantitative` | Revenue, count, duration |
| Actual date/time values on a chronological scale | `temporal` | ISO date strings or epoch milliseconds |

For annual category charts, use an explicitly ascending ordinal axis:

```json
{
  "encoding": {
    "x": { "field": "Year", "type": "ordinal", "sort": "ascending" }
  }
}
```

Ordinal axes give categories equal spacing. If missing years must create proportionally larger gaps, use a continuous temporal axis with actual date values. Use `temporal` only with actual date/time values, such as ISO 8601 strings (`"2023-06-15"`, `"2023-06-15T10:30:00Z"`) or Unix timestamps in milliseconds (`1686816000000`). Do not pass bare year integers directly to `temporal`: Vega-Lite interprets them as epoch milliseconds, not calendar years.

## Props

Refer to the package README.md for detailed information about the component api including exported types, functions, and properties.
