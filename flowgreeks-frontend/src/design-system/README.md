# FlowGreeks design system

This folder is the visual contract. Every component imports from it; no
component invents its own colors, durations or shadows.

## Layers

- `tokens.ts` — TS-level source of truth for primitive values. R3F
  materials, framer-motion variants, uPlot themes consume this.
- `theme.css` — Tailwind v4 `@theme` block. Same primitives as
  `tokens.ts`, exposed as CSS variables. Kept in lockstep.
- `glass.module.css` — opt-in glass utility classes. Read the comment
  block at the top before sprinkling these.

## Design language

### Dark first, light optional
Traders run dark monitors at 200 nits in dim rooms. The light theme
exists as a courtesy — it is not the canonical surface.

### Tabular numerals everywhere
Trader cognition compares numbers by column position, not magnitude.
Use the `font-numeric` class (or set `font-feature-settings` on the
parent surface) on any column of values. Proportional digits are a
regression and a code-review block.

### Signed-value semantics
Positive values are long-side green (`--color-long-strong`); negative
values are short-side red (`--color-short-strong`). These are CVD-safe
hues — green leans yellow-green, red leans magenta — so protanopic /
deuteranopic users still parse the sign.

These greens and reds are RESERVED for sign. They never indicate
success / error / loading. Status uses the `--color-info / success /
warn / error` track instead.

### Glassmorphism with restraint
Glass surfaces are the brand — but only on chrome. Frosted ≠ illegible.
Never apply `.glass` to a virtualised strike grid, options chain, or
trade tape. The compositor cost is per-row and the readability cost is
catastrophic at small font sizes.

### Motion budget
- State transitions: ≤ 200ms.
- Entrance / exit: ≤ 600ms.
- Always respect `prefers-reduced-motion`.
- 3D camera dolly is the only "hero" motion allowed; everything else
  must feel utilitarian.

### Density modes
The body element carries either `density-compact` or `density-comfortable`
(see `theme.css`). Components must read `var(--row-h)`, `var(--gap-x)`,
`var(--gap-y)` rather than hard-coding heights.

### Iconography
Lucide line icons only. No emoji, no filled glyphs, no custom SVGs in
component files. Add new icons via the lucide-react import.

## When to extend

Adding a token: edit `tokens.ts`, mirror the change in `theme.css`,
update this README if it changes a rule. Adding a one-off color in a
component is a code-review block.

## Inspiration vs. anti-patterns

Reference: Bloomberg Terminal density, TradingView clarity, Linear's
restraint, the iOS spring curve. Anti-patterns: chartjunk, gradient
text on dense numbers, glassmorphism on data tables, emoji icons,
exclamation points in error copy.
