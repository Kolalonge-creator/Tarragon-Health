"use client";

import { getProposedConfig } from "@tarragon/shared";
import type { OmissionRules, OmissionResult } from "@tarragon/clinical/omission-check";
import { runOmissionCheck } from "@/lib/copilot/run-omission-check";
import { useAllergies } from "@/lib/queries/allergies";
import { useMedications } from "@/lib/queries/medications";
import { useCarePlans } from "@/lib/queries/care-plans";
import { usePatientCareGaps } from "@/lib/queries/patient-care-gaps";
import { NO_SENSITIVE_ACCESS, type BriefRules, type SensitiveCategory } from "@/lib/previsit/brief";

const KIND_LABEL = { medication: "Medicine", result: "Result", allergy: "Allergy", condition: "Condition" } as const;

/** True when the panel is switched on. OFF until the CMO signs `copilot.omission_rules`. */
export function omissionPanelEnabled(): boolean {
  return getProposedConfig("copilot.omission_panel_enabled").value === true;
}

/**
 * Pure display of a checker result: flags and the "source items not used" list. It decides nothing and has no way to block signing:
 * there is no disabled state anywhere in it and nothing it renders is wired to a Sign button.
 */
export function OmissionResultView({ result }: { result: OmissionResult }) {
  const unsigned = result.rulesStatus !== "confirmed";
  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 p-3 text-xs" data-testid="omission-panel">
      <p className="font-medium">Check against the record (a prompt to look, not a decision)</p>
      {unsigned && (
        <p className="text-charcoal-ink/60">The rules behind these flags (version {result.rulesVersion}) have not yet been signed by your Chief Medical Officer.</p>
      )}
      {result.flags.length === 0 ? (
        <p className="text-charcoal-ink/70">Nothing to flag from the record.</p>
      ) : (
        <ul className="list-disc space-y-1 pl-4" aria-label="Flags">
          {result.flags.map((f, i) => (
            <li key={`${f.kind}-${f.sourceId}-${i}`} data-flag={f.kind}>{f.message}</li>
          ))}
        </ul>
      )}
      <div>
        <p className="font-medium">Source items not used in the draft</p>
        {result.sourceItemsNotUsed.length === 0 ? (
          <p className="text-charcoal-ink/70">Every item in the record is mentioned.</p>
        ) : (
          <ul className="list-disc pl-4" aria-label="Source items not used">
            {result.sourceItemsNotUsed.map((s) => (
              <li key={`${s.kind}-${s.id}`}>{KIND_LABEL[s.kind]}: {s.label}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Loads the record through the existing hooks and shows the checker next to a draft. Renders nothing while the flag is off, while a read is
 * loading or refused (a refused read must not read as "nothing in the record"), or while the draft is empty.
 */
export function OmissionPanel({ patientId, draftText, access = NO_SENSITIVE_ACCESS }: { patientId: string; draftText: string; access?: Record<SensitiveCategory, boolean> }) {
  const enabled = omissionPanelEnabled();
  const allergies = useAllergies(enabled ? patientId : "");
  const medications = useMedications(enabled ? patientId : "");
  const carePlans = useCarePlans(enabled ? patientId : "");
  const gaps = usePatientCareGaps(enabled ? patientId : "");

  if (!enabled || draftText.trim() === "") return null;
  if (!allergies.data || !medications.data || !carePlans.data || !gaps.data) return null;

  const rulesEntry = getProposedConfig("copilot.omission_rules");
  const briefRules = getProposedConfig("copilot.previsit_brief_rules").value as unknown as BriefRules;
  // The check runs on the whole record; only what is shown is limited to what the viewer may see (see runOmissionCheck).
  const result = runOmissionCheck({
    draftText,
    record: {
      allergies: allergies.data.map((a) => ({ id: a.id, allergen: a.allergen })),
      medications: medications.data.map((m) => ({ id: m.id, drug_name: m.drug_name, indication: m.indication, care_plan_condition: m.care_plan?.condition ?? null })),
      carePlans: carePlans.data.map((p) => ({ id: p.id, condition: p.condition })),
      gaps: gaps.data,
    },
    access,
    briefRules,
    omissionRules: rulesEntry.value as unknown as OmissionRules,
    meta: { version: rulesEntry.version, status: rulesEntry.status },
  });
  return <OmissionResultView result={result} />;
}
