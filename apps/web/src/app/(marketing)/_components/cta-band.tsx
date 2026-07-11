import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CtaBand({
  title,
  description,
  primaryHref = "/signup",
  primaryLabel = "Start monitoring",
  secondaryHref,
  secondaryLabel,
  className,
  variant = "default",
}: {
  title: string;
  description?: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  className?: string;
  variant?: "default" | "gradient";
}) {
  const isGradient = variant === "gradient";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl px-6 py-12 text-center sm:px-10",
        isGradient
          ? "bg-linear-to-br from-deep-forest to-brand-green text-white shadow-xl shadow-brand-green/20"
          : "border border-charcoal-ink/10 bg-white shadow-sm",
        className
      )}
    >
      {isGradient ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-12 h-56 w-56 rounded-full bg-white/10"
        />
      ) : null}
      <h2
        className={cn(
          "relative font-heading text-2xl font-semibold sm:text-3xl",
          isGradient ? "text-white" : "text-charcoal-ink"
        )}
      >
        {title}
      </h2>
      {description ? (
        <p className={cn("relative mx-auto mt-3 max-w-xl", isGradient ? "text-white/80" : "text-charcoal-ink/70")}>
          {description}
        </p>
      ) : null}
      <div className="relative mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button
          asChild
          size="lg"
          className={isGradient ? "bg-sprout-gold text-clinical-navy hover:bg-sprout-gold/90" : undefined}
        >
          <Link href={primaryHref}>{primaryLabel}</Link>
        </Button>
        {secondaryHref && secondaryLabel ? (
          <Button
            asChild
            variant="outline"
            size="lg"
            className={isGradient ? "border-white/40 text-white hover:bg-white/10" : undefined}
          >
            <Link href={secondaryHref}>{secondaryLabel}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
