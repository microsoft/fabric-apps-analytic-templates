---
applyTo: "src/**/*.{tsx,jsx,ts,css}"
---
# Design Tokens

All styling must use the design tokens defined in `src/global.css` via Tailwind utility classes. Never hardcode raw color values, pixel sizes, or font stacks — raw values are only permitted in `global.css` where the tokens are defined. Refer to `global.css` for available tokens, their values, and expected usage.

Examples:
- `bg-primary text-primary-foreground` — not `bg-blue-600 text-white`
- `text-300` — not `text-sm` or `text-[14px]`
- `p-l gap-m` — not `p-4`, `gap-3`, `p-spacing-l`, or `gap-spacing-m`
- `font-semibold` — not `font-[600]`
- `rounded-xl` — not `rounded-[8px]`
- `icon-size-200` — not `w-4 h-4`

## `cn()` and tailwind-merge conflicts

`tailwind-merge` treats `text-*` utilities as one conflict group. In `cn()`, combining text size and text color with ambiguous `text-*` classes can drop one class.

- In `cn()`, prefer explicit length syntax for font size (for example, `text-[length:var(--text-300)]`) when combined with text color classes.
- If classes are static and not merged, `text-300 text-foreground` is acceptable.
- If font size appears to revert to browser default, inspect merged output first before changing tokens.

## Form element font inheritance

Native form controls may not inherit the page font family by default. Ensure base styles in `global.css` set `font-family: inherit` for `select`, `input`, `textarea`, and `button`.