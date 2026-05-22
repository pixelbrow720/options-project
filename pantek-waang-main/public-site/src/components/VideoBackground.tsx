import { useEffect, useState } from "react";
import { FadingVideo } from "./FadingVideo";
import type { Theme } from "../hooks/useTheme";

interface VideoBackgroundProps {
  theme: Theme;
  className?: string;
}

const SOURCES: Record<Theme, string> = {
  dark: "/videos/bg-dark.mp4",
  light: "/videos/bg-light.mp4",
};

/**
 * Theme-aware looping video background. When `theme` changes, fades the
 * current video out and unmounts before mounting the new one. Falls back
 * to a CSS animated mesh gradient if the file 404s or the browser blocks
 * playback (e.g. Lighthouse, prefers-reduced-data).
 */
export function VideoBackground({ theme, className }: VideoBackgroundProps) {
  const [activeTheme, setActiveTheme] = useState<Theme>(theme);
  const [errored, setErrored] = useState(false);

  // When the theme changes, give the outgoing video its 600ms fade-out
  // before swapping the source, so we don't get a hard cut.
  useEffect(() => {
    if (theme === activeTheme) return;
    const id = window.setTimeout(() => setActiveTheme(theme), 600);
    return () => window.clearTimeout(id);
  }, [theme, activeTheme]);

  // Reset error state if user toggles theme — maybe one file works.
  useEffect(() => {
    setErrored(false);
  }, [activeTheme]);

  return (
    <div className={`absolute inset-0 overflow-hidden ${className ?? ""}`}>
      {/* Always-on CSS mesh fallback sits underneath the video so even
          slow connections / 404s show something instead of pure black. */}
      <div className="foid-bg-fallback" aria-hidden />

      {!errored ? (
        <FadingVideo
          key={activeTheme}
          src={SOURCES[activeTheme]}
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : null}

      {/* Subtle dark vignette to guarantee text legibility regardless of
          which video frame is showing. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.45) 100%)",
        }}
      />
    </div>
  );
}
