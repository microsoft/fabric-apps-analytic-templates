# Vega-Lite Visual

A React component from the `@microsoft/fabric-visuals` package for rendering Vega-Lite visuals.

```tsx
import type { DataTable } from "@microsoft/fabric-visuals-core";
import { VegaVisual, useCssTheme } from "@microsoft/fabric-visuals";
import type { VisualizationSpec, VegaLiteConfig } from "@microsoft/fabric-visuals";

const theme = useCssTheme();

const spec: VisualizationSpec = {
  $schema: "https://vega.github.io/schema/vega-lite/v6.json",
  description: "An example vega-lite spec",
  data: { }, // filled in by the `DataTable` below
  mark: "bar",
  encoding: {
    x: { field: "category", type: "nominal" },
    y: { field: "\\[value\\]", type: "quantitative" },
  },
};

const data: DataTable = {
  columns: [
    { name: "category", displayName: "Category" },
    { name: "[value]", displayName: "Value" },
  ],
  rows: [
    ["A", 28],
    ["B", 55],
    ["C", 43],
  ]
}

<VegaVisual spec={spec} data={data} theme={theme} style={{ height: 400 }} />
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

## Props

Refer to the package README.md for detailed information about the component api including exported types, functions, and properties.
