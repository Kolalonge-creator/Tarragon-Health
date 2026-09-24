/**
 * The single source of truth for which condition-page slugs a testimonial
 * (patient or doctor) can be tagged with — i.e. which PRODUCT_PAGES entries
 * (apps/web/src/app/(marketing)/_content/products.ts) actually have a
 * TestimonialsSection/DoctorTestimonialsSection mounted. This used to be
 * hand-copied into four places (both Zod schemas, both <select> option
 * lists) with only a comment tying them together — a code-review flagged
 * that as a drift risk (a new condition page updated in one spot and not
 * the others silently rejects, or silently never renders, a valid quote).
 *
 * Also backs the `patient_testimonials`/`doctor_testimonials.condition`
 * CHECK constraints (see the migration that added them) — keep this list
 * and those constraints in sync when a new condition page gets a
 * TestimonialsSection wired in.
 */
export const TESTIMONIAL_CONDITIONS = [
  { value: "hypertension", label: "Hypertension (blood pressure)" },
  { value: "diabetes", label: "Diabetes" },
] as const;

export type TestimonialCondition = (typeof TESTIMONIAL_CONDITIONS)[number]["value"];
