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

export const PART_C_ALLOWLIST: readonly PartCAllow[] = [
  // SMS: none beyond verification codes (sent by Supabase phone auth, never through the app). The emergency-contact exception (D3) and clinician SMS paging were removed 2026-10-16 (OQ-332, OQ-333).
  // Fertile window: the six `fertile-window-label` entries were removed by S85 D2 (OQ-12): opt-in "Planning a pregnancy"
  // mode and the shared label are built on web and phone. Do not add one back; fix the screen.
  // Platform Credit was removed from the schema; one refund branch for a retired charge remains
  { rule: "stored-balance", file: "supabase/functions/paystack-webhook/handler.ts", oq: "OQ-309", expires: EXP, reason: "refund-and-reconcile branch for a retired platform_credit_topup charge" },
];
