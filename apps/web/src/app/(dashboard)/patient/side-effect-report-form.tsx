"use client";

import { useState, type FormEvent } from "react";
import { useMedications } from "@/lib/queries/medications";
import {
  useMedicationSideEffectReports,
  useReportSideEffect,
} from "@/lib/queries/medication-side-effects";
import {
  medicationSideEffectReportSchema,
  medicationSideEffectSeverityValues,
} from "@/lib/validation/medication-side-effects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const SEVERITY_LABEL: Record<(typeof medicationSideEffectSeverityValues)[number], string> = {
  mild: "Mild — noticeable but not troubling",
  moderate: "Moderate — bothers me / affects daily life",
  severe: "Severe — I'm worried, or it stopped me taking it",
};

/**
 * 13.8 — "I think this medication is causing…". Structured symptom/onset/
 * severity/duration, separate from the freeform Week-2 adherence check-in
 * response (medication_adherence_checkins) — this is patient-initiated, any
 * time, and moderate/severe reports raise a real clinician task automatically
 * (private.raise_side_effect_report_alert).
 */
export function SideEffectReportForm({ patientId }: { patientId: string }) {
  const { data: medications } = useMedications(patientId);
  const { data: reports } = useMedicationSideEffectReports(patientId);
  const reportSideEffect = useReportSideEffect();

  const [medicationId, setMedicationId] = useState("");
  const [symptom, setSymptom] = useState("");
  const [onsetDate, setOnsetDate] = useState("");
  const [severity, setSeverity] =
    useState<(typeof medicationSideEffectSeverityValues)[number]>("mild");
  const [durationText, setDurationText] = useState("");
  const [description, setDescription] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function resetForm() {
    setMedicationId("");
    setSymptom("");
    setOnsetDate("");
    setSeverity("mild");
    setDurationText("");
    setDescription("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const medication = medications?.find((m) => m.id === medicationId);
    const parsed = medicationSideEffectReportSchema.safeParse({
      medication_id: medicationId,
      symptom,
      onset_date: onsetDate || undefined,
      severity,
      duration_text: durationText || undefined,
      description: description || undefined,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    setSuccess(false);
    reportSideEffect.mutate(
      { ...parsed.data, patientId, organisationId: medication?.organisation_id ?? "" },
      {
        onSuccess: () => {
          setSuccess(true);
          resetForm();
        },
      }
    );
  }

  const mutationError = (reportSideEffect.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Report a possible side effect</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-charcoal-ink/60">
          &ldquo;I think this medication is causing…&rdquo; A moderate or severe report
          reaches your care team directly, not just at your next check-in.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="side_effect_medication">Medication</Label>
            <Select
              id="side_effect_medication"
              value={medicationId}
              onChange={(event) => setMedicationId(event.target.value)}
              required
            >
              <option value="" disabled>
                Select a medication
              </option>
              {(medications ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.drug_name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="side_effect_symptom">What are you noticing?</Label>
            <Input
              id="side_effect_symptom"
              placeholder="e.g. Dry cough, nausea, dizziness"
              value={symptom}
              onChange={(event) => setSymptom(event.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="side_effect_onset">When did it start? (optional)</Label>
              <Input
                id="side_effect_onset"
                type="date"
                value={onsetDate}
                onChange={(event) => setOnsetDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="side_effect_duration">How long has it lasted? (optional)</Label>
              <Input
                id="side_effect_duration"
                placeholder="e.g. Ongoing for 3 days"
                value={durationText}
                onChange={(event) => setDurationText(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="side_effect_severity">How would you rate it?</Label>
            <Select
              id="side_effect_severity"
              value={severity}
              onChange={(event) =>
                setSeverity(event.target.value as (typeof medicationSideEffectSeverityValues)[number])
              }
            >
              {medicationSideEffectSeverityValues.map((value) => (
                <option key={value} value={value}>
                  {SEVERITY_LABEL[value]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="side_effect_description">Anything else? (optional)</Label>
            <Textarea
              id="side_effect_description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {displayError && <p className="text-sm text-red-600">{displayError}</p>}
          {success && (
            <p className="text-sm text-brand-green">
              Report sent to your care team.
            </p>
          )}
          <Button type="submit" disabled={reportSideEffect.isPending || !medicationId}>
            {reportSideEffect.isPending ? "Sending…" : "Send report"}
          </Button>
        </form>

        {reports && reports.length > 0 && (
          <div className="mt-4 border-t border-charcoal-ink/10 pt-3">
            <p className="mb-2 text-xs font-medium text-charcoal-ink/60">Your reports</p>
            <ul className="space-y-2">
              {reports.map((report) => (
                <li key={report.id} className="flex items-start justify-between gap-2 text-sm">
                  <div>
                    <p className="text-charcoal-ink">
                      {report.medication?.drug_name ?? "A medication"} — {report.symptom}
                    </p>
                    <p className="text-xs text-charcoal-ink/50">
                      {new Date(report.reported_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant={report.status === "new" ? "amber" : "grey"}>
                    {report.status === "new" ? "Awaiting review" : "Reviewed"}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
