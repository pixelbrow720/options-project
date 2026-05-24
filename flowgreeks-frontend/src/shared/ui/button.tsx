import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Trader-grade button. Three intents — primary action, neutral surface,
 * destructive — and three sizes. No fancy gradients; the chrome is the
 * job.
 *
 * Glass variant `surface` is the default because the dashboard is dark
 * and most affordances live on raised cards. `solid` is reserved for
 * the primary CTA on the login screen and command-palette enter.
 */

export type ButtonIntent = "neutral" | "primary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  intent?: ButtonIntent;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const intentStyles: Record<ButtonIntent, string> = {
  neutral:
    "bg-[var(--color-bg-raised)] text-[var(--color-fg-primary)] border border-[var(--color-border-strong)] hover:bg-[var(--color-bg-base)]",
  primary:
    "bg-[color:var(--color-accent-indigo)]/15 text-[var(--color-accent-indigo)] border border-[color:var(--color-accent-indigo)]/40 hover:bg-[color:var(--color-accent-indigo)]/25",
  danger:
    "bg-[color:var(--color-short-soft)] text-[var(--color-short-strong)] border border-[color:var(--color-short-strong)]/40 hover:bg-[color:var(--color-short-strong)]/25",
  ghost:
    "bg-transparent text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-raised)] border border-transparent",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-7 px-2 text-xs gap-1.5 rounded-md",
  md: "h-8 px-3 text-sm gap-2 rounded-md",
  lg: "h-10 px-4 text-sm gap-2 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { intent = "neutral", size = "md", fullWidth, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-indigo)]",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        intentStyles[intent],
        sizeStyles[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    />
  );
});
