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
  // SMS beyond verification codes and clinician paging (D3, unsigned: one named exception plus removals)
  { rule: "patient-sms", file: `${web}app/(dashboard)/patient/actions.ts`, oq: "OQ-32", expires: EXP, reason: "emergency-contact SMS; D3 keeps it as the one named exception once live delivery is proven" },
  { rule: "patient-sms", file: `${web}app/(dashboard)/patient/family/claim-dependent-actions.ts`, oq: "OQ-48", expires: EXP, reason: "dependent-claim SMS is not a verification code; D3 removes it" },
  { rule: "patient-sms", file: `${web}lib/notifications/send-patient-link.ts`, oq: "OQ-32", expires: EXP, reason: "virtual review join link by SMS; D3 removes it" },
  { rule: "patient-sms", file: `${web}app/(dashboard)/admin/settings/broadcasts/broadcast-composer.tsx`, oq: "OQ-32", expires: EXP, reason: "SMS broadcast channel; D3 removes it" },
  { rule: "patient-sms", file: `${web}app/(dashboard)/dashboard/corporate/roster-manager.tsx`, oq: "OQ-310", expires: EXP, reason: "employer roster invitation by SMS; not a verification code" },
  // Fertile window: the six `fertile-window-label` entries were removed by S85 D2 (OQ-12): opt-in "Planning a pregnancy"
  // mode and the shared label are built on web and phone. Do not add one back; fix the screen.
  // Platform Credit was removed from the schema; one refund branch for a retired charge remains
  { rule: "stored-balance", file: "supabase/functions/paystack-webhook/handler.ts", oq: "OQ-309", expires: EXP, reason: "refund-and-reconcile branch for a retired platform_credit_topup charge" },
];
