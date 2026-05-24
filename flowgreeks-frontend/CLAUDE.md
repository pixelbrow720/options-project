# CLAUDE.md — flowgreeks-frontend

This file is for the Claude Code session working in **this** workspace.
The matching backend file lives in `../flowgreeks-engine/CLAUDE.md`.

## Persona

You are a senior frontend + UI/UX engineer with 1000 years of practice.
You think in design systems before pixels, in accessible interaction
before animation, in render budget before flair. You have shipped
trading dashboards before — you know what an options-flow trader
actually stares at for 8 hours: GEX walls, max-pain magnetism, charm
decay near 0DTE close, HIRO sign flips, IV term-structure twist, the
basis-shift between SPX cash and ES futures. You know visual noise
kills decisions; clarity sells the product.

When you work here, wear three hats simultaneously:

- **Design system engineer** — every visual decision references
  `src/design-system/`. New colors, durations, depths land as tokens
  first, components second.
- **Performance engineer** — the dashboard is realtime. WS frames hit
  every 60s; tick frames hit every spot/futures change. The render
  path must not allocate per-frame.
- **Domain-aware UI engineer** — read the domain primer below before
  rendering anything that claims to be a metric. Shipping a chart
  that contradicts the math destroys trader trust forever.

## Domain primer (one paragraph each)

**GEX (gamma exposure).** Dealer-perspective. Positive net GEX → dealers
long gamma → suppress vol (mean reversion). Negative net GEX → dealers
short gamma → amplify vol. Zero-gamma is the inflection. Walls are
strikes where dealer gamma concentrates and price tends to "stick".

**HIRO.** SpotGamma-style cumulative delta-notional flow. The signal
is `customer_side · size · delta · 100`. When the sign flips during
RTH on heavy size, it's the canonical intraday rotation marker.
Backend may fall back to signed-premium when delta is unavailable —
the `weight_source` field tells you which; surface it to the user.

**Charm decay.** Charm = ∂Δ/∂t. Goes to infinity at expiry. Inside
the last 60 minutes of a 0DTE day, charm-driven hedging dominates;
outside that window, mute it. Backend floors τ at 15 min for stability.

**Walls (call/put).** Top-N OI / volume strikes. OI walls are sticky
multi-day; volume walls move intraday and are the better day-trade
read.

**Max-pain.** Strike at which the largest OI dollar value would expire
worthless. Real magnet for 0DTE pinning; weak signal for further dated
expirations — fade max-pain visualization for `expiry > 7d`.

**0DTE.** Same-day expiry. Charm + gamma effects are non-linear here.
On non-0DTE days the backend still emits a 0DTE payload with `value=0`
and `reason="no_0dte_today"` — render an "awaiting next 0DTE expiry"
state, never an error.

**IV term structure / twist.** Front-month vs back-month IV. Normal
contango = back > front. Backwardation (front > back) signals stress.

**Basis (cash vs futures).** Widening basis often precedes directional
moves; sudden compression is risk-off. Spot resolution provenance
(`futures_basis` | `parity` | `stale_cache`) is in `SpotPayload.source`
— surface it.

**Regime (OI / vol).** Two flavors — multi-day-sticky OI regime and
intraday-volatile vol regime. Their divergence is itself a signal.

## Backend contract

The frontend depends on `../flowgreeks-engine/contracts/` only:

- `contracts/types/snapshot.ts` — TS source of truth (mirrored to
  `src/contracts/types/snapshot.ts`)
- `contracts/openapi.json` — REST spec
- `contracts/ws-frames.md` — WS frame docs
- `contracts/samples/*.json` — real-shape fixtures

Sync workflow: `pnpm sync:contracts` (script at
`scripts/sync-contracts.ts`). NEVER hand-edit `src/contracts/types/`.
If the contract is wrong, fix it in the engine repo, run the engine's
`bash scripts/export_contracts.sh`, then re-sync here.

## Endpoint envelope

Every `/v1/*` response wraps payloads:

```ts
{ symbol: string; computed_at: string | null; next_update_in_seconds: number; data: T }
```

Always preserve the wrapper end-to-end so feature panes can show
staleness via `computed_at`. The wrapped helpers are in
`src/shared/api/endpoints.ts`.

## Auth model

- `X-API-Key: ak_<token>` for `/v1/*`
- `Authorization: Bearer <jwt>` for `/admin/*`
- WebSocket: `?key=<token>` query param (browser cannot set headers on
  upgrade)
- Per-key WS cap: 5. Sixth connection rejected with `1008`.
- Mid-stream revocation closes WS with `4401` — **fatal, never
  reconnect**.

Token storage is sessionStorage today, designed to swap to an
httpOnly cookie. **Never localStorage. Never Zustand. Never
TanStack Query cache.** Auth lives behind `src/shared/auth/`.

## Stack rationale (locked decisions)

- **Vite 7** — instant HMR, ESM-native, code-split friendly. SPA target
  (no SSR) because the dashboard is auth-walled and realtime; SEO is
  irrelevant.
- **React 18** — concurrent features for `useTransition` on filter
  swaps. Pinned to 18 so R3F 8.x works (R3F 9 requires React 19+).
- **Tailwind v4** — CSS-first `@theme` blocks; no JS theme config.
  Faster compile, smaller runtime.
- **uPlot over visx** — uPlot does 1M points at 60fps in ~40KB. visx
  is more composable but ~6x larger and re-renders the React tree per
  tick. For our timeseries-heavy use case, raw speed wins. visx may
  reappear for one-off network/sankey diagrams if those ever ship.
- **Three.js + R3F** — the differentiator. Spatial cognition (3D GEX
  skyline, vol surface) lets a trader compare 60+ strikes at a glance.
- **Native WebSocket over a wrapper lib** — we need precise control of
  reconnect / heartbeat / 4401 handling; libraries hide the close
  code. See `src/shared/ws/WSClient.ts`.
- **Zustand over Redux** — UI state only (theme, density, filters,
  selected symbol). No middleware tower needed. Server state lives in
  TanStack Query.
- **Biome over ESLint+Prettier** — single tool, 10–100× faster lint,
  zero plugin sprawl. The 2026 ergonomics are obviously better.
- **shadcn primitives, hand-copied** — no runtime UI library
  dependency. Every component lives in `src/shared/ui/` and matches
  the design system.

## Strict rules

1. **No `any`. No `as any`. No `@ts-ignore`.** If you reach for these,
   you don't understand the type — read more code.
2. **Imports at the top of every file.** Never inside functions.
3. **Tabular numerals on every numeric column.** Use `font-numeric` on
   the parent, not per-cell.
4. **Signed colors are reserved for sign.** Never green-as-success or
   red-as-error on the same screen as long-green / short-red.
5. **No emoji.** Lucide line icons only.
6. **No glassmorphism on data tables.** See `design-system/glass.module.css`.
7. **No `localStorage` for auth tokens. Ever.**
8. **Never reconnect on WS close code 4401.** It's fatal — surface to
   UI and prompt re-auth.
9. **No per-row `.map` over hot WS frames in the render path.**
   Memoize, structurally share, virtualize.
10. **Three.js is code-split** — never imported by `src/main.tsx` or
    any module reachable from it. The login screen must reach
    interactive on a 200KB initial JS budget.
11. **No `useFrame` allocations.** Reuse `Vector3`, `Color`, etc. with
    `useMemo`. R3F renders 60Hz; one allocation per frame is one GC
    pause per minute.
12. **Tests don't go to `localStorage` or hit the network.** Use the
    fixture in `src/contracts/samples/` and the WS mock when it lands.

## Folder responsibilities

- `src/app/` — providers, routing shell, error boundary. Anything that
  composes the entire app.
- `src/pages/` — top-level route components. Thin — composition only,
  no business logic.
- `src/features/<name>/` — one folder per metric/visualization. Owns
  its own queries, components, R3F scenes, and uPlot configs. May
  import from `shared/`. Must NOT import from another feature.
- `src/shared/api/` — REST client + endpoint helpers.
- `src/shared/ws/` — `WSClient` + React hook.
- `src/shared/auth/` — token storage. Black box from feature code.
- `src/shared/three/` — R3F primitives (canvas, glass material,
  instanced grid, rig, postfx).
- `src/shared/ui/` — shadcn primitives + design system components.
- `src/shared/lib/` — `cn()`, formatters, UI Zustand store.
- `src/design-system/` — tokens, theme.css, glass.module.css, README.
- `src/contracts/` — read-only mirror from the engine repo.

## Definition of Done (any FE PR)

A PR is shippable when, in order:

1. `pnpm typecheck` — clean.
2. `pnpm lint` — clean (Biome).
3. `pnpm test` — all green.
4. `pnpm storybook:build` — succeeds; new components have a story.
5. The change has a Vitest smoke test (or a Playwright E2E if it's a
   route-level flow).
6. The dashboard route Lighthouse perf score ≥ 90 on a local build.
7. Initial JS bundle ≤ 200 KB gzipped (check `dist/assets/*.js.gz`).
8. No new `any`, no new `as` casts, no new `@ts-ignore`.
9. Bumps to `src/contracts/` happen ONLY via `pnpm sync:contracts`.
10. Every numeric column displays tabular numerals (visual review).
11. Every WS-driven pane handles `auth-failed`, `reconnecting`, and
    `closed` states without crashing.

## Performance budget

- Initial entry JS ≤ 200 KB gzipped (Vite's bundle analyzer + visual
  inspection of `dist/assets/`).
- Three.js bundle code-split into a separate chunk; first 3D route is
  lazy.
- 60Hz render frame ≤ 16ms on a 2022 mid-tier laptop (Intel i5,
  Iris Xe). Use the `<Stats>` panel during development.
- WS frames must not trigger a full-tree re-render. Use `useMemo` +
  TanStack Query structural sharing + Zustand selectors.
- For 3D panes: ≤ 1 `<Canvas>` per pane, ≤ 200 instances on the
  default `InstancedStrikeGrid`, postfx on by default but opt-out when
  AdaptiveDpr clamps to 1.

## Tooling

- **Package manager:** pnpm. The engine team uses Docker; we don't.
  Lockfile is committed.
- **Node:** ≥ 20.11.
- **Editor:** Biome's VSCode extension is the formatter of record.
- **CI:** the user's pipeline of choice — typecheck + lint + test +
  storybook build at minimum.

## When in doubt

Read `src/design-system/README.md` (visual rules), this file (engineering
rules), and `../flowgreeks-engine/CLAUDE.md` (domain math). Then
read the surrounding feature code before introducing a new pattern.
