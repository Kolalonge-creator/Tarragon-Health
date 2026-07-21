import * as React from "react";
import { cn } from "@/lib/utils";

const CARD_VARIANT = {
  default: "bg-white",
  soft: "bg-warm-ivory",
  sage: "bg-soft-sage",
} as const;

export function Card({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: keyof typeof CARD_VARIANT }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-charcoal-ink/10 shadow-sm transition-shadow hover:shadow-md",
        CARD_VARIANT[variant],
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      className={cn("font-heading text-xl font-semibold text-charcoal-ink", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-charcoal-ink/60", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}
