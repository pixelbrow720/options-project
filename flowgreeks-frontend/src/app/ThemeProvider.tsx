import { useEffect } from "react";
import { useUiStore } from "@/shared/lib/uiStore";

/**
 * ThemeProvider — applies dark/light + density classes to the <html>
 * root so CSS variables flip atomically. Reads from the Zustand UI
 * store; default is dark + compact (trader-favored).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useUiStore((s) => s.theme);
  const density = useUiStore((s) => s.density);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("density-compact", density === "compact");
    root.classList.toggle("density-comfortable", density === "comfortable");
  }, [theme, density]);

  return <>{children}</>;
}
