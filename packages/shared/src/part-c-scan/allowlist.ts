/**
 * Known Part C conflicts. Every entry needs an open-question id and an expiry. The test fails when an
 * entry has expired or no longer matches anything, so this list can only shrink. Do not add an entry
 * to make a new violation pass: decide it in `docs/OPEN-QUESTIONS.md` first.
 *
 * Expiry is 30 days from the S87 scan (2026-10-07), per the founder's 2026-10-07 selection.
 */
export interface PartCAllow {
  readonly rule: string;
  readonly file: string;
  readonly oq: string;
  readonly expires: string; // YYYY-MM-DD
  readonly reason: string;
}

const EXP = "2026-11-06";
const web = "apps/web/src/";

export const PART_C_ALLOWLIST: readonly PartCAllow[] = [
  // SMS beyond verification codes and clinician paging: only the one named exception (D3) remains
  { rule: "patient-sms", file: `${web}app/(dashboard)/patient/actions.ts`, oq: "OQ-32", expires: EXP, reason: "the one named SMS exception (S85-D3): content-free alert to the consented emergency contact, behind go-live guard sms_emergency_contact_enabled; the other four patient-sms paths were removed" },
  // Fertile window shown without the 'Not contraception' label (D2, OQ-12 decided, not built)
  { rule: "fertile-window-label", file: `${web}app/(dashboard)/patient/cycle/cycle-calendar.tsx`, oq: "OQ-12", expires: EXP, reason: "label and opt-in mode not built yet" },
  { rule: "fertile-window-label", file: `${web}app/(dashboard)/patient/cycle/cycle-ring.tsx`, oq: "OQ-12", expires: EXP, reason: "label and opt-in mode not built yet" },
  { rule: "fertile-window-label", file: `${web}app/(dashboard)/patient/cycle/cycle-tracker.tsx`, oq: "OQ-12", expires: EXP, reason: "label and opt-in mode not built yet" },
  { rule: "fertile-window-label", file: `${web}lib/rules/cycle-reading.ts`, oq: "OQ-12", expires: EXP, reason: "patient-facing reason text names the fertile window" },
  { rule: "fertile-window-label", file: `${web}lib/rules/cycle-thermal-shift.ts`, oq: "OQ-12", expires: EXP, reason: "temperature-based ovulation confirmation; review with D2" },
  { rule: "fertile-window-label", file: "apps/mobile/src/screens/sections/cycle-screen.tsx", oq: "OQ-12", expires: EXP, reason: "label and opt-in mode not built yet on the phone" },
  // Platform Credit was removed from the schema; one refund branch for a retired charge remains
  { rule: "stored-balance", file: "supabase/functions/paystack-webhook/handler.ts", oq: "OQ-309", expires: EXP, reason: "refund-and-reconcile branch for a retired platform_credit_topup charge" },
];
