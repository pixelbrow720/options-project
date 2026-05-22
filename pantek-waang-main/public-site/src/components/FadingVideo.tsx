import { useEffect, useRef, type CSSProperties } from "react";

interface FadingVideoProps {
  src: string;
  className?: string;
  style?: CSSProperties;
  /** Called when the underlying <video> errors out (e.g. missing file). */
  onError?: () => void;
}

const FADE_MS = 600;
const FADE_OUT_LEAD = 0.6;

/**
 * Looping background video with manual rAF-driven opacity fade.
 *
 * The native `loop` attribute is intentionally disabled — we restart playback
 * from `onEnded` so we can fade out cleanly before the seamless restart.
 */
export function FadingVideo({ src, className, style, onError }: FadingVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const fadingOutRef = useRef(false);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  function fadeTo(target: number, duration: number) {
    const video = videoRef.current;
    if (!video) return;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    const start = parseFloat(video.style.opacity || "0");
    const t0 = performance.now();

    const step = (now: number) => {
      const v = videoRef.current;
      if (!v) return;
      const elapsed = now - t0;
      const t = Math.max(0, Math.min(1, elapsed / duration));
      const value = start + (target - start) * t;
      v.style.opacity = String(value);
      if (t < 1) {
        rafIdRef.current = requestAnimationFrame(step);
      } else {
        rafIdRef.current = null;
      }
    };

    rafIdRef.current = requestAnimationFrame(step);
  }

  function handleLoadedData() {
    const video = videoRef.current;
    if (!video) return;
    video.style.opacity = "0";
    fadingOutRef.current = false;
    void video.play().catch(() => {
      /* autoplay denied — value stays at 0, parent fallback shows through */
    });
    fadeTo(1, FADE_MS);
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    if (fadingOutRef.current) return;
    const remaining = video.duration - video.currentTime;
    if (remaining > 0 && remaining <= FADE_OUT_LEAD) {
      fadingOutRef.current = true;
      fadeTo(0, FADE_MS);
    }
  }

  function handleEnded() {
    const video = videoRef.current;
    if (!video) return;
    video.style.opacity = "0";
    setTimeout(() => {
      const v = videoRef.current;
      if (!v) return;
      try {
        v.currentTime = 0;
      } catch {
        /* ignore */
      }
      void v.play().catch(() => {
        /* ignore */
      });
      fadingOutRef.current = false;
      fadeTo(1, FADE_MS);
    }, 100);
  }

  return (
    <video
      ref={videoRef}
      src={src}
      autoPlay
      muted
      playsInline
      preload="metadata"
      loop={false}
      className={className}
      style={{ opacity: 0, ...style }}
      onLoadedData={handleLoadedData}
      onTimeUpdate={handleTimeUpdate}
      onEnded={handleEnded}
      onError={onError}
    />
  );
}
