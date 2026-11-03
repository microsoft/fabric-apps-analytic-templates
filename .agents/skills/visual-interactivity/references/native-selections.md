# Native Vega-Lite Selections

For chart-local click or hover emphasis, use a selection with conditional encoding. One `DataTable` is enough; no query or named datasets.

```json
{
    "params": [{ "name": "sel", "select": { "type": "point", "fields": ["Category"] } }],
    "mark": "bar",
    "encoding": {
        "x": { "field": "Category", "type": "nominal" },
        "y": { "field": "Sales", "type": "quantitative" },
        "opacity": {
            "condition": { "param": "sel", "value": 1, "empty": false },
            "value": 0.3
        }
    }
}
```

With `empty: false`, bars remain dimmed until selected. Leave native selection parameters out of specs bound to an Interaction Manager source. A managed source passes `selections`, `selectableFields`, and `onInteraction` to the visual, which dims its own unselected marks. Use a [query factory](query-factories.md) for recomputation.
