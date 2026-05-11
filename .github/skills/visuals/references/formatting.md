# Visual Formatting Rules

Important formatting rules about creating visuals that must be strictly followed.

## Where to Define Format Strings

Formats defined in `columnMetadata` are auto-applied by `VegaVisual` to axes, legends, text marks, and tooltips. Do not hardcode `format` in Vega-Lite `.json` specs.

## Number Formatting

- Use `"#,0"` for general scalar numbers (e.g., counts).
- Use `"$#,0.00"` for currency values.
- **Exception**: Numbers representing time or dates (e.g., a year) should not be formatted.

## Colors

- If only one series of data is available, hide the legend.
- When a legend is present, always use color encoding.
- **Consistent categorical colors**: When a categorical dimension appears in visuals or UI, define a shared color map — `scale.domain` + `scale.range` in Vega-Lite, or a constants object for CSS. Never rely on Vega's default auto-assigned palette. Before writing the scale, **discover the distinct values** the query returns, then set `domain` and `range` to arrays of **equal length**.

### Categorical Color Palette

The base Vega-Lite theme includes a 10-color categorical palette. These colors are a starting point, not a strict requirement — you may extend, replace, or create an entirely new palette that better suits the data or the app's aesthetic direction. Just ensure sufficient contrast between series and accessibility for color-vision deficiency.

## Chart-Specific Rules

### Single Value (Card)

- Show the value with the label below, like a card visual with no embellishments.
- Use two layers:
  - First layer: shows the value, mark uses style `"labelCallout"`.
  - Second layer: shows the label, uses style `"labelSubtitle"`.
- Both layers must set `limit` on the mark to `{"expr": "width"}` so text truncates with an ellipsis (`…`) when the container is too narrow.

### Line Chart

- Emit an encoding for both `line` and `point`.
- **Dual Y-axis**: When using `resolve: { scale: { y: "independent" } }`, wrap each series' `line` and `point` marks in their own nested `layer` so the top-level layer count equals the number of Y-axes.

### Bar Chart

- Emit an encoding for both `bar` and `text`.
- Text encoding should be used for showing a nicely formatted data value for the bar.
- If there is more than one series, emit only `bar` encoding.
- **Horizontal bars**: text encoding should use style `"labelHorizontal"`.
- **Vertical columns**: text encoding should use style `"labelVertical"`.

### Scatter Chart

- Use the `"circle"` encoding with no extra styles.

### Other Charts

- No extra encodings needed.

## General Guidelines

- Avoid additional customization to encodings.
- When highlighting specific data points or series, non-highlighted shapes should have `fillOpacity: 0.35`.
- For line charts, both the line and associated points should have `opacity: 0.35`.


## Shared Visual Theme

The base Vega-Lite theme (colors, fonts, spacing, axis styling, legend layout) is applied **automatically** by `VegaVisual` from `@microsoft/fabric-visuals-core` design tokens. **Do NOT paste a full config block into spec `.json` files** — it overrides the token system and breaks theme cascading.

### What the base theme provides

All of the following are set automatically and will respond to token or `VisualTheme` changes:

- **Text colors**: foreground for titles, foregroundSecondary for labels
- **Font**: from `fontFamily.base` token
- **Grid/stroke**: from `stroke` color token
- **Background**: transparent
- **Domain/tick lines**: hidden (transparent)
- **Category color palette**: 10-color reference palette built into the base theme (extendable — see [Colors](#colors) section)
- **Named styles**: `labelHorizontal`, `labelVertical`, `labelSubtitle`, `labelCallout`

### Per-chart config overrides

Only set `config` in a spec when a **specific chart** needs to differ from the base theme. Use the `configVegaLite` prop on `VegaVisual` — it merges on top of the base theme:

```tsx
<VegaVisual
  spec={vegaLiteSpec}
  data={dataTable}
  theme={theme}
  configVegaLite={{ axis: { labelAngle: -45 } }}
/>
```

Or set `config` directly in the `.json` spec file for structural overrides (not colors/fonts):

```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "mark": "bar",
  "encoding": { },
  "config": {
    "axis": { "labelAngle": -45 }
  }
}
```

### Changing visual styling globally

Edit the CSS custom properties in `src/global.css`. These cascade to all charts, grids, and UI components automatically. Light-mode values go in the `@theme` block; dark-mode overrides go in the `.dark` block.

| What to change | CSS variable(s) in `global.css` |
|---|---|
| Colors | `--color-foreground`, `--color-background`, `--color-brand-*`, etc. |
| Font family | `--font-base`, `--font-monospace` |
| Font sizes | `--text-200` through `--text-600` |
| Spacing | `--spacing-s`, `--spacing-m`, etc. |
| Border radius | `--radius-sm`, `--radius-md`, etc. |

> **Note:** The category color palette (series colors in charts) is built into the visual theme and is not currently customizable via CSS.

### Named Styles

These styles are built into the base theme and can be referenced via the `style` property on marks:

| Style | Use case | Key properties |
|---|---|---|
| `labelHorizontal` | Data labels on horizontal bars | left-aligned, dx: 8 |
| `labelVertical` | Data labels on vertical columns | bottom baseline, dy: -4 |
| `labelSubtitle` | Subtitle text | fontSize: 16, dy: 32 |
| `labelCallout` | Card/KPI values | fontSize: 32, bold |
