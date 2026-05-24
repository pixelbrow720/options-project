# flowgreeks-frontend

FlowGreeks SPA — options-flow trading dashboard. Consumes the
`flowgreeks-engine` REST + WS contract.

## Stack

- Vite 7 + React 18 + TypeScript (strict)
- Tailwind CSS v4 (CSS-first `@theme`) + custom glass design system
- Three.js + @react-three/fiber + @react-three/drei + @react-three/postprocessing
- TanStack Query v5 (REST cache) + native `WebSocket` wrapped with
  reconnect / heartbeat / 4401 handling
- Zustand (UI client state, persisted prefs only)
- Framer Motion (transitions); uPlot (fast 2D timeseries — chosen over
  visx for raw render speed on 1M+ point series; see `CLAUDE.md`)
- Vitest + Testing Library + Playwright
- Storybook 8 (Vite framework)
- Biome 2 (lint + format, single tool)

## Workspace expectations

This repo is a sibling of `flowgreeks-engine`:

```
FLOWGREEKS/
├── flowgreeks-engine/    # backend (FastAPI + processing pipeline)
└── flowgreeks-frontend/  # this repo
```

The only coupling is the engine's `contracts/` folder, mirrored into
`src/contracts/` via `pnpm sync:contracts`. Read `src/contracts/README.md`
for the workflow.

## First run

```
pnpm install
cp .env.example .env.local      # set VITE_API_BASE_URL / VITE_WS_BASE_URL
pnpm sync:contracts             # mirror the engine's TS contract
pnpm dev                        # http://127.0.0.1:5173
```

Other scripts:

| Script                | Purpose                              |
| --------------------- | ------------------------------------ |
| `pnpm build`          | Typecheck + production build         |
| `pnpm preview`        | Serve the production build on :4173  |
| `pnpm typecheck`      | tsc --noEmit                         |
| `pnpm lint`           | Biome check                          |
| `pnpm test`           | Vitest run                           |
| `pnpm test:watch`     | Vitest watch                         |
| `pnpm e2e`            | Playwright (uses preview build)      |
| `pnpm storybook`      | Storybook dev on :6006               |
| `pnpm sync:contracts` | Pull `../flowgreeks-engine/contracts/` into `src/contracts/` |

## Auth model

- `X-API-Key: ak_<token>` for `/v1/*` data routes
- `Authorization: Bearer <jwt>` for `/admin/*` routes
- WebSocket auth uses `?key=<token>` query (browsers cannot set custom
  headers on the upgrade request)
- Session-storage only; never localStorage. The `auth-failed` close
  code (`4401`) is fatal — no auto-reconnect

## Performance budget

- Initial JS ≤ 200KB gzipped (three.js code-split, lazy on first 3D route)
- ≤ 16ms render frame on a 60Hz mid-tier 2022 laptop
- Lighthouse perf ≥ 90 on the dashboard route
- See `CLAUDE.md` for the full Definition of Done

## Layout

See `CLAUDE.md` for the per-folder responsibilities.
