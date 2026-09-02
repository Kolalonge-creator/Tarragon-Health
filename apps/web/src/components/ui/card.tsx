import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

const CARD_VARIANT = {
  default: "bg-white",
  soft: "bg-warm-ivory",
  sage: "bg-soft-sage",
  /** For use on a dark (navy) section background — see Section variant="navy". */
  dark: "border-white/15 bg-white/5",
} as const;

export function Card({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { variant?: keyof typeof CARD_VARIANT; asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
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
