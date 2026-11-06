import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utils";
import { LEGACY_STATUS_COLOUR, STATUS_CLASSES } from "../status";
import type { ClinicalStatusLevel } from "../tokens";

/**
 * Clinical status chip, on the clinical status tokens (packages/ui/src/
 * tokens.ts) — a system separate from brand colours (brand-green/clinical-
 * navy). The chip always carries words, so status is never colour alone.
 *
 * Variants are the six semantic levels. The older colour names (red, amber,
 * blue, grey, green) stay as aliases for existing callers.
 */
const chip = (level: ClinicalStatusLevel) => `${STATUS_CLASSES[level].tint} ${STATUS_CLASSES[level].text}`;

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        critical: chip("critical"),
        urgent: chip("urgent"),
        attention: chip("attention"),
        normal: chip("normal"),
        info: chip("info"),
        inactive: chip("inactive"),
        red: chip(LEGACY_STATUS_COLOUR.red),
        amber: chip(LEGACY_STATUS_COLOUR.amber),
        blue: chip(LEGACY_STATUS_COLOUR.blue),
        grey: chip(LEGACY_STATUS_COLOUR.grey),
        green: chip(LEGACY_STATUS_COLOUR.green),
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
