# shared/three

R3F building blocks. **No metric ships here** — these are reusable
primitives that every 3D feature pane composes.

## Components

- `CanvasPreset` — wrap every 3D scene with this. Locks DPR, tonemap,
  shadow defaults, suspense fallback. The only place we touch
  `<Canvas>` directly.
- `GlassMaterial` — brand frosted glass. Default for any "card-as-3D-
  object" surface (zero-gamma plate, regime gauge ring, etc.).
- `InstancedStrikeGrid` — the universal `{strike, value}[]` →
  instanced bar grid. Used by GEX, walls, charm, pin-probability.
- `SpotPivotRig` — OrbitControls with the target locked to spot.
  Includes dolly-on-hover.
- `PostFx` — Bloom + Vignette + ACES composer. Toggle off on low-end
  devices via the parent's perf detector.

## Conventions

- World-space units: 1 unit = 1 meter. Strike axis spans `xExtent`
  (default 30u); height axis is normalised to `yMax` (default 6u).
- Spot pivot: x-axis only. Y and Z are anchored at the chart "floor".
- Color encoding: positive values use `--color-long-strong`, negative
  use `--color-short-strong`. Spot/ATM marker uses `--color-max-pain`
  yellow. These are the only colors a 3D pane owns.
- Materials are `meshStandardMaterial` by default; only special panels
  upgrade to `GlassMaterial` because transmission is expensive.

## Performance budget

A 3D pane must render at 60Hz on a mid-tier 2022 laptop with one
CanvasPreset, one InstancedStrikeGrid (≤ 200 instances), and PostFx
on. If a feature requires more, it must add its own perf gate.

## Don't

- Don't import `three` directly in feature code. Compose primitives.
- Don't add per-frame `useFrame` allocations (new Vector3, new Color).
  Reuse with `useMemo`.
- Don't render real backend data here — these are stories-only.
