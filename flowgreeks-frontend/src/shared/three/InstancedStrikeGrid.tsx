import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export interface StrikeBar {
  /** Strike price, used for x-axis spatial mapping. */
  strike: number;
  /** Signed value to encode as bar height + color. */
  value: number;
}

interface InstancedStrikeGridProps {
  bars: StrikeBar[];
  /** Domain min/max for the strike axis; defaults to bars min/max. */
  strikeRange?: [number, number];
  /** Bar width in world units. */
  barWidth?: number;
  /** Bar depth in world units. */
  barDepth?: number;
  /** World-space x extent. Bars are spread linearly within this range. */
  xExtent?: number;
  /** Max bar height in world units (after value normalization). */
  yMax?: number;
  /** Color for positive values. CSS color or hex. */
  positiveColor?: THREE.ColorRepresentation;
  /** Color for negative values. */
  negativeColor?: THREE.ColorRepresentation;
  /** Optional spot price; bars within ±epsilon of spot get an outline tint. */
  spot?: number;
}

/**
 * Reusable primitive for every strike-axis 3D viz: GEX skyline, walls
 * relief, charm landscape, pin probability, etc. Each metric reduces
 * to `{strike, value}[]` and feeds one instanced mesh — that gives us
 * one draw call per metric, vs. one-per-strike with naive geometry.
 *
 * The mesh is mutated imperatively (setMatrixAt + setColorAt) so a
 * tick that moves 200 bars does not re-allocate React fibers.
 */
export function InstancedStrikeGrid({
  bars,
  strikeRange,
  barWidth = 0.6,
  barDepth = 0.6,
  xExtent = 30,
  yMax = 6,
  positiveColor = "#27d97a",
  negativeColor = "#ff4d6d",
  spot,
}: InstancedStrikeGridProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tmpObject = useMemo(() => new THREE.Object3D(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  const colors = useMemo(
    () => ({
      pos: new THREE.Color(positiveColor),
      neg: new THREE.Color(negativeColor),
      spot: new THREE.Color("#ffd166"),
    }),
    [positiveColor, negativeColor],
  );

  // Normalise the value-axis. Without normalisation a single outlier
  // strike crushes every other bar to a flat carpet.
  const { absMax, xMin, xMax } = useMemo(() => {
    let max = 0;
    for (const b of bars) {
      const a = Math.abs(b.value);
      if (a > max) max = a;
    }
    if (max === 0) max = 1;
    let lo = strikeRange?.[0] ?? Number.POSITIVE_INFINITY;
    let hi = strikeRange?.[1] ?? Number.NEGATIVE_INFINITY;
    if (!strikeRange) {
      for (const b of bars) {
        if (b.strike < lo) lo = b.strike;
        if (b.strike > hi) hi = b.strike;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
      lo = -1;
      hi = 1;
    }
    return { absMax: max, xMin: lo, xMax: hi };
  }, [bars, strikeRange]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const xRange = xMax - xMin;
    const eps = xRange * 0.01;
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      if (!bar) continue;
      const t = xRange === 0 ? 0.5 : (bar.strike - xMin) / xRange;
      const x = (t - 0.5) * xExtent;
      const h = (bar.value / absMax) * yMax;
      const isNeg = h < 0;
      const absH = Math.max(0.001, Math.abs(h));
      tmpObject.position.set(x, isNeg ? -absH / 2 : absH / 2, 0);
      tmpObject.scale.set(barWidth, absH, barDepth);
      tmpObject.rotation.set(0, 0, 0);
      tmpObject.updateMatrix();
      mesh.setMatrixAt(i, tmpObject.matrix);

      if (spot != null && Math.abs(bar.strike - spot) <= eps) {
        tmpColor.copy(colors.spot);
      } else {
        tmpColor.copy(isNeg ? colors.neg : colors.pos);
      }
      mesh.setColorAt(i, tmpColor);
    }
    mesh.count = bars.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [bars, absMax, xMin, xMax, xExtent, yMax, barWidth, barDepth, spot, colors, tmpColor, tmpObject]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(bars.length, 1)]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        roughness={0.45}
        metalness={0.05}
        emissiveIntensity={0.08}
        toneMapped
      />
    </instancedMesh>
  );
}
