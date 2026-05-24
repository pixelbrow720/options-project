import { Canvas, type CanvasProps } from "@react-three/fiber";
import { AdaptiveDpr, AdaptiveEvents, Preload, Stats } from "@react-three/drei";
import { Suspense, useMemo, type ReactNode } from "react";
import * as THREE from "three";

interface CanvasPresetProps extends Omit<CanvasProps, "children"> {
  children: ReactNode;
  /** Show drei Stats panel. Default: dev only. */
  stats?: boolean;
  /** Background color. Defaults to bg-abyss token. */
  background?: string;
  /** Disable shadows entirely on low-power devices (auto-detect by GPU tier). */
  shadowsAuto?: boolean;
}

/**
 * R3F canvas preset.
 *
 * Defaults are tuned for "dense data, dark UI, brand-first material":
 *   - DPR clamped [1, 2] — high-DPI MacBooks default to 2 but skipping
 *     beyond that wastes 4× shader cost for no perceptual gain.
 *   - ACES tonemap — gives glass + bloom a filmic shoulder so signed
 *     greens/reds stay legible at saturation.
 *   - sRGB output (THREE 0.170+ default outputColorSpace).
 *   - AdaptiveDpr / AdaptiveEvents drop the working DPR while the user
 *     is interacting (drag, dolly) and restore it on idle.
 *   - shadowMap basic preset; high-end machines get PCF soft shadows by
 *     opting into `shadows="soft"` at the call site.
 *   - Suspense fallback is null because the parent feature pane already
 *     paints a skeleton; double-loading state looks broken.
 */
export function CanvasPreset({
  children,
  stats = import.meta.env.DEV,
  background = "var(--color-bg-abyss)",
  shadowsAuto: _shadowsAuto = true,
  ...rest
}: CanvasPresetProps) {
  const gl = useMemo<CanvasProps["gl"]>(
    () => ({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 1.05,
    }),
    [],
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background }}>
      <Canvas
        dpr={[1, 2]}
        gl={gl}
        camera={{ position: [0, 5, 10], fov: 38, near: 0.1, far: 1000 }}
        shadows
        flat={false}
        {...rest}
      >
        <AdaptiveDpr pixelated={false} />
        <AdaptiveEvents />
        <Suspense fallback={null}>{children}</Suspense>
        <Preload all />
        {stats ? <Stats showPanel={0} /> : null}
      </Canvas>
    </div>
  );
}
