---
name: dax-authoring
description: >
  Write and test DAX queries against Power BI semantic models.
  Covers DAX syntax rules, query patterns, time intelligence,
  and an iterative test workflow using `npx fabric-app-semantic-model-tools run-dax-query --dax <file> --alias <name>`.
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
- Always test generated DAX before using it in app code. Execute each planned `.dax` file once
  through `npx fabric-app-semantic-model-tools run-dax-query` and compare its report with the schema-query plan
- Run DAX through `run-dax-query`, not `npx rayfin connector invoke`; `run-dax-query` runs Rayfin CLI
  calls one at a time.
- Use fully-qualified `'Table'[Column]` for column references
- Use simple `[Measure]` for measure references
- Use DEFINE for VAR and local MEASURE declarations (single DEFINE block, no commas)
- Use existing model measures for requested business metrics. Raw aggregation is allowed only when
  the schema workflow established that no suitable shipped measure exists. Never replace a shipped
  measure with raw `SUM`, `COUNT`, `COUNTROWS`, `AVERAGE`, `DISTINCTCOUNT`, or a local
  approximation
- Generate DAX from the completed schema-query plan; do not rediscover or substitute model objects
- Do not implement the UI until the final DAX has executed successfully and its output passes the
  planned shape and semantic validation gates, with every warning resolved or explained by the
  request

### Prefer
- SUMMARIZECOLUMNS as the primary grouping function for queries
- TREATAS for filter arguments in SUMMARIZECOLUMNS
- Variables (VAR) to improve readability and avoid repeated calculations
- Shipped measures from measure-heavy KPI tables

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

1. Use the completed schema-query plan: exact shipped measures, grouping columns, filters,
   relationship path, expected columns, and row shape
2. Author one `EVALUATE` for each distinct query the plan requires, and execute each final query
   once with `run-dax-query` (see [Query Execution](#query-execution))
3. Treat an execution error as a query failure. A successful result is not by itself proof of
   correctness, and an empty one is not an error. Compare the reported columns, row count, sample,
   and warnings with the plan's exact output columns, row shape, filters, ordering, grain, and
   value expectations
4. Reject all-blank output, unexplained all-zero grouped output, distinct requested outputs that
   repeat the same measure/value, and all-rank-1 output when comparison or ordering is expected.
   These are semantic mismatches even when the command succeeds; do not build the UI from them
5. If an error or semantic mismatch remains, inspect the output-binding map, helper or parameter
   filter context, relationships, and filters; consult
   [dax-core-reference.md](./references/dax-core-reference.md), make one evidence-based correction
   to only the failing query, and re-test it
6. Stop each distinct planned query after it returns a structurally and semantically consistent
   result. Across the task, run one optional grain diagnostic for a shared ambiguity; for each
   distinct query, run one validation and at most one evidence-based corrective retry. Do not use
   this allowance for exploratory model probing or repeated discovery

Preserve the selected candidate by editing the validated query rather than regenerating it.

### Result reuse and stopping

- Before running a query, check whether a previous result already contains the answer. Never rerun
  an identical or equivalent DAX query.
- A zero scalar is valid. An all-zero grouped result is not validated for a task that expects
  meaningful comparison unless task or catalog evidence shows that all zeros are legitimate.
- For a blank or empty result, inspect the shipped measure, relationship path, grouping dimension,
  helper-table filter context, and filters. Make one correction; accept a corrected blank only when
  the requested semantics allow no data.
- If every grouped row returns the same measure value, first investigate a disconnected grouping
  table or ineffective filter propagation. Do not rewrite or replace the measure to manufacture
  variation.
- If every row ranks 1, verify that the rank expression evaluates over the intended comparison set
  and that filters did not collapse that set before accepting the result.
- On timeout, narrow filters, reduce grouping cardinality, apply `TOPN`, or simplify only the
  failing planned query. Never retry the same query unchanged.
- Preserve successful batched outputs. Correct only failed or semantically inconsistent files.

## Query Execution

Use:

```bash
npx fabric-app-semantic-model-tools run-dax-query \
  --dax src/queries/revenue.dax \
  --alias <alias>
```

Each `.dax` file must contain one `EVALUATE`; otherwise nothing executes. For two to four planned
queries, repeat `--dax` in one call:

```bash
npx fabric-app-semantic-model-tools run-dax-query --dax src/queries/a.dax --dax src/queries/b.dax --alias <alias>
```

The queries run one at a time, through the same connector operation as the running app. For each
query the command prints its status, output column names, row count, first rows
(`--sample <n>`, default 5), and warnings, not the full result. Warnings flag no rows, an all-blank
column, or a measure output (not a `Table[Column]` grouping column) that is all zero, constant, all
rank 1, or identical to another output; identical outputs are reported as one group. Warnings are
nonfatal prompts for review, not proof of correctness. A shortened preview is not complete shape
evidence.

A failed query keeps its own entry beside the successful ones, and the call exits 2: correct only
the failed queries. Missing, malformed, unreadable, or overflowed results never pass, and input or
read failures also exit nonzero; an error message alone does not show that a query ran. An
`overflow` result has no table; see
[semantic-model-data](../semantic-model-data/SKILL.md#error-categories).

**Row count:** a query returns every row unless you bound it. Bound it with the aggregation the plan
calls for, and use `TOPN(...)` only when the request asks for a ranked subset or to bound a query
that timed out. `--limit <n>` is a guard, not a cap: validation fails when more than `n` rows come
back.


## Troubleshooting

| Problem | Solution |
|---------|----------|
| A connector query fails because no Power BI token can be acquired without a sign-in prompt | Follow the recovery text printed with the error; re-running `npx rayfin login` does not fix it. |
| `query-schema` cannot resolve the connector, or a query names a connector that `rayfin/rayfin.yml` does not declare | Run `npx rayfin connector list` to check declared connectors, then `npx rayfin connector add` to register the intended model (see `AGENTS.md`) |
| DAX syntax errors | Consult [dax-core-reference.md](./references/dax-core-reference.md) — check reserved keywords, quoting rules, EVALUATE/scalar mistakes |
| Unexpected query results | Check filter context, relationship direction, BLANK handling in [dax-core-reference.md](./references/dax-core-reference.md#blank-semantics) |
| Time intelligence returns wrong values | Check date table prerequisites and critical rules in [dax-time-intelligence.md](./references/dax-time-intelligence.md) |
