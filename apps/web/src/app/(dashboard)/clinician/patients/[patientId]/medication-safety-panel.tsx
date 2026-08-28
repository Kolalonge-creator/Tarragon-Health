import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadMedicationSafety } from "@/lib/clinical/patient-clinical-context";
import type { DrugSafetySeverity, FindingKind } from "@/lib/rules/drug-safety";
import { FlagSafetyFindingButton } from "./medication-safety-flag-button";

// Which unified clinician_alerts type_code a finding kind maps to when a
// clinician chooses to persist it (13.9's manual-raise mechanism) —
// allergy/renal/drug-specific concerns are a general medication_safety
// alert; a genuine two-drug interaction or duplicate therapy is more
// specifically potential_interaction.
const FINDING_TYPE_CODE: Record<FindingKind, "medication_safety" | "potential_interaction"> = {
  interaction: "potential_interaction",
  duplicate_therapy: "potential_interaction",
  renal_dosing: "medication_safety",
  drug_specific: "medication_safety",
  allergy: "medication_safety",
};

const SEVERITY_BADGE: Record<DrugSafetySeverity, { label: string; variant: "red" | "amber" | "grey" }> = {
  contraindicated: { label: "Avoid", variant: "red" },
  caution: { label: "Caution", variant: "amber" },
  info: { label: "Note", variant: "grey" },
};

const KIND_LABEL: Record<FindingKind, string> = {
  interaction: "Interaction",
  duplicate_therapy: "Duplicate therapy",
  renal_dosing: "Kidney function",
  drug_specific: "Drug note",
  allergy: "Allergy",
};

const ALLERGY_SEVERITY_VARIANT: Record<string, "red" | "amber" | "grey"> = {
  severe: "red",
  moderate: "amber",
  mild: "grey",
};

const CKD_RISK_VARIANT: Record<string, "red" | "amber" | "grey" | "green"> = {
  low: "green",
  moderate: "amber",
  high: "amber",
  very_high: "red",
};

/**
 * The checks a dispensing pharmacist makes, surfaced to the clinician who
 * actually decides.
 *
 * ADVISORY ONLY, and the copy says so plainly rather than leaving a clean panel
 * to be read as a clearance. A clean panel means "no rule in a curated set
 * fired", which is a different statement from "this list is safe".
 */
export async function MedicationSafetyPanel({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const { report, egfr, egfrUnavailableReason, ckdRisk, ckdRiskUnavailableReason, medicationCount, allergies } =
    await loadMedicationSafety(supabase, patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Medication safety</CardTitle>
        <CardDescription>
          Interactions, duplicate therapy, allergy cross-checks, and kidney-function dosing across the{" "}
          {medicationCount} active medicine{medicationCount === 1 ? "" : "s"} on file. Advisory:
          nothing here changes a prescription.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Allergies next to the medicine count so a clean findings list below can never be misread as "no allergies". */}
        <div className="rounded-lg border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3">
          <p className="text-sm font-medium text-charcoal-ink">Recorded allergies</p>
          {allergies.length === 0 ? (
            <p className="mt-0.5 text-xs text-charcoal-ink/60">
              None on file; this means none has been recorded, not that the patient is confirmed
              allergy-free.
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {allergies.map((a) => (
                <Badge key={a.id} variant={(a.severity && ALLERGY_SEVERITY_VARIANT[a.severity]) || "grey"}>
                  {a.allergen}
                  {a.reaction ? `: ${a.reaction}` : ""}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Kidney function first: it is the input half these checks depend on. */}
        <div className="rounded-lg border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3">
          {egfr ? (
            <>
              <p className="text-sm font-medium text-charcoal-ink">
                eGFR {egfr.egfr} mL/min/1.73m²{" "}
                <span className="font-normal text-charcoal-ink/60">({egfr.categoryLabel})</span>
              </p>
              <p className="mt-0.5 text-xs text-charcoal-ink/60">
                {egfr.equation}, from a creatinine taken{" "}
                {new Date(egfr.takenAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                .
              </p>
              {egfr.stale ? (
                <p className="mt-1 text-xs text-amber-700">
                  That creatinine is over a year old. Recheck kidney function before acting on the
                  dosing advice below.
                </p>
              ) : null}
              {ckdRisk ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant={CKD_RISK_VARIANT[ckdRisk.riskLevel] ?? "grey"}>
                    KDIGO CKD risk: {ckdRisk.riskLevel.replace("_", " ")}
                  </Badge>
                  <span className="text-xs text-charcoal-ink/60">
                    ACR {ckdRisk.acrCategoryLabel}
                    {ckdRisk.invisibleToEgfrAlone
                      ? ", eGFR alone would have looked reassuring here"
                      : ""}
                  </span>
                </div>
              ) : (
                <p className="mt-1 text-xs text-charcoal-ink/60">{ckdRiskUnavailableReason}</p>
              )}
            </>
          ) : (
            <p className="text-xs text-charcoal-ink/70">{egfrUnavailableReason}</p>
          )}
        </div>

        {medicationCount === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No active medicines on file.</p>
        ) : report.findings.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">
            No interaction, duplicate-therapy, allergy or renal-dosing rule fired for this list. That
            is not the same as a clearance; these checks cover a curated rule set, not a complete
            interaction database.
          </p>
        ) : (
          <ul className="space-y-2">
            {report.findings.map((finding, index) => {
              const badge = SEVERITY_BADGE[finding.severity];
              return (
                <li
                  key={`${finding.kind}-${finding.title}-${index}`}
                  className="rounded-lg border border-charcoal-ink/10 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <span className="text-[0.7rem] uppercase tracking-wide text-charcoal-ink/50">
                      {KIND_LABEL[finding.kind]}
                    </span>
                    <p className="text-sm font-medium text-charcoal-ink">{finding.title}</p>
                  </div>
                  <p className="mt-1 text-sm text-charcoal-ink/80">{finding.message}</p>
                  <p className="mt-1 text-xs text-charcoal-ink/55">
                    {[...new Set(finding.drugNames)].join(" · ")}
                  </p>
                  {(finding.severity === "contraindicated" || finding.severity === "caution") &&
                    finding.medicationIds[0] && (
                      <FlagSafetyFindingButton
                        patientId={patientId}
                        medicationId={finding.medicationIds[0]}
                        typeCode={FINDING_TYPE_CODE[finding.kind]}
                        severity={finding.severity}
                        message={`${finding.title}: ${finding.message}`}
                      />
                    )}
                </li>
              );
            })}
          </ul>
        )}

        {report.renalCheckSkipped && medicationCount > 0 ? (
          <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            {report.renalCheckSkipped}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
