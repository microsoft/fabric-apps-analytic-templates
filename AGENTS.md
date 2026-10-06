# Agent Instructions

## Purpose

You will help the user build a React web app that visualizes data from Power BI semantic models. The app fetches live data via DAX queries, renders charts and grids using Vega-Lite and a built-in DataGrid component, and supports light/dark theming. Your job is to discover the user's data, write correct DAX queries, validate visual query factories, and build React components that fetch and display that data.

## Semantic model schema (discover it progressively)

Before the first schema command, ensure the user- or task-provided semantic model is registered and
its connection alias is known. Never register an inferred or additional data source.

Discover the connected model's schema on demand with DAX `INFO.VIEW.*` queries run through `npx fabric-app-data query`. Fetch only what the current request needs: start with a scope probe, then tables, then columns and measures for the tables that are relevant.

Do **not** fetch the whole schema upfront, and do **not** rely on `src/fabric.generated.ts` for schema because it holds only connection aliases.

Complete the initial semantic-model discovery with the supplied connection details and model
metadata before inspecting generic application source files. Do not include `global.css`,
`package.json`, `App.tsx`, hooks, utilities, or broad `src/**` patterns in initial glob, search, or
read operations. After initial discovery, inspect only the files needed to implement the request.
When modifying existing behavior, relevant query files may be inspected earlier.

The [schema-discovery](.agents/skills/schema-discovery/SKILL.md) skill has the discovery order, INFO function map, and narrowing patterns.

## API discovery

Use exact symbol searches and the narrowest relevant public declaration or template-local source file to learn an API. Do not broadly list, search, read, or dynamically import package internals, compiled JavaScript bundles, or Vite dependency bundles. Read runtime implementation only when the task explicitly requires debugging behavior.

For visualizations backed by a Fabric semantic model, follow these four steps:

```tsx
// 1. barrel   src/queries/<page>/<viz>.ts exports { connection, query, columnMetadata, vegaLiteSpec }
// 2. fetch    const { data, isLoading, error } = useSemanticModelQuery({ connection, query });
// 3. shape    const table = toDataTable(data.table, columnMetadata);
// 4. render   <VegaVisual spec={vegaLiteSpec} data={table} theme={theme} />   // or <DataGrid data={table} theme={theme} />
```

When a component uses `useThemeContext()` or `useSemanticModelQuery()`, call the hook unconditionally at the top of the component before any loading or error return.

Runtime rules:

- **DAX failures do not throw from the SDK.** `useSemanticModelQuery` maps failed query results, transport failures, and unexpected runtime failures to its `error` field. Handle `error`, then require `data.status === "success"` before touching `data.table`.
- Key `columnMetadata` by the query's exact raw output column name. Give each entry a bracket-free `name` alias for Vega-Lite and DataGrid fields; raw names containing `.`, `[`, or `]` can render as `undefined`.
- Pass the resolved `theme` from `useThemeContext()` to `VegaVisual` and `DataGrid`.

## Project structure

```
fabric.yaml                # Fabric connection config
index.html                 # Vite entry HTML
vite.config.ts             # Vite + Tailwind build config
tsconfig.json              # TypeScript configuration
src/
├── fabric.generated.ts    # Connection aliases to workspace/item IDs
├── main.tsx               # App entry point
├── App.tsx                # Main dashboard layout
├── ErrorFallback.tsx      # Error boundary fallback UI
├── global.css             # Tailwind design tokens
├── data-palette-presets.json
├── components/
├── hooks/
├── lib/
├── queries/               # DAX, Vega-Lite specs, and factory functions
└── vite-env.d.ts
```

## Query and spec organization

Group query files by page or domain under `src/queries/`. Each visualization uses the same kebab-case base name for its `.dax`, `.json`, and `.ts` files.

- Keep all DAX in `.dax` files and import it with Vite's `?raw` suffix.
- Use separate `.dax` files when a parameter changes query structure.
- Export a factory returning `{ connection, query, columnMetadata, vegaLiteSpec }`.
- Key `columnMetadata` by exact query output names and map each to a Vega-safe `name`, user-facing `displayName`, and optional `format`.
- Re-export modules through an `index.ts` in each group and at the `src/queries/` root.
- Never define Vega-Lite specs inline in component files.

Validate each single-table visual immediately after completing its query factory and before UX design, editing `src/global.css`, or writing component code. Run `npm run validate:visual -- <query-factory.ts> [factory-params-json] [<query-factory.ts> [factory-params-json] ...]`, repeating a factory path for every relevant parameter variant. Run the validation command directly without piping it through `tail`, `grep`, `head`, or another command that can hide a nonzero exit status. Validate all completed factories in one command when possible, and do not proceed until every result passes.

After the required schema and query results are understood, load and follow the [app-design](.agents/skills/app-design/SKILL.md) skill before writing presentation code.

## Unit tests

Co-locate each spec file with the source file it tests.

- Always test pure utility functions in `src/lib/` and query factories in `src/queries/`. For factories, verify that parameter combinations produce the correct query string, column metadata, and spec modifications.
- Test hooks as needed for state transitions, returned values, and side effects using a React hooks testing library.
- Test components with non-trivial logic, such as conditional rendering, derived state, or error states. Simple presentational components do not need a spec file.
- Write tests to document expected behavior or guard against regressions, not just to satisfy coverage targets.
- Use representative fixtures matching the real query column shape; do not substitute invented query results.
- Keep each spec focused on one unit; do not write integration tests that span multiple layers.

## Critical rules

1. **Never use mock, fake, or hardcoded data.** All data must come from a real source.
2. **Never store data in memory or local storage.** Fetch on demand from the real source.
3. **Do not assume or silently add a data source.** Confirm the source with the user and never supplement it without explicit consent.
4. **Never guess query result schema.** Run the query first and use its exact output names.
5. **Do not ask the user to describe the schema.** Discover it with DAX `INFO.VIEW.*` queries.
