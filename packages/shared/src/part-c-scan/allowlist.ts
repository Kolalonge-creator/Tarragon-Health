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


export const PART_C_ALLOWLIST: readonly PartCAllow[] = [
  // SMS: none beyond verification codes (sent by Supabase phone auth, never through the app). The emergency-contact exception (D3) and clinician SMS paging were removed 2026-10-16 (OQ-332, OQ-333); the last SMS and voice sender code (OQ-727) was deleted 2026-10-27.
  // Fertile window: the six `fertile-window-label` entries were removed by S85 D2 (OQ-12): opt-in "Planning a pregnancy"
  // mode and the shared label are built on web and phone. Do not add one back; fix the screen.
  // Platform Credit: the last allowlist entry (OQ-309, paystack-webhook refund branch) was deleted with its branch 2026-10-27 after live evidence of 0 rows.
  { rule: "paystack-recurring", file: "supabase/functions/paystack-webhook/handler.ts", oq: "OQ-97", expires: "2026-11-26", reason: "dormant subscription.create handler (0 live subscriptions); OQ-97 decided to delete the retired plan paths" },
];
