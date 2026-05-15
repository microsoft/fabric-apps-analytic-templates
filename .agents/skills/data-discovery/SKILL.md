---
name: data-discovery
description: "Explore Power BI semantic model schemas, write/test DAX queries, and organize queries as .dax files in the app codebase. Uses INFO functions for progressive metadata discovery and provides comprehensive DAX authoring knowledge. Execute queries via the Fabric CLI `execute` command."
---

## Table of Contents

| Task | Reference | Notes |
|---|---|---|
| Must/Prefer/Avoid | [SKILL.md: Must/Prefer/Avoid](#must--prefer--avoid) | Guardrails for schema discovery and DAX generation |
| Progressive Discovery Strategy | [SKILL.md: Progressive Schema Discovery](#progressive-schema-discovery) | Decision tree for on-demand metadata fetching |
| Recommended Discovery Order | [SKILL.md: Recommended Discovery Order](#recommended-discovery-order) | Start with scope estimation -> tables -> columns -> measures -> relationships |
| Metadata Object -> INFO Function Map | [SKILL.md: Metadata Object -> INFO Function Map](#metadata-object---info-function-map) | Tables, columns, measures, relationships, calc groups, calendars, UDFs, variations |
| Scope Estimation Queries | [discovery-queries.md: Scope Estimation Queries](./references/discovery-queries.md#scope-estimation-queries) | Probe table/column/measure/relationship counts before deep discovery |
| INFO Output Columns | [discovery-queries.md: INFO Output Columns](./references/discovery-queries.md#info-output-columns) | INFO.VIEW.* (read access); INFO.* (may need elevated access) |
| Narrowing Results (Projection + Filtering) | [discovery-queries.md: Narrowing Results](./references/discovery-queries.md#narrowing-results-projection--filtering) | SELECTCOLUMNS + FILTER to reduce output volume |
| Advanced Metadata (Calc Groups, Calendars, UDFs) | [discovery-queries.md: Advanced Metadata Queries](./references/discovery-queries.md#advanced-metadata-queries) | INFO.CALCULATIONGROUPS, INFO.CALENDARS, INFO.USERDEFINEDFUNCTIONS, INFO.VARIATIONS |
| Complete INFO Function Catalog | [discovery-queries.md: Complete INFO Function Catalog](./references/discovery-queries.md#complete-info-function-catalog-dynamic) | Dynamic query to enumerate all INFO functions in the engine |
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
| Testing & Iteration | [SKILL.md: Testing & Iteration](#testing--iteration) | Execute -> inspect -> fix -> re-test workflow |
| Query Execution | [SKILL.md: Query Execution](#query-execution) | CLI execute command |
| Query File Convention | [SKILL.md: Query File Convention](#query-file-convention) | .dax + .json + .ts barrel in src/queries/ |
| Troubleshooting | [SKILL.md: Troubleshooting](#troubleshooting) | CLI issues, permission errors, syntax errors, unexpected results |

## Must / Prefer / Avoid

### Must
- Always test generated DAX via `npx fabric-app-data query <alias> --query '<DAX>'` before using in app code
- Use fully-qualified `'Table'[Column]` for column references
- Use simple `[Measure]` for measure references
- Use DEFINE for VAR and local MEASURE declarations (single DEFINE block, no commas)
- Prefer existing model measures over re-aggregating raw data

### Prefer
- INFO.VIEW functions for initial metadata discovery (read access, lightweight)
- SUMMARIZECOLUMNS as the primary grouping function for queries
- TREATAS for filter arguments in SUMMARIZECOLUMNS
- Variables (VAR) to improve readability and avoid repeated calculations
- Progressive schema discovery over full schema dumps

### Avoid
- SQL keywords (SELECT, WHERE, HAVING, etc.) within DAX expressions
- EVALUATE with scalar functions directly (wrap in ROW or table function)
- Fetching full schema upfront - discover incrementally based on need
- Re-fetching metadata already discovered in this conversation
- Using GetSemanticModelSchema, DiscoverArtifacts, or GenerateQuery MCP tools (these are not available)

## Progressive Schema Discovery

Discover metadata incrementally based on what the user actually needs.

### Strategy (Decision Tree)

```
User asks a question
  -> Do I know which tables are relevant?
    -> NO: Run INFO.VIEW.TABLES() to get table inventory
    -> YES: Do I know the columns/measures for those tables?
      -> NO: Run filtered INFO.VIEW.COLUMNS() and INFO.VIEW.MEASURES() for those tables
      -> YES: Do I need relationships?
        -> YES: Run INFO.VIEW.RELATIONSHIPS() filtered to those tables
        -> NO: Do I need advanced metadata?
          -> Have elevated INFO functions already failed in this session?
            -> YES: Skip - assume no permission for all elevated queries
            -> NO: Try the relevant elevated query:
              -> Calculation groups: INFO.CALCULATIONGROUPS() + INFO.CALCULATIONITEMS()
              -> Calendars: INFO.CALENDARS()
              -> User-defined functions: INFO.USERDEFINEDFUNCTIONS()
              -> Variations: INFO.VARIATIONS()
              -> If query fails with permission error: mark elevated access as unavailable
  -> Generate DAX using discovered schema
  -> Test via ExecuteQuery
```

### Rules

- **Start with scope estimation** - Run the scope probe query first to understand model size
- **Discover on demand** - Only fetch tables/columns/measures relevant to the current user request
- **Use INFO.VIEW functions first** (read access) - tables, columns, measures, relationships
- **Use INFO functions** (may need elevated access) for: calculation groups, calculation items, variations, user-defined functions, calendars
- **Handle permission failures gracefully** - If an elevated INFO function fails but INFO.VIEW.* functions succeeded, assume the user lacks elevated permissions and skip all elevated discoveries entirely
- **Always narrow results** - Use SELECTCOLUMNS + FILTER to fetch only needed columns and rows
- **Cache discovered schema mentally** - Don't re-fetch what you've already discovered in this conversation

### Recommended Discovery Order

1. **Scope estimation** - Count tables, columns, measures, relationships
2. **Tables** - Get table names, identify relevant ones
3. **Columns** - Get columns for relevant tables only
4. **Measures** - Get measures (prefer using these over raw aggregations)
5. **Relationships** - Get relationships between relevant tables
6. **Advanced metadata** (if needed) - Calculation groups, calendars, UDFs, variations

### Scope Estimation Query

```dax
EVALUATE
ROW(
    "TableCount", COUNTROWS(INFO.VIEW.TABLES()),
    "ColumnCount", COUNTROWS(INFO.VIEW.COLUMNS()),
    "MeasureCount", COUNTROWS(INFO.VIEW.MEASURES()),
    "RelationshipCount", COUNTROWS(INFO.VIEW.RELATIONSHIPS())
)
```

### Metadata Object -> INFO Function Map

| Metadata Object | Primary INFO Functions | Access Level |
|---|---|---|
| Tables | `INFO.VIEW.TABLES()` | Read |
| Columns | `INFO.VIEW.COLUMNS()` | Read |
| Measures | `INFO.VIEW.MEASURES()` | Read |
| Relationships | `INFO.VIEW.RELATIONSHIPS()` | Read |
| Model config | `INFO.MODEL()` | May need elevated |
| Calculation groups | `INFO.CALCULATIONGROUPS()`, `INFO.CALCULATIONITEMS()` | May need elevated |
| Calendars | `INFO.CALENDARS()`, `INFO.CALENDARCOLUMNGROUPS()`, `INFO.CALENDARCOLUMNREFERENCES()` | May need elevated |
| User-defined functions | `INFO.USERDEFINEDFUNCTIONS()` | May need elevated |
| Variations | `INFO.VARIATIONS()` | May need elevated |

For the full query catalog and output column details, see [discovery-queries.md](./references/discovery-queries.md).

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
2. Execute via `npx fabric-app-data query <alias> --query '<DAX>'`
3. Inspect results: check column names, data types, row counts, and actual data values
4. If error: consult [dax-core-reference.md](./references/dax-core-reference.md), fix, and re-test
5. Iterate until the query returns expected results
6. Promote finalized queries to the app codebase (see below)

## Query Execution

Use `npx fabric-app-data query <alias> --query '<DAX>'` to run queries. This uses the same SDK pipeline as the running app, so results are identical to what the app produces at runtime. To re-test an existing `.dax` file without copying the query text, use `--file`: `npx fabric-app-data query <alias> --file src/queries/revenue.dax`.

**Result trimming:** The CLI returns at most 1000 rows by default. When the result is trimmed, the output includes a `_cliWarning` field (e.g., `"Result trimmed to first 1000 of 5000 rows"`). This is a CLI-only limitation — the full dataset is available in the running app. If you need to see more data, refine your DAX with filters or aggregations.

## Promoting queries to the app

Once a query is validated, save it to the app codebase:

- Store each query as a **`.dax`** file and its Vega-Lite spec as a **`.json`** file under `src/queries/`, grouped by page or domain. A barrel **`.ts`** file imports both and exports a **factory function** that returns `{ connection, query, columnMetadata, vegaLiteSpec }`. The function accepts optional use-case-specific parameters that can modify the DAX query and/or the Vega-Lite spec. See the "Query & Spec Organization" section in `AGENTS.md` for the full convention.
- Name files after the visualization they drive using kebab-case (e.g., `revenue-by-region.dax`, `revenue-by-region.json`, `revenue-by-region.ts`). The factory function name is the camelCase version of the file name (e.g., `revenueByRegion`).
- Import `.dax` files with Vite's `?raw` suffix to get them as strings.
- **Capture column metadata** in the barrel `.ts` file as a `columnMetadata: ColumnMetadataMap` constant (import `ColumnMetadataMap` from `@/lib/to-data-table`). The dictionary **must be keyed by the exact column name from the CLI query output** (the `name` field in `table.columns`). Do not guess or clean these keys — copy them verbatim from the query result. Each value is a `ColumnDef` (from `@microsoft/fabric-visuals-core`) containing:
  - `name` — a cleaned-up identifier derived from the original column name by removing `.`, `[`, `]`, `\`, `"`, and `'` characters. E.g., `"Products[Region]"` → `"ProductsRegion"`, `"[Total Revenue]"` → `"Total Revenue"` - to be used when building visual specs.
  - `displayName` — a human-readable label sourced from the semantic model schema (e.g., `"Region"`, `"Total Revenue"`). Used for axis titles, grid headers, and tooltips.
  - `format` — a VBA/ECMA-376 format string for number/date formatting (e.g., `#,##0.00`, `0.00%`, and `mm/dd/yyyy`). Omit for text type columns.

**Example workflow:** Run `npx fabric-app-data query myModel --query '<DAX>'`, observe the output columns are `[SalesPersonID]` and `[Name]`, then use those exact strings as metadata keys:
```ts
export const columnMetadata: ColumnMetadataMap = {
  "[SalesPersonID]": { name: "SalesPersonID", displayName: "Sales Person ID" },
  "[Name]": { name: "Name", displayName: "Name" },
};
```

After promoting queries, switch to the `data-fetching` skill to wire them
into React components.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| CLI `execute` fails with "not signed in" | Run `az login` to sign in to Azure CLI |
| CLI `execute` fails with "Azure CLI is not installed" | Install from https://aka.ms/install-azure-cli |
| CLI `execute` fails with "alias not found" | Run `npx fabric-app-data list` to check available aliases, then `npx fabric-app-data add` to register |
| INFO functions return permission errors | Fall back to INFO.VIEW functions; mark elevated access as unavailable for this session |
| Metadata output too large | Use scope estimation + narrowing patterns from [discovery-queries.md](./references/discovery-queries.md) |
| DAX syntax errors | Consult [dax-core-reference.md](./references/dax-core-reference.md) - check reserved keywords, quoting rules, EVALUATE/scalar mistakes |
| Unexpected query results | Check filter context, relationship direction, BLANK handling in [dax-core-reference.md](./references/dax-core-reference.md#blank-semantics) |
| Time intelligence returns wrong values | Check date table prerequisites and critical rules in [dax-time-intelligence.md](./references/dax-time-intelligence.md) |
