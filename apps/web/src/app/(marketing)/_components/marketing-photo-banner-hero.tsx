import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Full-bleed "text over a real photo" hero (dohealth.co pattern), the
 * primary hero across the site (homepage + every product page with a
 * sourced photo). Genuinely edge-to-edge — renders flush against the
 * viewport's left/right edges with no rounding or shadow, so callers must
 * render it OUTSIDE `Section` (which caps width at max-w-6xl and adds side
 * padding — wrapping this in one silently turns "full-bleed" back into a
 * boxed card). The text block still aligns to the site's normal max-w-6xl
 * content grid via its own inner container, so headline/body/CTA line up
 * with the section below even though the photo runs wider. Works fine with
 * our 4:5 portrait source photos, but needs a per-photo `imagePosition`
 * (see `imageFocus` on MarketingMediaSlot in _content/media.ts) since the
 * wide crop otherwise clips faces/hands — the default "center" is rarely
 * right. A slot with no photo sourced yet falls back to MarketingHero's
 * text-beside-a-card layout instead (see product-page-template.tsx).
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
        "relative isolate w-full overflow-hidden",
        // A bare aspect-ratio (fine when this was capped at max-w-6xl) would
        // make the banner absurdly tall on a wide monitor now that it spans
        // the full viewport — a fixed height keeps it proportioned instead.
        // Below `sm` it stays flow-height, driven by the text block's
        // min-h-[420px], since a long headline (diabetes, obesity) can need
        // more room than a fixed height leaves.
        "sm:h-[460px] lg:h-[560px]",
        className
      )}
    >
      <Image
        src={imageSrc}
        alt={imageAlt}
        fill
        priority
        sizes="100vw"
        style={{ objectPosition: imagePosition }}
        className="object-cover"
      />
      <div
        className="absolute inset-0 bg-gradient-to-t from-charcoal-ink/85 via-charcoal-ink/30 to-transparent sm:bg-gradient-to-r sm:from-charcoal-ink/80 sm:via-charcoal-ink/35 sm:to-transparent"
        aria-hidden
      />
      <div className="relative flex min-h-[420px] flex-col justify-end px-4 py-10 sm:absolute sm:inset-0 sm:h-full sm:min-h-0 sm:justify-center sm:px-0 sm:py-0">
        <div className="mx-auto w-full max-w-6xl sm:px-6 lg:px-8">
          <div className="sm:max-w-md lg:max-w-lg">
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
      </div>
    </div>
  );
}
