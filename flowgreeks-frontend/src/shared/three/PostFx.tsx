import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";

interface PostFxProps {
  /** Bloom intensity. 0 disables. */
  bloom?: number;
  /** Vignette darkness 0–1. */
  vignette?: number;
  /** Disable in low-power mode. */
  enabled?: boolean;
}

/**
 * Post-processing pipeline — Bloom → Vignette → ACES tonemap.
 *
 * The CanvasPreset already does ACES on the renderer; this composer
 * pass replaces it (postprocessing pipelines do their own tonemap at
 * the end). Without that, signed colors clip to white in bright bloom
 * regions and lose semantic meaning.
 *
 * Performance: each pass is one full-screen quad. On a 60Hz mid-tier
 * laptop the whole stack is ~1.5ms. If a low-power device shows up
 * (DPR forced to 1 by AdaptiveDpr), the parent should set
 * `enabled={false}` to drop the composer entirely.
 */
export function PostFx({ bloom = 0.45, vignette = 0.35, enabled = true }: PostFxProps) {
  if (!enabled) return null;
  return (
    <EffectComposer multisampling={0} disableNormalPass>
      <Bloom
        intensity={bloom}
        luminanceThreshold={0.6}
        luminanceSmoothing={0.2}
        mipmapBlur
      />
      <Vignette eskil={false} offset={0.18} darkness={vignette} blendFunction={BlendFunction.NORMAL} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
