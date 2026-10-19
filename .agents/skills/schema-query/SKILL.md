---
name: schema-query
description: Ground DAX work in the cached semantic-model catalog, shipped measures, relationships, and explicit filter values.
---

# Grounding semantic-model work

**Prerequisite:** register the task's semantic model as a Rayfin connector first (AGENTS.md
"Connector setup"):
`npx rayfin connector add --type fabric-semanticmodel --name <name> --workspace-id <workspaceId> --item-id <itemId>`.
Until then `query-schema` has no model to catalog and exits with that command.

The semantic model's own catalog is cached as a local SQLite database and queried with SQL:

```bash
npx fabric-app-semantic-model-tools query-schema "SELECT [Name], [Expression] FROM info_view_measures WHERE [Table] = 'Sales'"
```

Quote identifiers in inline SQL with SQLite brackets (`[Table]`, `[Max Length]`), which pass
unchanged through both bash and PowerShell. Inline SQL is fine for model identifiers and literals
quoted as `[...]` / `'...'` (double any `'` inside a literal), including LIKE patterns with `%`,
even when they came from earlier catalog output. Put the SQL in a `.sql` file and pass
`--file <file.sql>` only when a name or value contains `"`, `` ` ``, `$`, `\`, or a newline, or
when it embeds free-form text from the user. In a LIKE pattern, don't write a whole environment
variable name between two `%` signs (e.g. `%PATH%`, `%DATE%`); use
`instr(lower([Name]), 'path') > 0` instead.

`--search` and `--sql` are repeatable and run in one process, so ask everything you already know
you need in one command rather than one command per question:

```bash
npx fabric-app-semantic-model-tools query-schema --search "revenue margin" --sql "SELECT [Name], [Expression] FROM info_view_measures WHERE [Table] = 'Sales'" --sql "SELECT [Name], [DataType] FROM info_view_columns WHERE [Table] = 'Sales'"
```

Each invocation costs a full model round trip, and a round trip re-sends the whole conversation, so
three separate commands cost roughly three times what one batch does. Batch the questions you can
write down now; keep a question whose *content* depends on an earlier answer for the next command.
Up to 8 statements per invocation.

The whole batch shares one result-size budget — the same one a single statement gets — divided
between the statements, with each statement's unused share rolling forward to the next. So batch
**focused** statements. A statement that returns a lot is truncated to its own share; later
statements keep their share of the budget. Run a query you expect to return a lot in its own
command so it gets the whole budget.

Each statement's result is labelled with the query that produced it, searches first, then SQL. A
statement that fails stays in the output beside the ones that succeeded. The exit code is the worst
outcome across the batch: 1 if any statement failed, 2 if any was truncated, 0 otherwise.

The database builds itself on first use and rebuilds when stale, so ask a question rather than
refreshing it by hand. `.schema/models/<itemId>/catalog.md` names every table, its real row and
column counts, and how the tables join; read it once and the rest is ordinary SQL.

The tables hold the untouched output of `INFO.VIEW.TABLES()`, `INFO.VIEW.COLUMNS()`,
`INFO.VIEW.MEASURES()`, `INFO.VIEW.RELATIONSHIPS()` and `COLUMNSTATISTICS()`, under the model's own
column names. Nothing is renamed, flattened, or summarized, so a column you see in the catalog is a
column DAX returned.

Besides metadata, the catalog stores the `COLUMNSTATISTICS()` output, including each column's
`Min`/`Max` sample values. It lives locally under `.schema/models/`, which is git-ignored and
rebuilt on demand; SQL queries read only that local copy.

Do not hand-run exploratory `INFO.*` queries, read the catalog database directly, bypass the catalog
with connector probes, or ask the user for metadata the catalog can answer.

## Querying

Every query starts with result metadata including `totalRows`, `returnedRows`, and `truncated`.
Zero rows is a successful answer, not an error; it means the model has no such entity.

Results are capped by row count and by size, so filter in SQL instead of selecting whole tables and
reading the overflow. **A result with `truncated: true` is incomplete and cannot be used to choose
model objects or author DAX.** The command exits with code 2 after printing the bounded preview.
Narrow the `WHERE` clause and/or projection and rerun until the entities needed by the plan appear
in a result with `truncated: false`. `SELECT *` on `info_view_measures` will truncate on a large
model; selecting only the required metadata and filtering by table, name, folder, description, or
expression will not.

The connection is read-only. A failing query comes back as an error message, so a malformed query
costs one retry, not a corrupted cache.

## Column statistics

`column_statistics` carries `Min`, `Max`, `Cardinality` and `Max Length` for each column. Use them
to choose grouping columns, bound date and numeric filters, and anticipate result size.

They are not a substitute for the model's logic. When a shipped measure computes the same quantity,
use the measure: a statistic is the raw column extent, ignoring filter context, relationships, and
any business rule the measure encodes. A column whose cardinality happens to match an expected row
count is not evidence that reading it is correct.

If `column_statistics` is missing from the catalog, the model did not return statistics. Continue
without them.

## Global semantic discovery

Search the whole catalog before restricting discovery to a domain-looking table prefix. Helper,
parameter, selector, calculation, and metadata tables may have names that do not share the user's
term or the primary fact-table prefix. Search table names and descriptions, measure names,
descriptions, expressions, and display folders, and column names and descriptions in one query.
Start with the ranked catalog-wide search, replacing the terms with the user's concepts:

```bash
npx fabric-app-semantic-model-tools query-schema --search "requested concept comparison"
```

Every search token must appear somewhere in an entity's name, parent table, description, display
folder, expression, or type. Exact and prefix name matches rank above descriptive or expression
matches, and shipped measures rank above columns at the same lexical relevance. After the global
result identifies candidate tables, run a focused, untruncated SQL query for their measures,
columns, descriptions, and expressions. Do not begin with a domain-prefix restriction: that can
hide a helper, parameter, selector, or measure owned elsewhere.

Search is a findability surface, not a reading surface. Ranking sees every field in full, but the
printed rows omit a `description` that is identical across the model and shorten a long
`expression` to its head plus its length. The result's `trimmed` counts say when either happened.
Both fields are still matched, so nothing becomes unfindable — `SELECT` the row when you need the
full text. Do not treat a shortened expression as the measure's definition.

## Model-facing workflow

1. Read `catalog.md` once when orientation is needed. Do not fetch it again in the same task.
2. Run global semantic discovery across tables, measures, and columns before applying a
   domain-specific table-name restriction.
3. Start with shipped measures. Whenever a table becomes part of the plan, inspect measures owned
   by that table before authoring DAX. Query all selected tables in one statement using `IN` or
   `OR`, returning at least `[Table]`, `[Name]`, `[Expression]`, `[Description]`,
   `[FormatString]`, and `[DisplayFolder]`. Never reconstruct business logic from columns when the
   model already ships the measure. A single-table query on `info_view_tables` (no JOIN, comma
   join, or UNION) automatically includes bounded `ownedMeasures` for each returned table; review
   those before choosing physical columns.
4. Answer several known metadata questions in one command. Combine them into one statement with a
   join or an `OR` where they share a shape; where they do not, pass them as repeated `--sql`
   (and `--search`) flags in a single invocation. Either way it is one round trip. One command per
   question is the single most expensive habit in discovery.
5. Take explicit filter values from the request, and bind every other qualifier in it to a filter
   too. A qualifier can imply a value the request never states: the complement of a named value,
   one section of a parameter or selector table, a status or flag. Take such values from the model
   (a parameter table's `[Expression]`, a column's `column_statistics` `[Min]`/`[Max]`), not from
   guesses. Apart from those statistics the catalog holds no other row values, but a
   parameter or calculated table (for example a `DATATABLE`) shows its literal rows in
   `info_view_tables.[Expression]`; read that expression before inventing labels or keys. Do not
   probe the model for row values during discovery. When a value needs confirmation, add one small
   value-check query file
   (for example `EVALUATE FILTER(VALUES('Customer'[Country]), 'Customer'[Country] = "Canada")`) to
   the same final `run-dax-query` call. The value check counts toward that call's four-file limit;
   when the plan already has four queries, fold the check into one of them or run it in the next
   call. An empty value-check result is the signal to correct that value once.
6. Before another schema request, check whether an earlier result already answers the question.
   Never rerun an identical or equivalent schema query.
7. Stop discovery only after every requested output field has an exact source mapping; the shipped
   measures, grouping columns, relationship path, and filter grain are grounded; every explicit
   filter value is bound to its exact column (its value comes from the request and, if needed, is
   confirmed by the value check in step 5, not by more discovery); every qualifier in the request
   is bound to a filter, including implied ones (step 5); and no mapping depends on a truncated
   result.
8. Write and validate the DAX with the [dax-authoring](../dax-authoring/SKILL.md) skill.

## DAX plan and semantic grain

Before writing DAX, form a compact plan containing:

- every requested output field;
- the exact source for each field: a fully qualified grouping/label column, an exact shipped
  measure name for every business value, or an explicit literal;
- exact filters and values, including the ones the request implies rather than names;
- relevant relationship path;
- expected output columns and row shape;
- unresolved filter candidates, if any.

Keep this plan in your working notes; do not write it to a file. `run-dax-query` does not know the
plan, so compare the columns, row count, and warnings it reports with the plan yourself.

Do not generate DAX until every requested business value is bound to an exact shipped measure and
every label/group is bound to an exact column. If exhaustive, untruncated measure discovery
establishes that no suitable measure exists, record both the missing measure and the catalog
evidence before declaring a different source. Partial measure results are not evidence that a
measure is absent.

A selected table is not fully inspected until its owned measures have been reviewed. This is
especially important for helper, parameter, selector, calculation, and metadata tables: their rows
may provide labels or filter context while an owned measure returns the requested value. Group by
the helper column and evaluate the shipped measure; do not invent one expression per row from
similarly named physical columns. If owned measures do not explain the table's semantic role,
search measure expressions for references to that table before falling back to raw aggregation.

If a catalog refresh fails, or would drop a view the previous catalog has (for example a throttled
`INFO.VIEW.MEASURES()`), the previous database is kept rather than replaced by the partial
build, the query is answered from it, and stderr prints a warning naming the catalog's age and
what failed. A refresh that is incomplete only in views the previous catalog also lacked is
published with an incomplete-catalog warning. Continue discovery from that cache. Treat the warning
as a reason to avoid freshness-sensitive assumptions, not as permission to ignore the cached
catalog. When no previous catalog exists, a partial build is still used and a warning says which
views are missing.
