# Multi-Table Input for VegaVisual

`VegaVisual`'s `data` prop accepts two shapes:

- A single `DataTable` — injected as the spec's anonymous root `data`.
- A `Record<string, DataTable>` — each entry is emitted under `spec.datasets[name]`. Layers in the spec reference each dataset by name.

```tsx
<VegaVisual
  spec={spec}
  data={{ sales: salesTable, target: targetTable }}
  theme={theme}
/>
```

```json
{
  "layer": [
    { "data": { "name": "sales" },  "mark": "bar",  "encoding": { /* ... */ } },
    { "data": { "name": "target" }, "mark": "rule", "encoding": { /* ... */ } }
  ]
}
```

## Caveats

- Auto-injected transforms (stacked data labels, crosshair tooltips) only run on the single-`DataTable` path. With a named map, the spec is compiled as written.