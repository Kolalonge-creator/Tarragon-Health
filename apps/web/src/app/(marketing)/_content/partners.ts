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
    summary: "Our laboratory partner. Take your request form to any Synlab branch, or to another eligible laboratory in our directory. You pay the laboratory directly.",
  },
];

/**
 * The one sentence used wherever the public site names Synlab (founder
 * decision W-06, 2026-11-05). Names the partnership to build on the trust
 * people already have in Synlab, while making clear it is one choice among
 * eligible laboratories. Never "contracted", "approved" or "accredited":
 * partner status is not a quality accreditation. Placement is limited to the
 * homepage's diagnostic section, the /labs partner panel and one Membership
 * FAQ answer (plan section 4.4); not the hero, nav, footer or trust strip.
 */
export const SYNLAB_PARTNER_LINE =
  "Take your request form to any Synlab branch, or to another eligible laboratory in our directory.";

/**
 * How we decide who appears above. Written for the /partners page, but kept
 * here next to the data it describes rather than duplicated in the page file.
 * This is the guardrail comment above turned into patient-facing copy — never
 * soften it into a vaguer "trusted network" claim.
 */
export const PARTNER_VERIFICATION_PRINCIPLE =
  "We list a company's name here only once the relationship is signed and current, and the company has agreed to let us use its name. A short list means we do not claim a relationship before it exists.";
