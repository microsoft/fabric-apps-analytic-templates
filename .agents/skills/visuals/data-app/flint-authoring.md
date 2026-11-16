# Flint Spec Authoring

> Adapted from the [full Flint authoring skill](https://github.com/microsoft/flint-chart/blob/main/agent-skills/flint-chart-author/SKILL.md). Refer to it for the complete reference including MCP workflows and advanced topics.

## What you produce

Your output is a **Flint spec** — the `chart_spec` portion of a `ChartAssemblyInput`. You reference data columns **by name**. The `VegaVisual` component compiles it to Vega-Lite internally using the `DataTable` column metadata for semantic types.

**You write the input spec, not the output spec.**

- **DO** emit `chartType` and `encodings` (channel → field mapping).
- **Reference columns by the cleaned `name` from `columnMetadata`** (the same names used in Vega-Lite field encodings).
- **Transform data before Flint.** If the chart needs aggregation, filtering, pivots, or derived columns beyond Flint's built-in static-series fold, do that in DAX or a transform step first.
- **Semantic types come from `DataTable` columns.** For Flint to work, it must have semantic types defined for every column referenced by the specification.  Ensure that each column referenced in the visual's `DataTable` has the respective column's `semanticType` property filled in.  If it is not set, peek at a sample of data and update `ColumnDef.semanticType` with a best guess based on the available semantic types.

## Flint spec structure (what goes in the `.json` file)

```json
{
  "chartType": "Bar Chart",
  "encodings": {
    "y": { "field": "ProductsRegion" },
    "x": { "field": "Total Revenue" }
  }
}
```

Optional fields:
- `chartProperties`: per-chart tuning (see below)

## Step 1 — pick `chartType`

Use one of the registered names **exactly**:

| chartType | Channels | Notes / required |
|---|---|---|
| `"Scatter Plot"` | x, y, color, size, opacity, column, row | x + y required |
| `"Regression"` | x, y, size, color, column, row | scatter + fit line |
| `"Connected Scatter Plot"` | x, y, order, color, detail, column, row | x + y required |
| `"Ranged Dot Plot"` | x, y, color | dumbbell of two x per category |
| `"Strip Plot"` | x, y, color, size, column, row | jittered points |
| `"Bar Chart"` | x, y, color, opacity, column, row | one discrete + one measure |
| `"Grouped Bar Chart"` | x, y, group, column, row | `group` = clustering category |
| `"Stacked Bar Chart"` | x, y, color, column, row | stacked segments |
| `"Pyramid Chart"` | x, y, color | diverging horizontal bars |
| `"Lollipop Chart"` | x, y, color, column, row | |
| `"Waterfall Chart"` | x, y, color, column, row | `color` reserved for type column |
| `"Gantt Chart"` | y, x, x2, color, detail, column, row | x = start, x2 = end |
| `"Bullet Chart"` | y, x, goal, color, column, row | `goal` required |
| `"Histogram"` | x, color, column, row | x = measure to bin |
| `"Boxplot"` | x, y, color, opacity, column, row | category + measure |
| `"ECDF Plot"` | x, color, detail, column, row | cumulative distribution |
| `"Heatmap"` | x, y, color, column, row | color = the measure |
| `"Line Chart"` | x, y, color, strokeDash, detail, opacity, column, row | |
| `"Sparkline"` | x, y, color, detail, row, column | small-multiple mini trends |
| `"Bump Chart"` | x, y, color, detail, column, row | rank-over-time |
| `"Slope Chart"` | x, y, color, detail, column, row | two-period comparison |
| `"Area Chart"` | x, y, color, opacity, column, row | |
| `"Range Area Chart"` | x, y, y2, color, column, row | band from y (low) to y2 (high) |
| `"Violin Plot"` | x, y, color, row | mirrored KDE density |
| `"Streamgraph"` | x, y, color, column, row | center-stacked areas |
| `"Density Plot"` | x, color, column, row | |
| `"Pie Chart"` | size, color, column, row | `size` = slice value, `color` = category |
| `"Rose Chart"` | x, y, color, column, row | polar bars |
| `"Radar Chart"` | x, y, color, column, row | |
| `"Candlestick Chart"` | x, open, high, low, close, column, row | OHLC all required |
| `"Bar Table"` | y, x, color, column, row | compact bars + value labels |
| `"KPI Card"` | metric, value, goal | big-number tile |
| `"Map"` | longitude, latitude, color, size, opacity | bubble map |
| `"Choropleth"` | id, color, detail | `id` = geographic key |

**Donut chart:** use `"Pie Chart"` with `chartProperties.innerRadius > 0`.

**Choosing a bar chart (most common mix-up):**
- `"Bar Chart"` — single series (color stacks if multiple rows per x)
- `"Stacked Bar Chart"` — second category on `color`, stacked segments (parts-to-whole)
- `"Grouped Bar Chart"` — second category on **`group`** channel, side-by-side (compare values directly)

## Step 2 — map fields to channels

Each channel maps to an encoding object `{ field, ... }`:

```json
"encodings": {
  "x": { "field": "weight" },
  "y": { "field": "mpg" },
  "color": { "field": "origin" }
}
```

**Encoding object fields** (all optional except `field`):

| Field | Values | Purpose |
|---|---|---|
| `field` | column name | Bind channel to a data column |
| `type` | `quantitative`, `nominal`, `ordinal`, `temporal` | Override inferred type (rarely needed) |
| `aggregate` | `count`, `sum`, `average` | Force aggregation |
| `sortOrder` | `ascending`, `descending` | Sort direction |
| `sortBy` | channel name (e.g. `"y"`) or field | Sort category by another measure |
| `scheme` | Vega scheme name (e.g. `viridis`, `redblue`) | Color scheme for `color` channel |

You usually don't need `type`, `aggregate`, or `sortOrder` — they're inferred from the semantic type. Set them only with specific intent.

**Multi-series (wide → long).** To plot several measure columns as series, pass an **array** on `x` or `y` (only those two channels):

```json
"encodings": { "x": { "field": "month" }, "y": ["sales", "profit"] }
```

All array fields must be quantitative, and you cannot also bind `color` when using the array form. This is the **only** built-in reshape — for any other shape, transform data in DAX first.

## Step 3 — semantic types (via `columnMetadata`)

In this app, semantic types are set on `DataTable` columns via `columnMetadata` in the factory `.ts` file. The `VegaVisual` component passes them to Flint automatically. Pick the most specific type for each column:

| Family | Semantic types |
|---|---|
| Temporal (point) | `DateTime`, `Date`, `Time`, `Timestamp` |
| Temporal (granule) | `Year`, `Quarter`, `Month`, `Week`, `Day`, `Hour`, `YearMonth`, `YearQuarter`, `YearWeek`, `Decade` |
| Temporal (span) | `Duration` |
| Measure (amount) | `Amount`, `Price`, `Revenue`, `Cost`, `Quantity`, `Count`, `Number` |
| Measure (proportion) | `Percentage` |
| Measure (signed/diverging) | `Profit`, `PercentageChange`, `Sentiment`, `Correlation` |
| Measure (physical) | `Temperature` |
| Discrete / rank | `Rank`, `Score`, `Rating`, `Index`, `ID` |
| Geographic (coord) | `Latitude`, `Longitude` |
| Geographic (place) | `Country`, `State`, `City`, `Region`, `Address`, `ZipCode` |
| Categorical | `Category`, `Name`, `Product`, `Company`, `PersonName`, `Status`, `Type`, `Boolean`, `Direction`, `Range`, `AgeGroup`, `String` |
| Fallback | `Unknown` |

What choosing well gets you (automatically):
- `Price` / `Amount` / `Revenue` → currency formatting, zero baseline, sequential color
- `Temperature` → diverging color scheme, no forced zero
- `Rank` → reversed axis (1 on top), discrete color
- `Date` / `DateTime` → temporal axis with auto-granularity formatting
- `Percentage` → percent formatting, 0–100 domain awareness
- `Profit` / `PercentageChange` → diverging color, signed formatting

## Chart-level properties (`chartProperties`)

Set only when the user asks for specific behavior — defaults are sensible.

| Chart type | Property | Type / range (default) | Effect |
|---|---|---|---|
| Bar Chart | `cornerRadius` | 0–15 (0) | Round bar corners |
| Area / Stacked Bar | `stackMode` | `stacked` \| `normalize` \| `center` \| `layered` | Stacking behavior |
| Grouped Bar / Boxplot | `dodge` | `auto` \| `local` \| `global` (`auto`) | Group compaction |
| Line / Area / Sparkline | `interpolate` | `linear` \| `monotone` \| `step` \| `step-before` \| `step-after` \| `basis` \| `cardinal` \| `catmull-rom` (`linear`) | Curve shape |
| Line / ECDF | `showPoints` | boolean (false) | Show point markers |
| Sparkline | `baseline` | `mean` \| `zero` \| `median` \| `none` (`mean`) | Reference line |
| Sparkline | `trendWidth` | 80–600 (240) | Mini line-plot width |
| Histogram | `binCount` | 5–50 (10) | Number of bins |
| Density Plot | `bandwidth` | 0.05–2 (0=auto) | Kernel bandwidth |
| Pie Chart | `innerRadius` | 0–100 (0) | Donut hole size |
| Pie / Rose | `sortSlices` | `none` \| `descending` \| `ascending` (`none`) | Order wedges |
| Lollipop | `dotSize` | 20–300 (80) | Circle size |
| Waterfall | `totals` | `auto` \| `none` \| `first` \| `last` \| `both` (`auto`) | Anchor bars |
| Regression | `regressionMethod` | `linear` \| `log` \| `exp` \| `pow` \| `quad` \| `poly` (`linear`) | Fit method |
| Regression | `polyOrder` | 1–5 (3) | Polynomial order |
| Radar | `filled` | boolean (true) | Fill the polygon |
| Map | `region` | `us` \| `world` \| `auto` (`auto`) | Geographic scope |
| Map | `projection` | `mercator` \| `equalEarth` \| `orthographic` \| `conic` | Map projection |

**Cross-cutting properties** (apply to position/faceted charts):
- `independentYAxis` (boolean) — faceted charts: own y-scale per panel
- `logScale_x` / `logScale_y` (boolean) — logarithmic axis
- `includeZero_x` / `includeZero_y` (boolean) — force zero on axis
- `xAxisType` / `yAxisType` (`temporal` | `nominal`) — force axis type

## Worked examples

### Bar chart sorted by value, faceted by region

```json
{
  "chartType": "Bar Chart",
  "encodings": {
    "x": { "field": "product_line", "sortBy": "y", "sortOrder": "descending" },
    "y": { "field": "revenue" },
    "column": { "field": "region" }
  }
}
```

### Line chart with multiple series (wide → long)

```json
{
  "chartType": "Line Chart",
  "encodings": {
    "x": { "field": "month" },
    "y": ["sales", "profit"]
  },
  "chartProperties": { "interpolate": "monotone", "showPoints": true }
}
```

### Donut chart

```json
{
  "chartType": "Pie Chart",
  "encodings": {
    "size": { "field": "share" },
    "color": { "field": "vendor" }
  },
  "chartProperties": { "innerRadius": 60 }
}
```

### Scatter plot with color

```json
{
  "chartType": "Scatter Plot",
  "encodings": {
    "x": { "field": "weight" },
    "y": { "field": "mpg" },
    "color": { "field": "origin" }
  },
  "baseSize": { "width": 400, "height": 300 }
}
```

### Stacked area chart

```json
{
  "chartType": "Area Chart",
  "encodings": {
    "x": { "field": "date" },
    "y": { "field": "value" },
    "color": { "field": "category" }
  },
  "chartProperties": { "stackMode": "stacked", "interpolate": "monotone" }
}
```

### Heatmap

```json
{
  "chartType": "Heatmap",
  "encodings": {
    "x": { "field": "hour" },
    "y": { "field": "day" },
    "color": { "field": "count" }
  }
}
```

## Validation checklist

Before returning a Flint spec, verify:

1. `chartType` is an exact registered name from the table above.
2. Every `field` referenced in `encodings` matches a real column name from `columnMetadata`.
3. Every column used has a `semanticType` set in `columnMetadata`.
4. Required channels for the chart type are present (e.g. Bullet → `goal`, Pie → `size` + `color`, Candlestick → `open/high/low/close`).
5. Any `chartProperties` keys are valid for that chart type and in range.
6. You did **not** hand-write Vega-Lite output or inline large data.
7. The data carries no embedded total/subtotal level mixed with its components on a stacked/grouped/colored channel.

## What you should NOT do

- **Don't write Vega-Lite specs** when Flint supports the chart type — write the Flint spec instead.
- **Don't set `type`/`aggregate`/`sortOrder`** unless intent conflicts with the default.
- **Don't pass colors, font sizes, axis tick counts** — the compiler derives these from semantic types and data.
- **Don't invent field names.** Reference only columns that exist in `columnMetadata`.
- **Don't invent semantic type names.** If none fit, use `Quantity` for numbers, `Category` for strings, `Date` for date-shaped values.
- **Don't invent transforms.** The only built-in reshape is the array form on `x`/`y`. If the data shape is wrong, reshape in DAX.
