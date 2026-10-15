import { BP_CARE_V5 } from "./bp-care-v5";
import type { Rule, RuleSet } from "../types";

/**
 * Blood pressure triage rule set, version 6: a DRAFT. NOT signed, NOT approved, never applied to production by the build.
 *
 * Founder decision D1 (2026-10-07, build S85-D1; the Chief Medical Officer has NOT signed it): a reading of 180/120 or more (either number)
 * asks the emergency-symptom question, where versions 2 to 5 asked it from 200/130. A symptom ticked (including "severe or new headache") is
 * RED (BP-R1, unchanged: its line has been `params.severe` = 180/120 since version 1); no symptom is AMBER with a recheck after 2 hours (BP-X2)
 * and the amber same-day task from BP-A1 if it is still high at the recheck or never done. Pregnancy and postpartum lines are unchanged.
 *
 * Built from version 5 (the newest, version 4 plus the pregnancy changes of S67) so the two cannot drift: the only differences are the version, `params.extreme` (200/130 to 180/120), the open-decision
 * note carried in `params.proposedForCmo`, and the display text of the two rules that still said 200/130. The rules themselves are untouched,
 * because every rule already reads the line through `params.extreme`; a test pins exactly that, and the server seed
 * (`supabase/migrations/20261015150837_s85d1_bp_care_triage_v6_draft_180_120.sql`) derives the same object from the stored version 5 row.
 */
const DESCRIPTION_V6: Readonly<Record<string, string>> = {
  "BP-X1": "180/120 or more (either number) and the symptom question not yet answered: ask it first (founder decision D1)",
  "BP-X2": "180/120 or more (either number), no emergency symptom: take usual medicine if not taken, rest, recheck after 2 hours (founder decision D1)",
};

export const BP_CARE_V6: RuleSet = {
  ...BP_CARE_V5,
  version: 6,
  params: {
    ...BP_CARE_V5.params,
    extreme: { systolic: 180, diastolic: 120 },
    proposedForCmo: {
      status: "Open decisions recorded when this version was drafted (2026-10-07): the founder decided the 180/120 line; the three items below were left to the CMO. The values in this version are the ones in force.",
      severeHeadacheIsOneSymptom: "one symptom today (severe_headache); the CMO decides whether 'severe or new headache' is one symptom or two",
      urgentLineIs180Over110: "params.urgent stays 180/110 (the 5 minute recheck band below 180 systolic); the CMO decides whether 180/110 should be the trigger line instead",
      recheckWindow: "params.extremeRecheck stays 120 minutes (window 240); the CMO decides the recheck window",
    },
  },
  rules: BP_CARE_V5.rules.map((r): Rule => (DESCRIPTION_V6[r.id] ? { ...r, description: DESCRIPTION_V6[r.id]! } : r)),
};
