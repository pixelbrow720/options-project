import { OrbitControls } from "@react-three/drei";
import { useRef, useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

interface SpotPivotRigProps {
  /** Spot price, used as the camera's x-axis pivot. */
  spot?: number | null;
  /** Strike domain mapped to xExtent in world space; passed by the parent grid. */
  strikeRange?: [number, number] | undefined;
  /** Same xExtent the InstancedStrikeGrid uses; default 30 units. */
  xExtent?: number;
  /** Whether dolly-on-hover is enabled. Default true. */
  dollyOnHover?: boolean;
  /** Min / max polar angle. Defaults give a comfortable trader-perspective. */
  polar?: [number, number];
}

/**
 * Camera rig — pivot locked to spot.
 *
 * Why: a trader's mental model anchors at the underlying price. If the
 * camera orbits around the strike-axis center, ATM strikes drift off
 * screen as the user pans, which breaks the affordance ("zoom in on
 * the spot wall"). We offset the OrbitControls target so spot stays
 * centered no matter where it sits in the strike domain.
 *
 * The dolly-on-hover behavior pulls the camera ~10% closer when the
 * pointer is on the canvas. Subtle, but it sells "this UI is alive".
 */
export function SpotPivotRig({
  spot,
  strikeRange,
  xExtent = 30,
  dollyOnHover = true,
  polar = [Math.PI * 0.18, Math.PI * 0.42],
}: SpotPivotRigProps) {
  const controlsRef = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  const { gl, camera } = useThree();
  const baseDistanceRef = useRef<number | null>(null);

  // Recompute pivot whenever spot / domain change.
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    const lo = strikeRange?.[0];
    const hi = strikeRange?.[1];
    let pivotX = 0;
    if (spot != null && lo != null && hi != null && hi > lo) {
      const t = (spot - lo) / (hi - lo);
      pivotX = (t - 0.5) * xExtent;
    }
    c.target.set(pivotX, 1.2, 0);
    c.update();
  }, [spot, strikeRange, xExtent]);

  // Dolly-zoom on hover.
  useEffect(() => {
    if (!dollyOnHover) return;
    const el = gl.domElement;
    const onEnter = () => {
      if (baseDistanceRef.current == null) {
        baseDistanceRef.current = camera.position.length();
      }
      const target = baseDistanceRef.current * 0.92;
      camera.position.setLength(target);
    };
    const onLeave = () => {
      if (baseDistanceRef.current != null) {
        camera.position.setLength(baseDistanceRef.current);
      }
    };
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [dollyOnHover, gl, camera]);

  return (
    <OrbitControls
      ref={controlsRef as React.RefObject<never>}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.5}
      zoomSpeed={0.6}
      minDistance={6}
      maxDistance={30}
      minPolarAngle={polar[0]}
      maxPolarAngle={polar[1]}
    />
  );
}
