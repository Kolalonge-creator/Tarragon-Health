import { BP_CARE_V1 } from "./bp-care-v1";
import type { RuleSet } from "../types";

/**
 * Blood pressure triage rule set, version 3. IDENTICAL to version 2 except the silence line: a care-pack patient with no readings gets the
 * silence task on day 7, not day 5 (founder and CMO decision S11-1, 2026-10-07; spec safety case 7 said 5).
 *
 * Naming note: the exported constant `BP_CARE_V1` is the file's original name and, since S11c, holds rule set version 2 (the CMO's decisions
 * of 2026-10-05). Version 2 was approved on 2026-10-06 and then retired the same night when version 1 was approved by mistake, which put the
 * older 16-rule set live. Version 3 restores version 2's rules and adds the 7 day silence line in one signature.
 *
 * Built from version 2 on purpose so the two cannot drift: the only differences are the version and `params.silence.days`, a test pins exactly
 * that, and the server seed (`20261007152136_s11c_bp_care_triage_v3.sql`) derives the same object from the stored version 2 row.
 */
export const BP_CARE_V3: RuleSet = {
  ...BP_CARE_V1,
  version: 3,
  params: { ...BP_CARE_V1.params, silence: { days: 7 } },
};
