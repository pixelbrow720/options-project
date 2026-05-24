import { forwardRef, useMemo } from "react";
import * as THREE from "three";

/**
 * Brand glass material.
 *
 * Implementation: MeshPhysicalMaterial with transmission tuned for
 * frosted-but-readable refraction. We avoid a custom GLSL shader for
 * the day-one case so the material stays shipped-able everywhere R3F
 * works — including iPad Safari where transmission falls back
 * gracefully. A bespoke shader can land later behind a feature flag if
 * we need anisotropic scattering.
 *
 * Tuning notes for designers / future Claude:
 *   - thickness ≥ 0.6 makes the surface read as a solid pane vs. a film.
 *   - transmission = 1 + clearcoat = 0.6 keeps highlights crisp.
 *   - roughness 0.18 — too low looks like a polished marble, too high
 *     blurs the data behind it.
 *   - ior 1.45 ≈ display glass.
 *   - color is a *tint*, not a fill — keep it dim or it kills contrast.
 */

export interface GlassMaterialProps {
  color?: THREE.ColorRepresentation;
  thickness?: number;
  roughness?: number;
  transmission?: number;
  ior?: number;
  attenuationColor?: THREE.ColorRepresentation;
  attenuationDistance?: number;
  envMapIntensity?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
}

export const GlassMaterial = forwardRef<THREE.MeshPhysicalMaterial, GlassMaterialProps>(
  function GlassMaterial(
    {
      color = "#7c8cff",
      thickness = 0.7,
      roughness = 0.18,
      transmission = 1,
      ior = 1.45,
      attenuationColor = "#3fd8c5",
      attenuationDistance = 1.6,
      envMapIntensity = 1.1,
      emissive = "#000000",
      emissiveIntensity = 0,
    },
    ref,
  ) {
    const params = useMemo(
      () => ({
        color: new THREE.Color(color),
        attenuationColor: new THREE.Color(attenuationColor),
        emissive: new THREE.Color(emissive),
      }),
      [color, attenuationColor, emissive],
    );

    return (
      <meshPhysicalMaterial
        ref={ref}
        color={params.color}
        thickness={thickness}
        roughness={roughness}
        transmission={transmission}
        ior={ior}
        attenuationColor={params.attenuationColor}
        attenuationDistance={attenuationDistance}
        envMapIntensity={envMapIntensity}
        clearcoat={0.6}
        clearcoatRoughness={0.2}
        specularIntensity={1}
        emissive={params.emissive}
        emissiveIntensity={emissiveIntensity}
        transparent
        side={THREE.DoubleSide}
      />
    );
  },
);
