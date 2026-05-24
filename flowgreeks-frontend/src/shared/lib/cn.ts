import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind-aware class composer. Use this for every conditional class
 * combo so duplicate or conflicting utilities collapse correctly:
 *
 *   cn("px-2 py-1", isActive && "bg-long-soft text-long")
 *
 * Doing the same with a manual template literal will leave conflicting
 * utilities both in the output and let the wrong one win.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
