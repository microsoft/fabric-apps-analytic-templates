# Native Vega-Lite Selections

When an interaction stays within a single visual, such as clicking a bar to dim the others or hovering a point to emphasize matches, use Vega-Lite's native selection with a conditional encoding. This uses one `DataTable`, no named map, and no second dataset.

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

Use `onInteraction` to surface selections to application code. Use a parameterized query only when the behavior must recompute data rather than restyle marks already present in the chart.
