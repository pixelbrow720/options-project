import { cn } from "@/lib/utils";

interface Props {
  tone: "positive" | "negative" | "flip" | "neutral" | "brand";
  pulse?: boolean;
  size?: "sm" | "md";
  className?: string;
}

const toneClass = {
  positive: "bg-positive",
  negative: "bg-negative",
  flip: "bg-flip",
  neutral: "bg-fg-muted",
  brand: "bg-brand-primary",
};

export function StatusDot({ tone, pulse = false, size = "md", className }: Props) {
  return (
    <span
      className={cn(
        "inline-block rounded-full",
        size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2",
        toneClass[tone],
        pulse && "animate-pulse-soft",
        className,
      )}
    />
  );
}
