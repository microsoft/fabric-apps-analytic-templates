## Data-app visuals instructions

These data-app-specific validation and theme instructions supplement the shared
visuals guidance above.

### Data-app visual validation

After completing each single-table VegaVisual query factory or KPI embedded
Vega-chart factory, and before UX design, `src/global.css`, or component work, run:

```sh
npm run validate:visual -- <query-factory.ts> [factory-params-json] [<query-factory.ts> [factory-params-json] ...]
```

Repeat factory paths for relevant parameter variants; validate completed factories
in one command when possible. Run directly without a pipe hiding failures.
The template's local validator executes DAX through a signed-in connector,
renders headlessly, fails on zero visible marks, and checks at most the first
1,000 rows. Do not broaden its input contract to inline rows or several named
tables. Use browser checks for flows outside that contract. Do not proceed until
required results pass.

Spec-less KPI callout, change and custom-region factories cannot use this
Vega validator. Follow the shared KPI reference's DAX validation and rendered-card
checks instead; do not invent a dummy Vega spec to pass validation.

### Local visual types and context

For KPI cards, follow the shared [KPI card authoring](references/kpi-card-visual.md).
For Flint specifications, follow [Flint spec authoring](data-app/flint-authoring.md).

Follow [app-design](../app-design/SKILL.md) for presentation and
[visual-interactivity](../visual-interactivity/SKILL.md) for the template's
managed interactions, query factories, highlighting and grid totals.
Use the resolved `useThemeContext().theme` from the local theme hook.
It derives from the same source as the shared examples' `useCssTheme()`.

### VisualContainer defaults for every visual

Follow the shared [container reference](references/visual-container.md)
for framing and actions; KPI-specific framing is documented in the shared KPI reference.
