import { BP_CARE_V3 } from "./bp-care-v3";
import type { Rule, RuleSet } from "../types";

/**
 * Blood pressure triage rule set, version 4 (decision C5, approved text of 2026-10-07, NOT signed). IDENTICAL to version 3 except rule BP-A7:
 * a systolic under 90 with no symptom now raises the amber 24 hour care-team review only for a patient who is taking blood pressure medicines
 * (`onBpMedicines`; unknown counts as taking them, so a phone that cannot tell behaves like version 3 and only the server, which knows, switches it off). Version 3 flagged everyone (the CMO's 2026-10-05 decision); C5 option (a) narrows it to the group where a low reading is a
 * medicine-related risk, which keeps the alert volume low. No guideline sets a home action line for a low reading without symptoms, so this is the CMO's
 * own clinical judgement. A low reading WITH fainting, confusion or chest pain is still red (BP-R3), and low with dizziness is still amber (BP-A3).
 *
 * Built from version 3 so the two cannot drift: a test pins that the only differences are the version and the BP-A7 condition and description, and that
 * the server seed (`..._s07x_bp_care_triage_v4_draft.sql`) derives the same object from the stored version 3 row. It stays a DRAFT: signing it is the CMO's act,
 * through `approve_triage_rule_set`, and it must never be signed by an agent. While it is a draft, version 3 stays in force.
 */
const A7_ON_MEDICINES: Rule["when"] = {
  all: [
    { field: "reading.systolic", op: "lt", value: { ref: "params.low.redSystolic" } },
    { field: "onBpMedicines", op: "eq", value: true },
  ],
};

export const BP_CARE_V4: RuleSet = {
  ...BP_CARE_V3,
  version: 4,
  rules: BP_CARE_V3.rules.map((r) =>
    r.id === "BP-A7"
      ? { ...r, description: "Systolic under 90 with no symptom, in a patient taking blood pressure medicines (CMO decision C5)", when: A7_ON_MEDICINES }
      : r,
  ),
};
