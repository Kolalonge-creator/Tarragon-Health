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
 *
 * Optional `videoSrc` layers a muted, looping, silent ambient clip over the
 * still `imageSrc` (which always renders underneath as the immediate paint
 * and the fallback -- no flash of empty background while the video loads,
 * and the only thing shown at all if the browser can't play the file). Per
 * docs/MARKETING_SITE_SPEC.md's "respect prefers-reduced-motion" rule the
 * video is hidden via `motion-reduce:hidden` rather than just not autoplaying
 * it, so a reduced-motion visitor sees the exact same static hero photo as
 * before this prop existed. Same brand rule as the ambient clips on
 * MarketingMediaFrame: decorative motion only (an animated version of an
 * already-approved photo), never a claimed patient/doctor testimonial.
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
  videoSrc,
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
  videoSrc?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative isolate w-full overflow-hidden",
        // Flow height with a minimum, never a fixed height. The banner used
        // to be pinned at 460/560px, and a long headline plus a long intro
        // (prevention, parentcare, about) overflowed it: the eyebrow slid
        // under the sticky nav and the buttons were cut off at the bottom.
        // The minimum keeps a short hero proportioned on a wide monitor; a
        // long one simply grows.
        className
      )}
    >
      <Image
        src={imageSrc}
        alt={imageAlt}
        fill
        priority
        // On a phone the photo sits under a 70-85% dark overlay behind the text, so a 640px-wide file looks the same
        // as the 1080px one a 100vw hint would pick, at about half the bytes; on a slow connection that is the
        // difference between the hero arriving inside or outside the 2.5s LCP target (launch check 2026-11-06).
        // 240px x a typical 2.6 device-pixel ratio selects the 640w candidate.
        sizes="(max-width: 639px) 240px, 100vw"
        style={{ objectPosition: imagePosition }}
        className="object-cover"
      />
      {videoSrc ? (
        <video
          src={videoSrc}
          poster={imageSrc}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden
          style={{ objectPosition: imagePosition }}
          className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden"
        />
      ) : null}
      <div
        className="absolute inset-0 bg-gradient-to-t from-charcoal-ink/85 via-charcoal-ink/75 to-charcoal-ink/70 sm:bg-gradient-to-r sm:from-charcoal-ink/80 sm:via-charcoal-ink/35 sm:to-transparent"
        aria-hidden
      />
      <div className="relative flex min-h-[420px] flex-col justify-end px-4 py-10 sm:min-h-[460px] sm:justify-center sm:px-0 sm:py-14 lg:min-h-[560px] lg:py-16">
        <div className="mx-auto w-full max-w-6xl sm:px-6 lg:px-8">
          <div className="sm:max-w-md lg:max-w-lg">
            {eyebrow ? (
              // A short label reads as an eyebrow (small caps). A campaign
              // line is a whole sentence, and a sentence set in capitals
              // across two lines reads as shouting, so it keeps its case.
              <p
                className={cn(
                  "font-medium text-white/80",
                  eyebrow.length > 40 ? "text-sm sm:text-base" : "text-sm uppercase tracking-wide"
                )}
              >
                {eyebrow}
              </p>
            ) : null}
            <h1 className="mt-3 text-balance font-heading text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
              {title}
            </h1>
            <p className="mt-4 max-w-md text-base leading-relaxed text-white/85 sm:text-lg">
              {description}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              {/* Sprout Gold, not the default green: Tarragon Green is the site's
                  brand colour, and a green button on a dark photo gradient is the
                  weakest contrast on the page. One accent per view. */}
              <Button asChild size="lg" variant="accent">
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
