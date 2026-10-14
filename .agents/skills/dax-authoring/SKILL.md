---
name: dax-authoring
description: >
  Write and test DAX queries against Power BI semantic models.
  Covers DAX syntax rules, query patterns, time intelligence,
  and an iterative test workflow that runs queries with `npx rayfin connector invoke`.
---

# DAX Authoring

## Table of Contents

| Task | Reference | Notes |
|---|---|---|
| Must/Prefer/Avoid | [SKILL.md: Must/Prefer/Avoid](#must--prefer--avoid) | Guardrails for DAX query generation |
| Generating DAX Queries | [SKILL.md: Generating DAX Queries](#generating-dax-queries) | Core rules, inline examples, EVALUATE/DEFINE patterns |
| DAX Query Structure & Syntax | [dax-query-patterns.md: Query Structure](./references/dax-query-patterns.md#query-structure) | DEFINE / EVALUATE / ORDER BY / START AT |
| DAX Query Key Components | [dax-query-patterns.md: Key Components](./references/dax-query-patterns.md#key-components) | DEFINE VAR, DEFINE MEASURE, table expressions |
| DAX Query Worked Examples | [dax-query-patterns.md: Common Patterns](./references/dax-query-patterns.md#common-patterns) | 11 annotated examples from simple aggregation to cross-table joins |
| DAX Query Anti-Patterns | [dax-query-patterns.md: Anti-Patterns](./references/dax-query-patterns.md#anti-patterns) | What to avoid in DAX queries |
| CALCULATE & CALCULATETABLE | [dax-core-reference.md: CALCULATE & CALCULATETABLE](./references/dax-core-reference.md#calculate--calculatetable) | Context transition, filter types, boolean restrictions, common patterns |
| SUMMARIZECOLUMNS | [dax-core-reference.md: SUMMARIZECOLUMNS](./references/dax-core-reference.md#summarizecolumns) | Argument order, auto-blank elimination, filter args, vs SUMMARIZE |
| ALL & ALLEXCEPT | [dax-core-reference.md: ALL & ALLEXCEPT](./references/dax-core-reference.md#all--allexcept) | CALCULATE modifier vs table function; percentage patterns |
| TREATAS | [dax-core-reference.md: TREATAS](./references/dax-core-reference.md#treatas) | Virtual relationships, multi-column filtering |
| DAX Syntax Rules | [dax-core-reference.md: DAX Syntax Rules](./references/dax-core-reference.md#dax-syntax-rules) | EVALUATE, CALCULATE, naming, SQL keywords, DEFINE rules |
| Common Mistakes | [dax-core-reference.md: Common Mistakes](./references/dax-core-reference.md#common-mistakes) | Variable naming, quoting, escaping, scalar EVALUATE, multi-table SUMMARIZECOLUMNS |
| BLANK Semantics | [dax-core-reference.md: BLANK Semantics](./references/dax-core-reference.md#blank-semantics) | BLANK vs NULL, propagation, equality, ISBLANK, DIVIDE, non-empty semantics |
| Time Intelligence Patterns | [SKILL.md: Time Intelligence](#time-intelligence) | When to consult TI reference |
| Date Table Prerequisites | [dax-time-intelligence.md: Prerequisites](./references/dax-time-intelligence.md#prerequisites) | Date table requirements, mark as date table |
| YTD / QTD / MTD | [dax-time-intelligence.md: Period-to-Date](./references/dax-time-intelligence.md#period-to-date) | TOTALYTD, DATESYTD, DATESINPERIOD patterns |
| Year-over-Year / Period Comparisons | [dax-time-intelligence.md: Period Comparisons](./references/dax-time-intelligence.md#period-comparisons) | SAMEPERIODLASTYEAR, DATEADD, PARALLELPERIOD |
| Rolling Windows | [dax-time-intelligence.md: Rolling Windows](./references/dax-time-intelligence.md#rolling-windows) | DATESINPERIOD rolling 12-month patterns |
| Opening/Closing Balances | [dax-time-intelligence.md: Balances](./references/dax-time-intelligence.md#balances) | Semi-additive measures, LASTDATE, LASTNONBLANK |
| TI in DAX Queries (Critical Rules) | [dax-time-intelligence.md: Critical Rules for TI in Queries](./references/dax-time-intelligence.md#critical-rules-for-ti-in-dax-queries) | CALCULATETABLE + TREATAS pattern for query context |
| TI Common Mistakes | [dax-time-intelligence.md: Common Mistakes](./references/dax-time-intelligence.md#common-mistakes) | Missing date table, wrong granularity, fiscal calendar |
| Testing & Iteration | [SKILL.md: Testing & Iteration](#testing--iteration) | Execute → inspect → fix → re-test workflow |

## Must / Prefer / Avoid

### Must
- Always test generated DAX via `npx rayfin connector invoke --name <name> --operation executeQuery --file <payload>.query.json` before using in app code (see [Query Execution](#query-execution))
- Use fully-qualified `'Table'[Column]` for column references
- Use simple `[Measure]` for measure references
- Use DEFINE for VAR and local MEASURE declarations (single DEFINE block, no commas)
- Prefer existing model measures over re-aggregating raw data

### Prefer
- SUMMARIZECOLUMNS as the primary grouping function for queries
- TREATAS for filter arguments in SUMMARIZECOLUMNS
- Variables (VAR) to improve readability and avoid repeated calculations

### Avoid
- SQL keywords (SELECT, WHERE, HAVING, etc.) within DAX expressions
- EVALUATE with scalar functions directly (wrap in ROW or table function)

## Generating DAX Queries

### DAX Syntax Rules

- Measures are named objects in the semantic model. They specify how to aggregate data. **Measures should be used first** to answer user requests before a new DAX formula is used to aggregate data.
- **EVALUATE Statement**: Not a function but a statement. It must always precede a table expression. Avoid pairing EVALUATE with scalar functions like CONCATENATEX, SUMX, DISTINCTCOUNT, etc.
- Use the fully-qualified name `'Table'[Column]` for column references, and the simple name `[Measure]` for measure references.
- CALCULATE takes a scalar expression as its first argument. CALCULATETABLE takes a table expression as its first argument.
- SUMMARIZECOLUMNS requires a specific order: groupby columns, then filters, then aggregations/measures.
- Do not use SUMMARIZECOLUMNS when there is no aggregation and the groupby columns belong to more than one table; use VALUES, SUMMARIZE, or SELECTCOLUMNS instead.
- When using SELECTCOLUMNS or CALCULATETABLE, include any columns needed downstream (ORDER BY, FILTER).
- Filters propagate across relationships based on unidirectional or bidirectional settings.
- INTERSECT, UNION, EXCEPT require identical column counts in both inputs.
- For current date/time, use TODAY() or NOW().

### Inline Examples

**Simple filtered aggregation:**
```dax
// Total sales for red products
EVALUATE
  ROW("Total Sales Amount", CALCULATE([Total Amount], 'Product'[Color] == "Red"))
```

**Multi-filter grouping with SUMMARIZECOLUMNS:**
```dax
DEFINE
  VAR _Filter1 = TREATAS({"Consumer Electronics"}, 'Product'[Category])
  VAR _Filter2 = FILTER(ALL('Calendar'[Year]), 'Calendar'[Year] >= 2022 && 'Calendar'[Year] <= 2023)

EVALUATE
  SUMMARIZECOLUMNS(
    'Calendar'[Year],
    'Calendar'[Month],
    _Filter1,
    _Filter2,
    "Total Quantity", SUM('Sales'[Order Quantity]),
    "Discount", [Total Discount]
  )
```

**TopN with filtering:**
```dax
DEFINE
  VAR _Filter = TREATAS({"Red", "Black"}, 'Product'[Color])
  VAR _Core = SUMMARIZECOLUMNS('Product'[Name], _Filter, "Total Sales", [Total Amount])

EVALUATE
  TOPN(10, _Core, [Total Sales], DESC)
```

For full syntax reference, worked examples, and anti-patterns, see [dax-query-patterns.md](./references/dax-query-patterns.md).
For function details, see [dax-core-reference.md](./references/dax-core-reference.md).

## Time Intelligence

Time intelligence functions enable period-based analysis (YTD, YoY, rolling windows, etc.). They require a properly configured Date table.

Consult [dax-time-intelligence.md](./references/dax-time-intelligence.md) whenever the user's request involves:
- Period-to-date calculations (YTD, QTD, MTD)
- Period comparisons (Year-over-Year, Month-over-Month)
- Rolling windows (last 12 months, last 30 days)
- Opening/closing balances
- Custom date ranges

## Testing & Iteration

1. Generate the DAX query expression
2. Execute it as described in [Query Execution](#query-execution)
3. Inspect results: check column names, data types, row counts, and actual data values
4. If error: consult [dax-core-reference.md](./references/dax-core-reference.md), fix, and re-test
5. Iterate until the query returns expected results

## Query Execution

Write the JSON operation input `{ "query": "<DAX>" }` to a payload file inside the project (for example `./inspection/<name>.query.json`) with a file API, then run:

```powershell
npx rayfin connector invoke --name <name> --operation executeQuery --file ./inspection/<name>.query.json
```

This is the form `AGENTS.md` prescribes; see it for prerequisites and payload rules. Do not pass DAX inline with `--input '{"query":"..."}'`: shells mangle the nested quotes (PowerShell strips them when calling `npx`), so the CLI receives invalid JSON, and DAX from the model or the user must never be placed on a command line. `--file` expects that JSON payload, not a raw `.dax` file, and the file must be inside the project.

The query runs against the same semantic model the app queries, so the column names and row shape are what the app will receive; `dataType` is the exception, as `AGENTS.md` explains.

**Row count:** a query returns every row unless you bound it. Bound the result in the DAX itself with `TOPN(...)` or an aggregation. To cap an exploratory query, add `resultSetRowCountLimit` to the payload (`{ "query": "...", "resultSetRowCountLimit": 100 }`); it truncates silently, so a result with exactly that many rows may be incomplete. A result too large to print is written to a file under `rayfin/.temp/invoke-results` and only a preview is shown, so read that file rather than treating the preview as the whole result — or pass `--output-file <path>` to choose where the full result lands.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| CLI `invoke` fails with "connector not found" | Run `npx rayfin connector list` to check declared connectors, then `npx rayfin connector add` to register (see `AGENTS.md`) |
| DAX syntax errors | Consult [dax-core-reference.md](./references/dax-core-reference.md) — check reserved keywords, quoting rules, EVALUATE/scalar mistakes |
| Unexpected query results | Check filter context, relationship direction, BLANK handling in [dax-core-reference.md](./references/dax-core-reference.md#blank-semantics) |
| Time intelligence returns wrong values | Check date table prerequisites and critical rules in [dax-time-intelligence.md](./references/dax-time-intelligence.md) |
