import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className="liquid-glass rounded-full w-9 h-9 flex items-center justify-center cursor-pointer"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
      ) : (
        <Moon className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
      )}
    </button>
  );
}
