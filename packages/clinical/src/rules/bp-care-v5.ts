import { BP_CARE_V4 } from "./bp-care-v4";
import type { Rule, RuleSet } from "../types";

/**
 * Blood pressure triage rule set, version 5 (S67, module 16: pregnancy). DRAFT and PROPOSED: nothing here is signed, and an
 * agent never signs it (INV-02, CMO sign-off hub `/clinician/clinical-signoff`). Version 4 (S07x, decision C5) stays exactly as it is; version 5 is
 * version 4 plus exactly two changes, both from the CMO selections recorded 2026-10-07
 * (`docs/plans/S66-S70-cmo-signoff-pack.md`, item A2), and a test pins that nothing else moved from version 4 (the server row is derived from the stored v4 in 20261013190000_s67_bp_rule_set_v5_pregnancy.sql):
 *
 *  1. `preeclampsiaFlag` gains `sudden_face_hand_swelling` (sudden swelling of the face or hands).
 *  2. A new group `obstetricEmergency` (`convulsion`, `loss_of_consciousness`) and a new rule BP-P6: in pregnancy or the first
 *     weeks after a birth, either symptom is RED and pages the on-call clinician with no reading needed (any reading, however
 *     ordinary, does not soften it; a rejected reading still shows the guidance, see the engine).
 *
 * The thresholds in item A1 are NOT changed because they already are the rules in version 3: BP-P4 (a reading of 140/90 or more
 * with a pre-eclampsia symptom is red), BP-P3 (either value at 160/110 or more is red and pages) and BP-P1 (a pregnant reading
 * is routed to a clinician, amber). BP-P1 routes EVERY pregnant reading, not only those at 140/90 or more (the task is
 * de-duplicated to one a week); that is wider than the wording of A1 and is recorded as OQ-340 for the CMO.
 */
const P6: Rule = {
  id: "BP-P6",
  description: "Pregnancy or first 6 weeks after birth: a convulsion or loss of consciousness is an emergency, whatever the reading",
  triggers: ["observation"],
  result: "grade",
  grade: "red",
  explanationKey: "EMG-001",
  when: {
    all: [
      { field: "obstetric", op: "eq", value: true },
      { symptomGroup: "obstetricEmergency" },
    ],
  },
  actions: [{ kind: "show_emergency_guidance", code: "EMG-001" }, { kind: "page_on_call" }],
};

const firstObstetricRed = BP_CARE_V4.rules.findIndex((r) => r.id === "BP-P3");

export const BP_CARE_V5: RuleSet = {
  ...BP_CARE_V4,
  version: 5,
  params: {
    ...BP_CARE_V4.params,
    symptomGroups: {
      ...BP_CARE_V4.params.symptomGroups,
      // (spread over a default, not `?? []`: version 4 always has the group, so a fallback branch could never run)
      preeclampsiaFlag: [...{ preeclampsiaFlag: [], ...BP_CARE_V4.params.symptomGroups }.preeclampsiaFlag, "sudden_face_hand_swelling"],
      obstetricEmergency: ["convulsion", "loss_of_consciousness"],
    },
  },
  rules: [...BP_CARE_V4.rules.slice(0, firstObstetricRed), P6, ...BP_CARE_V4.rules.slice(firstObstetricRed)],
};
