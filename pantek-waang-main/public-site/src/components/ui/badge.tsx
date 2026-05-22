import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "text-foreground border-border",
        emerald:
          "border-transparent bg-[hsl(var(--emerald)/0.15)] text-[hsl(var(--emerald))]",
        rose:
          "border-transparent bg-[hsl(var(--rose)/0.15)] text-[hsl(var(--rose))]",
        amber:
          "border-transparent bg-[hsl(var(--amber)/0.15)] text-[hsl(var(--amber))]",
        violet:
          "border-transparent bg-[hsl(var(--violet)/0.15)] text-[hsl(var(--violet))]",
        accent:
          "border-transparent bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))]",
        muted:
          "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
