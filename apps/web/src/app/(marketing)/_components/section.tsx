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
        : "bg-white";

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
  as = "h2",
  size = "default",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  invert?: boolean;
  /** The page's first SectionHeading should be "h1" — every marketing page needs exactly one. */
  as?: "h1" | "h2";
  /**
   * "large" is a deliberately bigger, bolder treatment for the one or two
   * sections per page that should read as a genuine moment rather than
   * another section title — use sparingly, not as the new default.
   */
  size?: "default" | "large";
}) {
  const Heading = as;
  return (
    <div className={cn("mx-auto mb-10 text-center", size === "large" ? "max-w-3xl" : "max-w-2xl")}>
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
      <Heading
        className={cn(
          "font-heading font-semibold",
          size === "large" ? "text-4xl sm:text-5xl lg:text-6xl" : "text-3xl sm:text-4xl",
          invert ? "text-white" : "text-charcoal-ink"
        )}
      >
        {title}
      </Heading>
      {description ? (
        <p className={cn("mt-4 text-lg", invert ? "text-white/70" : "text-charcoal-ink/70")}>
          {description}
        </p>
      ) : null}
    </div>
  );
}
