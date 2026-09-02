export type PartnerLogo = {
  name: string;
  /** Path under public/, e.g. `/marketing/logos/partners/acme.svg`. */
  logoSrc: string;
  /** Optional link, e.g. the partner's own site or a case study. */
  href?: string;
};

/**
 * Employer/HMO/lab/press logo strip. Same "dormant until real" discipline as
 * `patient_testimonials` (see testimonials-section.tsx): never invented,
 * never populated from CLAUDE.md's "seed data / demos" market-reference list
 * on assumption alone.
 *
 * Displaying a company's logo as a "trusted by" signal is a factual and
 * trademark claim, not just a design choice — each entry below needs BOTH a
 * confirmed-real, current relationship AND confirmed permission to show that
 * company's mark, not just a name that appears elsewhere in the codebase.
 * Confirmed founder-side per entry:
 *
 * - Synlab (2026-09-01): active formal lab arrangement — patients have
 *   investigations done through Synlab — logo confirmed for use.
 *
 * Note the self-arranged-fulfilment pivot (2026-07) ended *booking/billing*
 * through partner labs generally (patients can use any lab, not just
 * partnered ones) — that's a separate fact from whether a specific named
 * relationship, like this one, is still real. Don't assume any other name
 * from CLAUDE.md's list carries the same confirmation; ask per entry.
 */
export const PARTNER_LOGOS: PartnerLogo[] = [
  {
    name: "Synlab",
    logoSrc: "/marketing/logos/partners/synlab.svg",
  },
];
