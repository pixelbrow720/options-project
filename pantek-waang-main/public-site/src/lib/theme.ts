/**
 * @deprecated This module previously hosted a separate theme store using
 * key `pw_public_theme` and managed the Tailwind `.dark` class. It conflicted
 * with `@/hooks/useTheme` (data-theme attribute, key `foid-theme`) and caused
 * the two stores to drift out of sync.
 *
 * The single source of truth is now `@/hooks/useTheme`, which writes both
 * `data-theme` (FOID CSS tokens) and `.dark` (Tailwind variant) to <html>.
 * Re-exports are kept here so any straggling import paths continue to compile.
 */

export { useTheme } from "@/hooks/useTheme";
export type { Theme } from "@/hooks/useTheme";

/** Backwards-compatible alias. Prefer importing `Theme` from `@/hooks/useTheme`. */
export type ThemeMode = "light" | "dark";
