/**
 * The single source of truth, on the TypeScript side, for which
 * condition-page slugs a testimonial (patient or doctor) can be tagged
 * with — i.e. which PRODUCT_PAGES entries
 * (apps/web/src/app/(marketing)/_content/products.ts) actually have a
 * TestimonialsSection/DoctorTestimonialsSection mounted. This used to be
 * hand-copied into four places (both Zod schemas, both <select> option
 * lists) with only a comment tying them together — a code-review flagged
 * that as a drift risk (a new condition page updated in one spot and not
 * the others silently rejects, or silently never renders, a valid quote).
 *
 * NOT the source of truth on the database side: `patient_testimonials`/
 * `doctor_testimonials.condition` are also CHECK-constrained (see the
 * migration that added them), and a plain SQL CHECK can't import this
 * TS constant — those two constraints hardcode the same two values
 * separately. Adding a third condition page means updating BOTH this file
 * AND both CHECK constraints (in a new migration); missing either half
 * fails loudly (a Zod/DB rejection), it just doesn't fail in only one
 * place.
 */
export const TESTIMONIAL_CONDITIONS = [
  { value: "hypertension", label: "Hypertension (blood pressure)" },
  { value: "diabetes", label: "Diabetes" },
] as const;

export type TestimonialCondition = (typeof TESTIMONIAL_CONDITIONS)[number]["value"];
