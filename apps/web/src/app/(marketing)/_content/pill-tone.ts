/**
 * Shared brand-toned pill colors for marketing stat callouts (audience-tabs,
 * b2b-page-template). Deliberately NOT the shared clinical-status `Badge`
 * component — its red/amber/green variants are reserved for the dashboard's
 * clinical severity system (see badge.tsx's own header comment and
 * CLAUDE.md's brand-colour-vs-status-colour rule) — this uses brand tokens
 * (sage/gold) plus one hand-picked red that isn't in the Tailwind default
 * palette, kept here once rather than duplicated per file.
 */
export const PILL_TONE = {
  green: "bg-soft-sage text-deep-forest",
  amber: "bg-sprout-gold/15 text-charcoal-ink",
  red: "bg-[#F8E4E1] text-[#B0453B]",
} as const;

export type PillTone = keyof typeof PILL_TONE;
