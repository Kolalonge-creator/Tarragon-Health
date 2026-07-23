import { cn } from "@/lib/utils";

export function Section({
  id,
  className,
  children,
  variant = "default",
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
  variant?: "default" | "sage" | "navy";
}) {
  const bg =
    variant === "sage"
      ? "bg-soft-sage"
      : variant === "navy"
        ? "bg-clinical-navy text-white"
        : "bg-warm-ivory";

  return (
    <section id={id} className={cn("px-4 py-16 sm:px-6 sm:py-20", bg, className)}>
      <div className="marketing-reveal mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  invert = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  invert?: boolean;
}) {
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center">
      {eyebrow ? (
        <p
          className={cn(
            "mb-2 text-sm font-medium uppercase tracking-wide",
            invert ? "text-white/60" : "text-deep-forest"
          )}
        >
          {eyebrow}
        </p>
      ) : null}
      <h2
        className={cn(
          "font-heading text-3xl font-semibold sm:text-4xl",
          invert ? "text-white" : "text-charcoal-ink"
        )}
      >
        {title}
      </h2>
      {description ? (
        <p className={cn("mt-4 text-lg", invert ? "text-white/70" : "text-charcoal-ink/70")}>
          {description}
        </p>
      ) : null}
    </div>
  );
}
