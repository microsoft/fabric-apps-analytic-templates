# DataGrid

A React component from the `@microsoft/fabric-datagrid` package for rendering data-grid / table visuals.

### Props

Refer to the package README.md for detailed information about the component api including exported types, functions, and properties.

### Theming

Pass the `theme` prop to render correctly in both light and dark modes. Use the `useCssTheme()` hook from `@microsoft/fabric-visuals` — it derives the theme from `--color-*` CSS variables in `global.css` and updates automatically when the theme changes:

```tsx
import { useCssTheme } from "@microsoft/fabric-visuals";

const theme = useCssTheme();

<DataGrid data={dataTable} theme={theme} />
```

### Custom Cell Rendering

Use `cellRenderer` on a `GridColumnDef` to render non-textual content — icons, badges, progress bars, colored indicators, or any React element. The renderer receives the raw cell value and the full row object, and returns a `ReactNode`.

```ts
cellRenderer?: (value: CellValue, row: Row) => ReactNode;
```

**Key behaviors:**
- When `cellRenderer` is set, the column's `format` string is **not** applied — the renderer receives the raw value and is responsible for its own formatting.
- The built-in tooltip-on-truncation is disabled for custom-rendered cells — the renderer should provide its own tooltip if needed.

#### Examples

**Progress bar** — visualize a numeric value as a bar:

```tsx
{
  id: "completion",
  header: "Progress",
  cellRenderer: (value) => {
    const pct = typeof value === "number" ? value : 0;
    return (
      <div className="flex items-center gap-s">
        <div className="h-s w-full rounded-full bg-muted">
          <div
            className="h-s rounded-full bg-primary"
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <span className="text-200 tabular-nums">{pct}%</span>
      </div>
    );
  },
}
```

**Combining row fields** — use the second `row` parameter to build content from multiple columns:

```tsx
{
  id: "employee",
  header: "Employee",
  cellRenderer: (_value, row) => {
    const name = String(row["name"] ?? "");
    const role = String(row["role"] ?? "");
    return (
      <div className="flex flex-col leading-tight">
        <span className="font-medium">{name}</span>
        <span className="text-200 text-muted-foreground">{role}</span>
      </div>
    );
  },
}
```

**Boolean indicator** — render a check/cross icon instead of "true"/"false":

```tsx
import { Check, X } from "lucide-react";

{
  id: "verified",
  header: "Verified",
  cellRenderer: (value) =>
    value ? <Check className="icon-size-200 text-green-600" /> : <X className="icon-size-200 text-red-500" />,
}
```
