import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Dashboard status colors — a system separate from brand colors
 * (brand-green/clinical-navy). Used for clinical severity/status only.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        red: "bg-red-100 text-red-700 dark:bg-red-500/25 dark:text-red-300",
        amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/25 dark:text-amber-300",
        blue: "bg-blue-100 text-blue-700 dark:bg-blue-500/25 dark:text-blue-300",
        grey: "bg-charcoal-ink/10 text-charcoal-ink/70 dark:bg-night-ink/10 dark:text-night-ink/70",
        green: "bg-green-100 text-green-700 dark:bg-green-500/25 dark:text-green-300",
      },
    },
    defaultVariants: {
      variant: "grey",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
