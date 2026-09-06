import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

const CARD_VARIANT = {
  default: "bg-white dark:bg-night-card",
  soft: "bg-warm-ivory dark:bg-night-ink/10",
  sage: "bg-soft-sage dark:bg-brand-green/20",
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
        "rounded-xl border border-charcoal-ink/10 shadow-sm transition-shadow hover:shadow-md dark:border-night-ink/15 dark:shadow-none dark:hover:shadow-none",
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

/**
 * `as` exists only to fix heading order, never to change size: a card sitting
 * directly under a page's h1 with no section heading between them produced an
 * h1 -> h3 skip on nine patient pages. Passing `as="h2"` there closes the skip
 * without inventing a visible section band the design does not want. The
 * styling is identical whichever tag is chosen, so nothing moves on screen.
 */
export function CardTitle({
  as: Tag = "h3",
  className,
  ...props
}: React.ComponentProps<"h3"> & { as?: "h2" | "h3" | "h4" }) {
  return (
    <Tag
      className={cn(
        "font-heading text-xl font-semibold text-charcoal-ink dark:text-night-ink",
        className
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p className={cn("text-sm text-charcoal-ink/60 dark:text-night-ink/60", className)} {...props} />
  );
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}
