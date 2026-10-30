import {
  checkOmissions,
  type OmissionFlag,
  type OmissionInput,
  type OmissionResult,
  type OmissionRules,
  type OmissionRulesMeta,
} from "@tarragon/clinical/omission-check";
import { canShow, classifyCarePlan, classifyMedication, classifyText, type BriefAccess, type BriefRules } from "@/lib/previsit/brief";

export interface OmissionRecord {
  allergies: readonly { id: string; allergen: string }[];
  medications: readonly { id: string; drug_name: string; indication?: string | null; care_plan_condition?: string | null }[];
  carePlans: readonly { id: string; condition: string }[];
  gaps: readonly { gap_type: string | null; condition_or_type: string | null; opened_at: string | null }[];
}

export const RESTRICTED_CLASH_MESSAGE = "A clash with a restricted record item was found: ask the patient's care team.";
export const RESTRICTED_UNCHECKED_MESSAGE = "A restricted record item could not be checked against this draft: ask the patient's care team.";

const gapId = (g: OmissionRecord["gaps"][number]): string => `${g.gap_type}:${g.condition_or_type}:${g.opened_at ?? ""}`;

function toInput(draftText: string, rec: OmissionRecord): OmissionInput {
  return {
    draftText,
    allergies: rec.allergies.map((a) => ({ id: a.id, allergen: a.allergen })),
    medications: rec.medications.map((m) => ({ id: m.id, name: m.drug_name })),
    conditions: rec.carePlans.map((p) => ({ id: p.id, name: p.condition.replace(/_/g, " ") })),
    awaitingResults: rec.gaps
      .filter((g) => g.gap_type === "unactioned_abnormal" && g.condition_or_type)
      .map((g) => ({ id: gapId(g), label: g.condition_or_type as string })),
  };
}

/**
 * Runs the omission check for a viewer. The SAFETY check (a drug in the draft against the allergy list) always runs on the full record,
 * whatever categories the viewer may see: hiding an allergy from the check would let a clash through. What the viewer is shown is
 * limited to what they may see: a flag that comes from a restricted allergy is replaced by one generic line that names nothing, and
 * completeness prompts (unmentioned medicines, results, conditions) about restricted items are left out. At most one generic line is ever shown, so it never says how many restricted items exist.
 */
export function runOmissionCheck(args: {
  draftText: string;
  record: OmissionRecord;
  access: BriefAccess;
  briefRules: BriefRules;
  omissionRules: OmissionRules;
  meta: OmissionRulesMeta;
}): OmissionResult {
  const { draftText, record, access, briefRules, omissionRules, meta } = args;
  const shown: OmissionRecord = {
    allergies: record.allergies.filter((a) => canShow(classifyText(a.allergen, briefRules), access)),
    medications: record.medications.filter((m) => canShow(classifyMedication({ ...m, refill_date: null, updated_at: "" }, briefRules), access)),
    carePlans: record.carePlans.filter((p) => canShow(classifyCarePlan({ ...p, updated_at: "" }, briefRules), access)),
    gaps: record.gaps.filter((g) => canShow(classifyText(`${g.gap_type ?? ""} ${g.condition_or_type ?? ""}`, briefRules), access)),
  };
  const shownAllergyIds = new Set(shown.allergies.map((a) => a.id));

  const full = checkOmissions(toInput(draftText, record), omissionRules, meta);
  const visible = checkOmissions(toInput(draftText, shown), omissionRules, meta);

  const restricted = (kind: OmissionFlag["kind"]) => full.flags.some((f) => f.kind === kind && !shownAllergyIds.has(f.sourceId));
  const generic: OmissionFlag[] = [];
  if (restricted("drug_vs_allergy")) {
    generic.push({ kind: "restricted_item", severity: "info", sourceId: "restricted", detail: "", message: RESTRICTED_CLASH_MESSAGE });
  }
  // The clash line says more; when it is shown the "could not be checked" line adds nothing.
  if (generic.length === 0 && restricted("allergy_not_checked")) {
    generic.push({ kind: "restricted_item", severity: "info", sourceId: "restricted", detail: "", message: RESTRICTED_UNCHECKED_MESSAGE });
  }
  return { ...visible, flags: [...visible.flags, ...generic] };
}
