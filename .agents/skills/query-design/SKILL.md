---
name: query-design
description: >
  Separates DAX data-fetching from TypeScript presentation. Guides when to use 
  DAX vs. TypeScript vs. Vega-Lite for aggregation, total rows, FORMAT(), SELECTCOLUMNS, 
  BLANK handling, fixed filters, multi-grain queries, and format strings.
---

# Query Design — Separation of Data and Presentation

**DAX computes and fetches data. TypeScript shapes it for display. VegaVisual and DataGrid render it.**

Aggregate in DAX to the visual's grain — never fetch lower-grain rows to roll up client-side. When a visual layout changes, only the TypeScript or spec layer should change — not the DAX query.

## Responsibility Matrix

| Concern | Owner |
|---|---|
| Semantic measures (SUM, DISTINCTCOUNT, etc.) | DAX |
| Fixed model/page filters | DAX |
| User-controlled visual filters | [visual-interactivity](../visual-interactivity/SKILL.md) |
| Grouping grain (SUMMARIZECOLUMNS) | DAX |
| Time intelligence (YTD, YoY) | DAX |
| TopN / payload reduction | DAX |
| Deterministic row ordering (ORDER BY) | DAX (for debugging — not presentation sort) |
| Partitioning a flagged result table | TypeScript |
| Coordinating separate query results | TypeScript (one hook call per result table) |
| Server-provided grand totals (preferred, supports all aggregation types) | DAX + TypeScript row partitioning |
| DataGrid-computed grand totals | DataGrid (alternative only for additive `sum` values or a count of fetched leaf rows) |
| Filling dimension gaps | TypeScript (stitch dimension list into sparse results) |
| Reshaping (pivot, unpivot) | TypeScript |
| Column display names | `columnMetadata` in factory file |
| Vega-Lite / DataGrid field identifiers | `columnMetadata.name` (bracket-free alias) |
| Number/date formatting | `columnMetadata.format` / Vega-Lite spec |
| User-facing sort order | TypeScript / Vega-Lite `sort` / DataGrid `sort` |
| Decorative labels, icons | DataGrid `cellRenderer` or Vega-Lite condition |
| Axis titles, legends, color encoding | Vega-Lite spec |

## Rules

### Must

- Aggregate in DAX to the visual's grain — never fetch lower-grain rows just to roll them up to that grain in TypeScript
- One `EVALUATE` per `.dax` file; use `ROLLUPADDISSUBTOTAL` when DataGrid body and grand-total grains share one result table
- `ORDER BY` in DAX for stable, diffable results — not presentation sort
- Same filters/measures across related split-grain queries to prevent drift

### Prefer

- `SUMMARIZECOLUMNS` for grouped aggregation — it also drops BLANK-measure rows, keeping payloads small
- DAX's natural column names (`'Table'[Column]`, `[Measure]`) as `columnMetadata` **keys**, mapped to a bracket-free `name` and a human-readable `displayName`
- Raw typed values from DAX — format via `columnMetadata.format` or Vega-Lite, never `FORMAT()`
- Model-defined format strings (from `INFO.VIEW.MEASURES()`) over invented ones
- Multiple lightweight queries for independently shaped datasets; one flagged rollup query for a DataGrid body and grand total
- User-facing sort in TypeScript / Vega-Lite / DataGrid — never re-query for sort

### Avoid

- `SELECTCOLUMNS` solely for renaming — use `columnMetadata` (`name` + `displayName`) instead
- Reusing the raw DAX column name as `columnMetadata.name` — `[` `]` `.` make the visual read `undefined`
- `UNION` to mix body and total grains — use `ROLLUPADDISSUBTOTAL` and partition its flagged rows
- `FORMAT()` in DAX — converts to text, breaks sorting and charting
- Converting BLANK to `0` / `""` / `"N/A"` in DAX — causes result-set explosion
- `CONCATENATEX`, `UNICHAR`, emoji prefixes — decorative text belongs in `cellRenderer` or Vega-Lite
- Fetching all members of high-cardinality dimensions just to fill gaps

## Decision Flowchart

```
Need to add something to the query result?
  |-- Calculation / aggregation / fixed scope filter?
  |     -> DAX (measures, CALCULATE, SUMMARIZECOLUMNS)
  |-- Interactive filter the user controls?
  |     -> Use the visual-interactivity skill
  |-- Adding a DataGrid grand total?
  |     -> DAX rollup query: split body and total rows with toRollupDataTables
  |        and always pass the returned grandTotalTable via grandTotals.data
  |     -> DataGrid-computed sum/count: pass grandTotals without data and set defaultAggregation
  |-- Merging datasets or adding other synthetic rows?
  |     -> Charts: pass multiple DataTables to VegaVisual, layer in spec
  |     -> Grids: append rows in TypeScript, style via cellRenderer
  |-- Renaming a column for display?
  |     -> columnMetadata in the factory file (displayName)
  |-- Formatting, labeling, or encoding?
  |     -> Vega-Lite spec or DataGrid cellRenderer
  |-- Decorating values (icons, status badges, null placeholders)?
  |     -> DataGrid cellRenderer or Vega-Lite condition encoding
  |-- Not sure?
        -> Does it change what the data *means* (filter, measure, grain)? -> DAX
           Does it change only how data is *rendered* (labels, icons, layout)? -> TypeScript / Vega-Lite spec / DataGrid cellRenderer
           Still unclear? -> Read the relevant reference above
```

## Reference Materials

Read these when working on a specific topic:

- **[Anti-patterns and corrections](references/anti-patterns.md)** — Open when reviewing a query that uses `UNION` for totals, `FORMAT()`, `SELECTCOLUMNS` for renaming, `CONCATENATEX`/emoji decoration, BLANK-to-`0` conversion, or `GENERATE`/`CROSSJOIN` for gap-filling.
- **[Multi-grain patterns](references/multi-grain-patterns.md)** — Open when a single visualization needs data at multiple grains (e.g., bars + reference line, region detail + total row, monthly trend + YTD), to choose between one flagged rollup result and separate queries while keeping related factories, hooks, and `DataTable`s aligned.
- **[Format strings](references/format-strings.md)** — Open when picking a `columnMetadata.format` value, when a measure has a dynamic format string, or when formatting needs to flow into a Vega-Lite axis.

## Integration with Sibling Skills

- **[schema-query](../schema-query/SKILL.md)** — Query exact tables, columns, measures, and relationships before writing queries.
- **[dax-authoring](../dax-authoring/SKILL.md)** — DAX syntax, query patterns, and testing workflow. Apply this skill's principles when deciding what DAX should compute.
- **[visuals](../visuals/SKILL.md)** — Vega-Lite specs and DataGrid configuration. Push formatting and labels into specs, not DAX.
- **[visual-interactivity](../visual-interactivity/SKILL.md)** — Visual selections, cross-filtering, cross-highlighting, filter-aware grid totals, and runtime query parameters.