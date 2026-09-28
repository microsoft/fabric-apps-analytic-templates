---
name: app-design
description: >
  Use when building or modifying the app layout, 
  creating UI components, or making any visual design decisions. 
  Ensures consistency, accessibility, and a polished, unique app.
---

# App Design

Your job is to build cohesive, distinctive apps — not just correct ones. Add character through intentional design decisions — typography pairing, color emphasis, spatial rhythm, and a clear visual point of view.

## Aesthetic Direction

Before building anything, decide the app's tone in one word and its signature detail — the one thing someone notices first. These two choices guide every decision that follows. Pick a tone that is specific and bold, not safe or generic. Examples like editorial, geometric, organic, industrial, playful, or minimal are starting points — don't limit yourself to these. Invent a direction that fits the app's purpose.

Then match your execution to your direction — a maximalist direction needs layered effects and rich detail in the code; a minimalist direction needs precise spacing, restraint, and careful typography. Elegance comes from committing to the direction fully, not from adding more.

### Typography

Pick fonts that set the app's character — this is one of the strongest signals of intentional design. At minimum choose a characterful `--font-heading` paired with a complementary `--font-base`, ideally from the same foundry or design family. Update `--font-monospace` and `--font-numeric` if necessary. Avoid generic defaults like Arial, Inter, or Roboto.

Load fonts via Google Fonts (or another CDN) as `<link>` tags in `index.html`, include `crossorigin="anonymous"` on each font stylesheet link, then update the font family tokens in the `@theme` block of `global.css`.

Style the primary page heading with `font-page-title` and its subtitle with `font-page-subtitle`.

### Theming Workflow

Start by customizing `src/global.css` — this is the single source of truth for the app's active visual identity. Every component uses these tokens, so setting them first means the entire UI shifts together.

1. **Colors**: Customize the semantic color tokens (`--color-primary`, `--color-background`, `--color-card`, `--color-border`, etc.) in their existing blocks and corresponding `.dark` overrides. The defaults are neutral blue/grey — make them yours.
2. **Data palette**: Follow the [data color rules](../visuals/references/formatting.md#categorical-color-palette), including `.dark` overrides. Populate `src/data-palette-presets.json` with three alternatives distinct from the active palette, each with a kebab-case `id`, a concise `name`, and `colors.light` / `colors.dark` arrays of exactly ten six-digit hex colors in token order.
3. **Radius**: Adjust `--radius` (the base radius) and the radius scale to match the tone — sharp/geometric (lower values), soft/rounded (higher values), or pill-shaped (`--radius-full`).
4. **Fonts**: Update the font family tokens as described in the Typography section above.
5. **Then build components.** Focus component-level styling on layout, spacing, and element-specific details — not re-specifying colors and radii that the tokens already handle.
6. **Selective overrides last.** After the base theme is in place, inspect and adjust individual components that need to deviate — an accent-colored card border, a button with a unique hover effect, etc.

---

Keep these principles in mind:
- Use semantic color tokens so surfaces, text, and borders adapt correctly to light and dark mode.
- Maintain sufficient contrast between text and backgrounds.
- The recommended minimum text size is `text-200`. 
- Keep spacing consistent — use the spacing tokens from the theme rather than arbitrary values.
- Ensure all interactive elements are keyboard-accessible with visible focus indicators and appropriate disabled states.

Read these reference files — they include "Make it yours" prompts that tie back to the aesthetic direction above:
- [UI Style Recipes](references/ui-style-recipes.md) — per-element styling guidance for buttons, cards, inputs, dialogs, tabs, tooltips, tables, and more.
- [Visual Style Recipes](references/visual-style-recipes.md) — chart theming, Vega-Lite config, dark mode chart support, and mark-specific styling.

---

## App Layout

These are good defaults for app structure. Adapt them to the specific app's needs.

### Page Structure

- The app layout should fill the viewport.
- On wide screens, constrain the content width so it doesn't stretch uncomfortably. Use responsive breakpoints or multi-column layouts to make good use of available space.

Don't default to the same layout every time. The structure should serve the aesthetic direction — a sidebar + main content split, a full-width single column, a multi-panel master-detail, an asymmetric split, or something else entirely. These are starting points, not an exhaustive list. Invent a layout that fits the app's purpose and tone.

The header/toolbar is part of the design language — not every app needs a traditional fixed header. Consider alternatives: a floating command bar, a compact inline toolbar, a branded banner, a collapsible drawer, a minimal top-right action cluster, or no header at all if the content speaks for itself.

### Container Sizing

`VegaVisual` and other content components fill their container — the **container controls their dimensions**. Without constraints, charts and content stretch to the full viewport width, which produces squished, unreadable visuals on wide screens.

- **Constrain the dashboard wrapper, not individual charts.** Apply a max-width to the outermost content wrapper that holds the dashboard. This single constraint keeps the entire layout proportional on wide monitors. If the app lacks an outer wrapper, create one.
- **Do not constrain individual chart containers.** Let the wrapper width plus grid columns determine each chart's size naturally.
- If the user explicitly requests full-width charts, confirm the design choice before proceeding.

### Dashboard Grid

- Start mobile-first and scale up columns with responsive breakpoints.
- Support mixed-size cards via span utilities.

Avoid uniform grids where every card is the same size — they look like a spreadsheet. Use mixed card spans to create useful visual hierarchy, with widths guided by the analytical task, data importance, data density, and label needs. Equal-size cards are appropriate when they support comparison.

Review the complete row composition at each responsive breakpoint, including partial rows before full-width tables. When substantial space is unused, consider whether a neighboring chart would benefit from additional width within the dashboard wrapper. Dense line and area time series often benefit from more horizontal space to separate observations and time labels; for example, a dense intraday line chart could span the remaining columns beside a compact ranking chart.

Do not widen charts merely to fill space: preserve useful proportions for donuts, maps, and other aspect-sensitive visuals, and retain intentional whitespace where it serves the design. Judge the resulting layout by the readability of its marks and labels, not just how much space it occupies.

### Loading, Empty & Error States

Every component that depends on async data should handle all three states:

| State | What to show |
|---|---|
| **Loading** | A skeleton placeholder matching the shape of the expected content |
| **Empty** | A centered muted message explaining no data is available |
| **Error** | A destructive-styled banner with the error message |

### Dark Mode

Include a light/dark mode toggle in the app header or toolbar. Use the `useAppTheme` hook from `@/hooks/use-theme` to read and toggle the theme.

---

## Coding Conventions

- **Styling**: Tailwind CSS v4 utility classes for all styling. Theme colors are defined as CSS custom properties in `src/global.css` using `@theme`. Use Tailwind classes directly in JSX.
- **Theming**: Light/dark color tokens defined in `src/global.css` via CSS custom properties. Dark mode uses the `.dark` class on the root `html` element, auto-detected via `prefers-color-scheme`, `data-appearance` attribute, or `.dark` class. The `useAppTheme` hook in `src/hooks/use-theme.ts` manages the toggle.
- **CSS class merging**: Use `cn()` from `@/lib/utils` (powered by `clsx` + `tailwind-merge`) to conditionally combine Tailwind class names.
- **Icons**: Lucide React for UI icons.
- **UI Components**: Use Radix primitives with Tailwind CSS styling for all interactive elements — buttons, inputs, dialogs, menus, tabs, etc.

### UI Token Rules

All styling must use the design tokens defined in `src/global.css` via Tailwind utility classes. Never hardcode raw color values, pixel sizes, or font stacks — raw values are only permitted in `global.css` and `src/data-palette-presets.json`. Refer to `global.css` for available tokens, their values, and expected usage.

Examples:
- `bg-primary text-primary-foreground` — not `bg-blue-600 text-white`
- `text-300` — not `text-sm` or `text-[14px]`
- `p-4 gap-3` — not `p-[16px] gap-[12px]`
- `font-semibold` — not `font-[600]`
- `rounded-xl` — not `rounded-[8px]`
- `icon-size-200` — not `w-4 h-4`

**`cn()` and tailwind-merge conflicts:** `tailwind-merge` treats `text-*` utilities as one conflict group. In `cn()`, combining text size and text color with ambiguous `text-*` classes can drop one class. Prefer explicit length syntax for font size (e.g., `text-[length:var(--text-300)]`) when combining with text color classes inside `cn()`. If classes are static and not merged, `text-300 text-foreground` is acceptable.

**Spacing:** Numeric spacing utilities multiply `--spacing` (4px by default). Use `gap-grid` on dashboard card layouts. Numeric width, height, and positioning utilities also scale; use dedicated tokens such as `icon-size-200` for dimensions that must stay fixed.

**Form element font inheritance:** Native form controls may not inherit the page font family by default. Ensure base styles in `global.css` set `font-family: inherit` for `select`, `input`, `textarea`, and `button`.

---

## Final Audit

After assembling a layout, audit each element in its actual context — not in isolation. A component may look correct on its own but break the visual rhythm of the page. Check: Is every text legible? Are labels proportional to their controls? Are toolbar rows aligned on a shared edge? Do charts fill their containers? Do repeated elements (badges in tables, icons in lists) maintain appropriate visual weight for their density? Fix anything that fails.