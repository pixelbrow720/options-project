import { useEffect, useState } from "react";

// Returns true while the document tab is visible. Backed by the Page
// Visibility API so polling effects can pause work when the user has
// switched tabs (saves bandwidth + backend load).
export function useTabVisible(): boolean {
  const [visible, setVisible] = useState(
    typeof document !== "undefined" ? document.visibilityState === "visible" : true,
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}
