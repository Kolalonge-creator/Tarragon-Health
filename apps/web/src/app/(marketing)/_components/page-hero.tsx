import Image from "next/image";
import Link from "next/link";

/**
 * Text-led page hero for the redesigned pages (website upgrade, 2026-11-05).
 * No photograph: the image-generator photos are being replaced (founder
 * decision W-02), and a clear headline loads faster than a full-bleed image
 * on a Nigerian mobile connection. One h1 per page, which this renders.
 */
export function PageHero({
  eyebrow,
  title,
  description,
  primary,
  secondary,
  children,
  image,
}: {
  eyebrow: string;
  title: string;
  description: string;
  primary?: { href: string; label: string };
  secondary?: { href: string; label: string };
  /** Optional extra content under the actions, e.g. a short trust line. */
  children?: React.ReactNode;
  /** Optional photograph beside the text (the existing Tarragon photo library). Never a real patient, doctor or facility. */
  image?: { src: string; alt: string; width: number; height: number };
}) {
  const focus =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 focus-visible:ring-offset-mk-canvas";
  return (
    <section className="px-4 pb-12 pt-12 sm:px-6 sm:pb-16 sm:pt-20">
      <div className={`mx-auto grid max-w-6xl items-center gap-10 ${image ? "lg:grid-cols-[1.1fr_0.9fr] lg:gap-14" : ""}`}>
      <div className="grid min-w-0 gap-5">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">{eyebrow}</p>
        <h1 className="max-w-4xl text-balance font-heading text-[2.3rem] font-bold leading-[1.1] text-charcoal-ink sm:text-5xl">
          {title}
        </h1>
        <p className="max-w-[62ch] text-lg leading-relaxed text-charcoal-ink/80">{description}</p>
        {primary || secondary ? (
          <div className="mt-1 flex flex-col gap-3 sm:flex-row">
            {primary ? (
              <Link
                href={primary.href}
                className={`inline-flex h-12 items-center justify-center rounded-full bg-brand-green px-6 text-base font-semibold text-white hover:bg-brand-green/90 ${focus}`}
              >
                {primary.label}
              </Link>
            ) : null}
            {secondary ? (
              <Link
                href={secondary.href}
                className={`inline-flex h-12 items-center justify-center rounded-full border-[1.5px] border-brand-green px-6 text-base font-semibold text-brand-green hover:bg-brand-green/5 ${focus}`}
              >
                {secondary.label}
              </Link>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
      {image ? (
        <Image
          src={image.src}
          alt={image.alt}
          width={image.width}
          height={image.height}
          priority
          sizes="(min-width: 1024px) 480px, 100vw"
          className="aspect-[4/3] w-full rounded-[28px] object-cover lg:aspect-[4/5]"
        />
      ) : null}
      </div>
    </section>
  );
}

/** Section eyebrow + h2, left-aligned, matching the homepage sections. */
export function BlockHeading({
  id,
  eyebrow,
  title,
  description,
  invert = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  invert?: boolean;
}) {
  return (
    <div className="mb-10 grid max-w-3xl gap-3">
      <p className={`text-sm font-semibold uppercase tracking-wider ${invert ? "text-sprout-gold" : "text-brand-green"}`}>{eyebrow}</p>
      <h2 id={id} className={`text-balance font-heading text-3xl font-semibold leading-tight sm:text-4xl ${invert ? "text-white" : "text-charcoal-ink"}`}>
        {title}
      </h2>
      {description ? <p className={`text-lg ${invert ? "text-white/85" : "text-charcoal-ink/80"}`}>{description}</p> : null}
    </div>
  );
}
