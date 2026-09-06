import Image from "next/image";
import { Section } from "./section";
import { PARTNER_LOGOS } from "../_content/partners";

/**
 * Renders nothing until PARTNER_LOGOS has real, permitted entries — same
 * "dormant until real" pattern as TestimonialsSection, including owning its
 * own Section wrapper so an empty state leaves no blank padded gap on the
 * page. See partners.ts for why this can't be pre-filled from CLAUDE.md's
 * market-reference list.
 */
export function PartnerLogoStrip() {
  if (PARTNER_LOGOS.length === 0) return null;

  return (
    <Section className="py-10 sm:py-12">
      <p className="text-center text-sm font-medium uppercase tracking-wide text-charcoal-ink/65">
        Who we work with
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
        {PARTNER_LOGOS.map((partner) =>
          partner.href ? (
            <a
              key={partner.name}
              href={partner.href}
              target="_blank"
              rel="noreferrer"
              className="opacity-60 grayscale transition hover:opacity-100 hover:grayscale-0 focus-visible:opacity-100 focus-visible:grayscale-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-sm"
            >
              <Image src={partner.logoSrc} alt={partner.name} width={140} height={48} className="h-8 w-auto" />
            </a>
          ) : (
            <Image
              key={partner.name}
              src={partner.logoSrc}
              alt={partner.name}
              width={140}
              height={48}
              className="h-8 w-auto opacity-60 grayscale"
            />
          )
        )}
      </div>
    </Section>
  );
}
