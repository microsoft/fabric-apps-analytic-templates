# Visual Container

`VegaVisual` and `DataGrid` already wrap themselves in a `VisualContainer` — that is the default path and needs no extra component.

Refer to `node_modules/@microsoft/fabric-visuals-extensibility/README.md` for the complete component API — every prop, type, and option. This reference covers the container patterns and constraints needed when building the template.

## Turning actions on/off

The container's built-in actions can be on or off by default. Use `visualContainerCapabilities` to toggle the add or remove any actions.

```tsx
<DataGrid
    data={dataTable}
    theme={theme}
    header={{ title: "Top Products" }}
    visualContainerCapabilities={{ allowCopyVisual: false }}
/>
```

Full set: `VisualContainerCapabilities` under *Visual Container Framing* in `node_modules/@microsoft/fabric-visuals-core/README.md`.

## Wrapping a visual yourself

Hand-author a container only when the default path doesn't cover what you need:

- custom actions, custom behavior on a built-in action (e.g. confirm before copy), or driving them programmatically — a PNG download, or Copy from a button elsewhere on the page
- the same chrome around something that isn't a `VegaVisual` or `DataGrid` — a KPI card, a custom visual

```tsx
import { VisualContainer } from "@microsoft/fabric-visuals-extensibility";
import type { VisualContainerAction, VisualContainerHandle } from "@microsoft/fabric-visuals-extensibility";
```

Move the chrome up to the container and pass `chromeless` on the visual inside. Put the `header` on the container, not the visual:

```tsx
<VisualContainer
    header={{ title: "Revenue by Region", subtitle: "Last 12 months" }}
    builtInActionIds={["copyVisual"]}
    customActions={[containerAction]}
>
    <VegaVisual
        spec={vegaLiteSpec}
        data={dataTable}
        theme={theme}
        chromeless
    />
</VisualContainer>
```

| Prop | Type | Notes |
|---|---|---|
| `header` | `{ title, subtitle? }` or a React node | Optional. With a header the toolbar sits in the header row; without one it floats over the visual. |
| `builtInActionIds` | `BuiltInActionId[]` | Built-in actions by id — `"copyVisual"` is the Copy button. Rendered ahead of custom actions. |
| `customActions` | `VisualContainerAction[]` | Your own buttons, rendered after the built-ins. |
| `maxVisibleButtons` | `number` | Buttons beyond this collapse into a `…` overflow menu. Defaults to `2`. |
| `className` | `string` | Merged onto the container root, not replacing its own class. On a self-framing `VegaVisual` / `DataGrid`, the equivalent prop is `containerClassName`. |

Keep `copyVisual` in `builtInActionIds` — a hand-authored container is still expected to be copyable. Don't rebuild Copy as a custom action.

## Custom actions

```tsx
const containerAction: VisualContainerAction = {
    id: "custom-action",
    label: "Action label",     // used as both the tooltip and the aria-label
    icon: <ActionIcon className="icon-size-200" />,
    onClick: () => runAction(),   // may be async
};
```

## Programmatic capture

Use a `ref` only for behavior with no built-in equivalent — e.g. downloading the visual as a file, or copying it from a button outside the container:

```tsx
const ref = useRef<VisualContainerHandle>(null);

const blob = await ref.current?.captureAsImage();   // PNG Blob
await ref.current?.copyImageToClipboard();          // capture + clipboard, no toast

<VisualContainer ref={ref} header={{ title: "Revenue" }} builtInActionIds={["copyVisual"]}>
    <VegaVisual spec={spec} data={dataTable} theme={theme} chromeless />
</VisualContainer>
```

For content with no container at all, the same two steps are exported standalone: `captureElementAsImage(element)` and `writeImageToClipboard(blob, { title, timestamp })`.
