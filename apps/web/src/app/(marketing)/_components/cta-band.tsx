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
}: {
  title: string;
  description?: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-charcoal-ink/10 bg-white px-6 py-10 text-center shadow-sm sm:px-10",
        className
      )}
    >
      <h2 className="font-heading text-2xl font-semibold text-charcoal-ink sm:text-3xl">{title}</h2>
      {description ? (
        <p className="mx-auto mt-3 max-w-xl text-charcoal-ink/70">{description}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg">
          <Link href={primaryHref}>{primaryLabel}</Link>
        </Button>
        {secondaryHref && secondaryLabel ? (
          <Button asChild variant="outline" size="lg">
            <Link href={secondaryHref}>{secondaryLabel}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
