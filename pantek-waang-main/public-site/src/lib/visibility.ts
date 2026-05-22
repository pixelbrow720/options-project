import { useEffect, useState } from "react";

/**
 * Tracks whether the document is currently visible (i.e. the tab/window is
 * active). Use to gate periodic work (pollers, animations, video playback)
 * so we don't waste CPU/network/bandwidth when the user is on another tab.
 */
export function useTabVisible(): boolean {
  const [visible, setVisible] = useState(
    typeof document !== "undefined" ? document.visibilityState === "visible" : true,
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}
