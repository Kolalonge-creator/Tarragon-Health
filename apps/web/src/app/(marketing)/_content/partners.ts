export type PartnerLogo = {
  name: string;
  /** Path under public/, e.g. `/marketing/logos/partners/acme.svg`. */
  logoSrc: string;
  /** Optional link, e.g. the partner's own site or a case study. */
  href?: string;
  /** One or two sentences on what the relationship actually is. Optional so
   * a logo can be listed with nothing but a name until this is written; never
   * invent one to fill the field. */
  summary?: string;
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
    summary:
      "Our contracted diagnostics partner. Patients can have investigations carried out through Synlab under a real partner-billing agreement, alongside the option every patient always has to use any laboratory they choose.",
  },
];

/**
 * How we decide who appears above. Written for the /partners page, but kept
 * here next to the data it describes rather than duplicated in the page file.
 * This is the guardrail comment above turned into patient-facing copy — never
 * soften it into a vaguer "trusted network" claim.
 */
export const PARTNER_VERIFICATION_PRINCIPLE =
  "We only put a company's name here once the relationship is real, signed and current, and that company has agreed to let us use its name. A short list is not a small network; it's us declining to claim a relationship before it exists.";
