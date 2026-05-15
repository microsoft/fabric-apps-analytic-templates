# Agent Instructions

## Purpose

You will help the user build out this React-based web app that visualizes data from Power BI semantic models. The app fetches live data via DAX queries, renders charts and grids using Vega-Lite and a built-in DataGrid component, and supports light/dark theming. Your job is to discover the user's data, write correct DAX queries, build React components that fetch and display that data, and validate the result in the browser.

## Sub-Agent Delegation

Break tasks into independent pieces and delegate them to sub-agents running in parallel. Don't do work sequentially when it can be done concurrently.

For example, when building a new dashboard page: a sub-agent finds the semantic model and discovers its schema. Separate sub-agents write the DAX query files, then have separate sub-agents build each component in parallel once the queries are ready.

## Project Structure

```
fabric.yaml                # Fabric connection config (managed by `npx fabric-app-data`)
index.html                 # Vite entry HTML
vite.config.ts             # Vite + Tailwind build config
tsconfig.json              # TypeScript configuration
src/
├── fabric.generated.ts    # Auto-generated from fabric.yaml — connection aliases → workspace/item IDs
├── main.tsx               # App entry point
├── App.tsx                # Main dashboard layout
├── ErrorFallback.tsx      # Error boundary fallback UI
├── global.css             # Tailwind v4 @theme design tokens
├── components/            # Dashboard UI components (cards, charts, banners)
├── hooks/                 # React hooks (data fetching, theming)
├── lib/                   # Utilities, Fabric client
├── queries/               # DAX queries (.dax) + Vega-Lite specs (.json) + factory functions (.ts), grouped by page/domain
└── vite-env.d.ts          # Vite type declarations
```

### Query & Spec Organization

DAX queries and Vega-Lite specs live in `src/queries/`, grouped by dashboard page or domain. Each visualization gets files sharing the same kebab-case base name: one or more `.dax` files for queries, a `.json` file for the Vega-Lite spec, and a `.ts` factory file that imports them and exports `{ connection, query, columnMetadata, vegaLiteSpec }`. The factory function accepts optional parameters to select between query variants or modify the spec:

```
src/queries/
├── index.ts                            # Re-exports all query modules
├── {page-or-domain}/                   # Group by dashboard page or domain
│   ├── {visualization-name}.dax        # DAX query (plain text)
│   ├── {visualization-name}-{variant}.dax  # Additional query variants (optional)
│   ├── {visualization-name}.json       # Vega-Lite spec (JSON)
│   ├── {visualization-name}.ts         # Factory function: imports .dax + .json, exports { connection, query, vegaLiteSpec, columnMetadata }
│   └── index.ts                        # Re-exports all visualizations in this group
```

#### Example TS File

**`revenue-by-region.ts`** — the factory function accepts use-case-specific parameters and uses them to modify the DAX query and/or Vega-Lite spec as appropriate:
```ts
import type { VisualizationSpec } from "@microsoft/fabric-visuals";
import type { ColumnMetadataMap } from "@/lib/to-data-table";
import baseQuery from "./revenue-by-region.dax?raw";
import spec from "./revenue-by-region.json";

const connection = "{connection-alias}";  // from fabric.yaml

/** Column metadata keyed by original DAX column name. */
const columnMetadata: ColumnMetadataMap = {
  "Products[Region]": { name: "ProductsRegion", displayName: "Region" },
  "[Total Revenue]": { name: "Total Revenue", displayName: "Total Revenue", format: "$#,0.00" },
};

interface RevenueByRegionParams {
  /** Filter to specific product categories (modifies the DAX query). */
  categories?: string[];
  /** Only show regions with revenue above this threshold (modifies the Vega-Lite spec). */
  minRevenue?: number;
}

export function revenueByRegion(params?: RevenueByRegionParams) {
  let query = baseQuery;
  let vegaLiteSpec = spec; // Should clone if modifying

  if (params?.categories?.length) {
    // make changes to the DAX query to filter by the specified categories and update the query variable
  }

  if (params?.minRevenue != null) {
    // Clone spec and append a client-side filter transform to the Vega-Lite spec
  }

  return { connection, query, columnMetadata, vegaLiteSpec };
}
```

The parameters, their types, and how they modify the query or spec are **entirely use-case-specific**. Some visualizations may need no parameters at all; others may accept date ranges, top-N limits, grouping dimensions, or string search terms. The factory function is the single place that translates caller intent into DAX and/or Vega-Lite modifications.

#### Query variants with multiple `.dax` files

When a parameter changes the **structure** of the query (e.g. different GROUP BY columns, different aggregations), use separate `.dax` files for each variant. The factory function selects the right one:

```
revenue-trend/
  revenue-trend-yearly.dax
  revenue-trend-quarterly.dax
  revenue-trend-monthly.dax
  revenue-trend.json
  revenue-trend.ts
```

```ts
import yearlyQuery from "./revenue-trend-yearly.dax?raw";
import quarterlyQuery from "./revenue-trend-quarterly.dax?raw";
import monthlyQuery from "./revenue-trend-monthly.dax?raw";

type Granularity = "yearly" | "quarterly" | "monthly";

const queryByGranularity: Record<Granularity, string> = {
  yearly: yearlyQuery,
  quarterly: quarterlyQuery,
  monthly: monthlyQuery,
};

export function revenueTrend(params?: { granularity?: Granularity }) {
  const query = queryByGranularity[params?.granularity ?? "monthly"];
  return { connection, query, columnMetadata, vegaLiteSpec };
}
```

**Consumer examples:**
```tsx
import { revenueByRegion } from "@/queries/sales/revenue-by-region";

// No params — returns the base query and spec as-is
const { connection, query, columnMetadata, vegaLiteSpec } = revenueByRegion();

// With parameters
const viz = revenueByRegion({
  categories: ["Electronics", "Clothing"],
  minRevenue: 500,
});
const { data } = useSemanticModelQuery({ connection: viz.connection, query: viz.query });
```

**Key rules:**
- **All DAX lives in `.dax` files.** Never inline full DAX query strings in `.ts` factory files. If a parameter changes the query structure, create a separate `.dax` file for each variant and select the right one in the factory function. Small modifications — such as replacing filter value placeholders, wrapping the query with `CALCULATETABLE` to apply filters, or substituting a column reference — are acceptable in `.ts`, but the base query must always come from a `.dax` import.
- **Name files after the visualization they drive.** Use kebab-case base names (e.g., `revenue-by-region.dax`, `revenue-by-region.json`, `revenue-by-region.ts`). Variant `.dax` files append a suffix (e.g., `revenue-trend-yearly.dax`, `revenue-trend-quarterly.dax`).
- **Use `.dax` for queries.** Plain-text DAX files keep queries readable and diff-friendly. Import them with Vite's `?raw` suffix.
- **Use `.json` for specs.** JSON files get free schema validation in editors and are importable as modules by default in Vite.
- **Barrel `.ts` exports a factory function.** The function name is the camelCase version of the kebab-case file name (e.g., `revenueByRegion` for `revenue-by-region.ts`). It accepts optional parameters (typed per use case) and returns `{ connection, query, columnMetadata, vegaLiteSpec }`.
- **Group by page/domain.** Use subfolders when the dashboard has multiple pages or logical sections. For simple single-page dashboards, a flat structure under `src/queries/` is fine.
- **Re-export via `index.ts`.** Each subfolder and the root `src/queries/index.ts` should re-export all modules for clean imports.

## Testing & Spec Files

Add spec files alongside source files as needed — for components, hooks, utilities, and query factory functions. Co-locate each spec file with the file it tests

**When to add spec files:**
- **Always** for pure utility functions in `src/lib/` — these are easiest to unit-test and most likely to have edge cases.
- **Always** for query factory functions in `src/queries/` — verify that parameter combinations produce the correct query string, column metadata, and spec modifications.
- **As needed** — for hooks, test state transitions, returned values, and side effects using a React hooks testing library.
- **As needed** — for components, add spec files when the component contains non-trivial logic (e.g., conditional rendering, derived state, error states). Simple presentational components with no logic do not need a spec file.

**Key rules:**
- Never create a spec file just to satisfy coverage targets. Write tests only when they document expected behavior or guard against regressions.
- Tests must not use mock or hardcoded data to stand in for real query results — use representative fixture data that matches the real column shape.
- Keep each spec focused on one unit; do not write integration tests that span multiple layers.

## Key Conventions

- **Path alias**: `@/` maps to `src/` (configured in both `tsconfig.json` and `vite.config.ts`)
- **Styling**: Tailwind CSS v4 utility classes for all styling. Theme colors are defined as CSS custom properties in `src/global.css` using `@theme`. Use Tailwind classes directly in JSX.
- **Theming**: Light/dark color tokens defined in `src/global.css` via CSS custom properties. Dark mode uses the `.dark` class on the root `html` element, auto-detected via `prefers-color-scheme`, `data-appearance` attribute, or `.dark` class. The `useAppTheme` hook in `src/hooks/use-theme.ts` manages the toggle.
- **CSS class merging**: Use `cn()` from `@/lib/utils` (powered by `clsx` + `tailwind-merge`) to conditionally combine Tailwind class names.
- **Icons**: Lucide React for UI icons.
- **UI Components**: Use Radix primitives with Tailwind CSS styling for all interactive elements — buttons, inputs, dialogs, menus, tabs, etc.
- **Error handling**: App is wrapped in `react-error-boundary`.
- **TypeScript**: `strict` mode enabled.

### UI Token Rules

All styling must use the design tokens defined in `src/global.css` via Tailwind utility classes. Never hardcode raw color values, pixel sizes, or font stacks — raw values are only permitted in `global.css` where the tokens are defined. Refer to `global.css` for available tokens, their values, and expected usage.

Examples:
- `bg-primary text-primary-foreground` — not `bg-blue-600 text-white`
- `text-300` — not `text-sm` or `text-[14px]`
- `p-l gap-m` — not `p-4`, `gap-3`, `p-spacing-l`, or `gap-spacing-m`
- `font-semibold` — not `font-[600]`
- `rounded-xl` — not `rounded-[8px]`
- `icon-size-200` — not `w-4 h-4`

**`cn()` and tailwind-merge conflicts:** `tailwind-merge` treats `text-*` utilities as one conflict group. In `cn()`, combining text size and text color with ambiguous `text-*` classes can drop one class. Prefer explicit length syntax for font size (e.g., `text-[length:var(--text-300)]`) when combining with text color classes inside `cn()`. If classes are static and not merged, `text-300 text-foreground` is acceptable.

**Form element font inheritance:** Native form controls may not inherit the page font family by default. Ensure base styles in `global.css` set `font-family: inherit` for `select`, `input`, `textarea`, and `button`.

## Recommended Workflow

Recommend following these steps when building or modifying the dashboard unless the user instructs otherwise.

The workflow has three distinct phases:
- **Authoring phase** (Steps 1–3): You explore data and validate queries using the Fabric CLI `execute` command (backed by the same SDK used at runtime). No app code is written yet.
- **Design phase** (Step 4): You design the web app UX before writing any runtime code. This requires the [app-design skill](.agents/skills/app-design/SKILL.md). You create theming tokens in `src/global.css` according to the theming direction and plan how to cohesively apply them across components.
- **App code phase** (Steps 5–7): You write React components that fetch data at runtime using the Fabric SDK.

### 1. Ask the user for a semantic model

**Local `.pbix` files are not supported.** This app connects to semantic models published to the Power BI Service (cloud), not to local `.pbix` files on disk. If the user provides a local file path (e.g., `C:\...\Model.pbix`), **do not** attempt to open, upload, or search for it. Instead:
1. Inform the user that local `.pbix` files are not supported — only models published to the Power BI Service can be used.
2. Ask the user whether they would like to:
   - **Search the Power BI Service** for a semantic model by name (you will search on their behalf), or
   - **Provide a specific online model** directly (workspace ID + dataset ID, or a Power BI / Fabric URL).

Once the user confirms a published semantic model, read the [data-discovery](.agents/skills/data-discovery/SKILL.md) skill to progressively discover schema metadata as needed — do not fetch the full schema upfront.

Once the model is identified, register it as a connection using the Fabric CLI (see the [fabric-cli](.agents/skills/fabric-cli/SKILL.md) skill for full command reference):
```bash
npx fabric-app-data add <alias> --from-url "<Power BI or Fabric URL>"
npx fabric-app-data generate -o src/fabric.generated.ts
```

### 2. Ensure query execution is available

Before any data work, verify you can execute DAX queries using the Fabric CLI `execute` command. This uses the same SDK pipeline as the running app — ensuring identical results between authoring and runtime.

**Prerequisites:**
- Azure CLI installed and signed in (`az login`)
- A semantic model registered via `fabric-app-data add` (see Step 1)

Test with: `npx fabric-app-data query <alias> --query "EVALUATE ROW(\"test\", 1)"`

### 3. Write and test DAX queries (authoring phase)

Follow the [data-discovery](.agents/skills/data-discovery/SKILL.md) skill to write and test DAX queries. The skill covers progressive schema discovery, DAX query authoring, and time intelligence.

Use `npx fabric-app-data query <alias> --query '<DAX>'` to test queries. This runs the query through the same SDK pipeline used at runtime, so the results (column names, data types, row structure) are identical to what the app will produce. If a `--query` command fails due to shell escaping issues with special characters, write the query to a `.dax` file and retry with `--file` instead.

Iterate on queries until they return the expected columns and data shape.

**Tip:** Delegate query exploration to a sub-agent. It can discover the schema, draft queries, and test them in parallel while you plan the component structure.

Once queries are validated, **promote them to the app:**
1. Save each query as a `.dax` file in `src/queries/` following the "Query & Spec Organization" convention above.
2. **Capture column metadata** — copy the exact column names from the query output (`table.columns[].name` values) as dictionary keys. For each column, record its `name` (a cleaned-up identifier with `.`, `[`, `]`, `\`, `"`, and `'` characters removed from the original column name), `displayName` (human-readable label from the model schema), and `format` (VBA/ECMA-376 format string). Define this as a `columnMetadata: ColumnMetadataMap` constant in the barrel `.ts` file, keyed by the **exact original column name from the query result** (e.g., `"[SalesPersonID]"`, not `"SalesPersonID"`). `ColumnMetadataMap` is `Record<string, ColumnDef>` where `ColumnDef` comes from `@microsoft/fabric-visuals-core`.
3. Create the corresponding `.json` Vega-Lite spec — refer to [visuals](.agents/skills/visuals/SKILL.md). Use the cleaned `name` values from the metadata for Vega-Lite field encodings (they are already free of characters that require escaping). Use `displayName` values for axis titles, legend labels, and tooltip headers. Use `format` values for axis/tooltip formatting.
4. Create the barrel `.ts` file with a **factory function** (camelCase of the file name) that accepts optional use-case-specific parameters and returns `{ connection, query, columnMetadata, vegaLiteSpec }`. The parameter types are defined per barrel — design them for the specific visualization's needs.

### 4. UX Design for the app

Principles for overall aesthetics, theming, layout, and accessibility requirements are outlined in [app-design](.agents/skills/app-design/SKILL.md) skill - refer to it before creating or modifying any UI component, layout, page, or style.

### 5. Build components with data (app code phase)

Follow the [data-fetching](.agents/skills/data-fetching/SKILL.md) skill to wire queries to React components. Use the `useSemanticModelQuery` hook from `src/hooks/use-semantic-model-query.ts` — components call the factory functions from `src/queries/` and destructure `{ connection, query, columnMetadata, vegaLiteSpec }` from the result.

Use `toDataTable()` from `src/lib/to-data-table.ts` to convert the SDK's `QueryTable` (from `data.table`) into a `DataTable` by merging it with the `columnMetadata` from the factory function result. This applies everywhere the data is consumed like rendering in `VegaVisual` or `DataGrid` (pass the `DataTable` via their `data` prop), displaying values in custom components, or any other usage.

`VegaVisual` and `DataGrid` components should call factory functions for query + spec + columnMetadata — never define specs inline in component files. Refer to the [visuals](.agents/skills/visuals/SKILL.md) skill when building them.

### 6. Final validation

Follow the [app-validation](.agents/skills/app-validation/SKILL.md) skill (what to check, performance rules, Fabric portal embed flow) together with the [playwright-cli](.agents/skills/playwright-cli/SKILL.md) skill (the tool itself) to validate the app in the browser. Fix any issues before considering the task complete. The app can **only** be ran and validated with the Fabric portal embed flow, app-validation skill covers how to do this with the right browser flags and auth setup.

## Critical Rules

1. **NEVER use mock, fake, or hardcoded data.** All data must come from a real source. If unsure where data should come from, stop and ask the user before writing any code.
2. **Never store data in memory or local storage.** Fetch on demand from the real source.
3. **Do not assume a data source.** Always confirm with the user first.
4. **Never guess query result schema (e.g. column names).** Always run the query with `npx fabric-app-data query` first and use the exact column names from the output as metadata keys. The CLI output is identical to what the app receives at runtime.
5. **Do not use any data source without explicit user consent.** If any required data has not already been provided or consented to by the user, **stop and ask the user** before using any additional data sources. This includes (but is not limited to) additional Power BI semantic models and non-Power BI external sources (web search, web APIs, public datasets, scraped web content, or any non-Power BI data). Never silently supplement user-provided data with additional sources.
6. **Do not ask the user to describe the data schema.** Use DAX INFO functions via `fabric-app-data query` to discover metadata progressively. Refer to the [data-discovery](.agents/skills/data-discovery/SKILL.md) skill for discovery query patterns.
7. **ALWAYS run browser validation after UI changes.** Read the [app-validation](.agents/skills/app-validation/SKILL.md) skill. Do NOT skip any validation steps in favor of brevity.
