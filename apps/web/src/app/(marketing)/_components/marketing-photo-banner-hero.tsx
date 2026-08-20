import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Full-bleed "text over a real photo" hero (dohealth.co pattern), the
 * primary hero across the site (homepage + every product page with a
 * sourced photo). Works fine with our 4:5 portrait source photos, but needs
 * a per-photo `imagePosition` (see `imageFocus` on MarketingMediaSlot in
 * _content/media.ts) since the wide crop otherwise clips faces/hands — the
 * default "center" is rarely right. A slot with no photo sourced yet falls
 * back to MarketingHero's text-beside-a-card layout instead (see
 * product-page-template.tsx).
 */
export function PhotoBannerHero({
  eyebrow,
  title,
  description,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  imageSrc,
  imageAlt,
  imagePosition = "center",
  className,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  imageSrc: string;
  imageAlt: string;
  imagePosition?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-3xl shadow-xl shadow-charcoal-ink/15",
        // No fixed aspect ratio below `sm`: a long headline (e.g. diabetes,
        // obesity) can need more height than a 4:5 crop leaves room for, and
        // a fixed aspect clips it against `overflow-hidden`. Height instead
        // follows the (in-flow) text block below; sm+ has enough width for
        // headlines to wrap short, so a fixed aspect is safe there.
        "sm:aspect-[16/10] lg:aspect-[16/9]",
        className
      )}
    >
      <Image
        src={imageSrc}
        alt={imageAlt}
        fill
        priority
        sizes="(min-width: 1024px) 1152px, 100vw"
        style={{ objectPosition: imagePosition }}
        className="object-cover"
      />
      <div
        className="absolute inset-0 bg-gradient-to-t from-charcoal-ink/85 via-charcoal-ink/30 to-transparent sm:bg-gradient-to-r sm:from-charcoal-ink/80 sm:via-charcoal-ink/35 sm:to-transparent"
        aria-hidden
      />
      <div className="relative flex min-h-[420px] flex-col justify-end p-6 sm:absolute sm:inset-0 sm:h-full sm:min-h-0 sm:w-3/5 sm:justify-center sm:p-12 lg:p-16">
        {eyebrow ? (
          <p className="text-sm font-medium uppercase tracking-wide text-white/80">{eyebrow}</p>
        ) : null}
        <h1 className="mt-3 font-heading text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
          {title}
        </h1>
        <p className="mt-4 max-w-lg text-base leading-relaxed text-white/85 sm:text-lg">
          {description}
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={primaryHref}>{primaryLabel}</Link>
          </Button>
          {secondaryHref && secondaryLabel ? (
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/40 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20 hover:text-white"
            >
              <Link href={secondaryHref}>{secondaryLabel}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
