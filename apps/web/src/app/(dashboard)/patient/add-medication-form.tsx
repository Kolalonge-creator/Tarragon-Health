"use client";

import { useState, type FormEvent } from "react";
import { useAddMedication } from "@/lib/queries/medications";
import { medicationSchema } from "@/lib/validation/medications";
import { diabetesDrugSafety, type DrugSafetySeverity } from "@/lib/rules/diabetes-drug-safety";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AddMedicationForm({
  patientId,
  source,
  pregnant = false,
}: {
  patientId: string;
  source: "patient" | "clinician";
  /** Clinician context: patient is pregnant → advisory contraindicates orals / ACEi-ARB. */
  pregnant?: boolean;
}) {
  const addMedication = useAddMedication();
  const [drugName, setDrugName] = useState("");
  const [dose, setDose] = useState("");
  const [frequency, setFrequency] = useState("");
  const [refillDate, setRefillDate] = useState("");
  const [scheduleTimes, setScheduleTimes] = useState<string[]>([]);
  const [newTime, setNewTime] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Patients can log a medication a specialist started (pathway Scenario 3),
  // attributing it to the specialist by name + optional consultation document.
  const [startedBySpecialist, setStartedBySpecialist] = useState(false);
  const [prescriberName, setPrescriberName] = useState("");
  const [prescriberDocUrl, setPrescriberDocUrl] = useState("");
  const specialistFieldsShown = source === "patient" && startedBySpecialist;

  function addTime() {
    if (newTime && !scheduleTimes.includes(newTime)) {
      setScheduleTimes((prev) => [...prev, newTime].sort());
      setNewTime("");
    }
  }

  function removeTime(time: string) {
    setScheduleTimes((prev) => prev.filter((t) => t !== time));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = medicationSchema.safeParse({
      drug_name: drugName,
      dose: dose || undefined,
      frequency: frequency || undefined,
      refill_date: refillDate || undefined,
      schedule_times: scheduleTimes,
      prescriber_name: specialistFieldsShown ? prescriberName || undefined : undefined,
      prescriber_document_url: specialistFieldsShown
        ? prescriberDocUrl || undefined
        : undefined,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    setSuccess(false);
    const effectiveSource = specialistFieldsShown ? "specialist" : source;
    addMedication.mutate(
      { ...parsed.data, patientId, source: effectiveSource },
      {
        onSuccess: () => {
          setSuccess(true);
          setDrugName("");
          setDose("");
          setFrequency("");
          setRefillDate("");
          setScheduleTimes([]);
          setStartedBySpecialist(false);
          setPrescriberName("");
          setPrescriberDocUrl("");
        },
      }
    );
  }

  const mutationError = (addMedication.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  // Clinician-facing prescribe-time drug-safety cautions (§13.5). Advisory only
  // — the platform never blocks a prescription; the doctor decides. Shown for
  // recognised glucose-lowering drugs; patient self-add keeps a calm UI.
  const safetyNotes = source === "clinician" ? diabetesDrugSafety(drugName, { pregnant }) : [];
  const SEVERITY_STYLE: Record<DrugSafetySeverity, string> = {
    contraindicated: "text-red-700",
    caution: "text-amber-700",
    info: "text-charcoal-ink/70",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a medication</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="drug_name">Drug name</Label>
            <Input
              id="drug_name"
              value={drugName}
              onChange={(event) => setDrugName(event.target.value)}
              required
            />
            {safetyNotes.length > 0 && (
              <div className="mt-1 space-y-1 rounded-md border border-amber-200 bg-amber-50/50 p-2.5">
                <p className="text-xs font-medium text-charcoal-ink/80">
                  Prescribing notes (advisory)
                </p>
                <ul className="space-y-0.5">
                  {safetyNotes.map((n, i) => (
                    <li key={i} className={`text-xs ${SEVERITY_STYLE[n.severity]}`}>
                      {n.severity === "contraindicated" ? "⛔ " : n.severity === "caution" ? "⚠️ " : "• "}
                      {n.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="dose">Dose</Label>
              <Input
                id="dose"
                placeholder="e.g. 10mg"
                value={dose}
                onChange={(event) => setDose(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="frequency">Frequency</Label>
              <Input
                id="frequency"
                placeholder="e.g. Twice daily"
                value={frequency}
                onChange={(event) => setFrequency(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="refill_date">Refill date (optional)</Label>
            <Input
              id="refill_date"
              type="date"
              value={refillDate}
              onChange={(event) => setRefillDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new_time">Dose times</Label>
            <div className="flex gap-2">
              <Input
                id="new_time"
                type="time"
                value={newTime}
                onChange={(event) => setNewTime(event.target.value)}
                className="w-32"
              />
              <Button type="button" variant="outline" size="sm" onClick={addTime}>
                Add time
              </Button>
            </div>
            {scheduleTimes.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {scheduleTimes.map((time) => (
                  <span
                    key={time}
                    className="inline-flex items-center gap-1 rounded-full bg-charcoal-ink/10 px-2.5 py-1 text-xs text-charcoal-ink/80"
                  >
                    {time}
                    <button
                      type="button"
                      onClick={() => removeTime(time)}
                      aria-label={`Remove ${time}`}
                      className="text-charcoal-ink/50 hover:text-charcoal-ink"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          {source === "patient" && (
            <div className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
              <label className="flex items-center gap-2 text-sm text-charcoal-ink">
                <input
                  type="checkbox"
                  checked={startedBySpecialist}
                  onChange={(event) => setStartedBySpecialist(event.target.checked)}
                  className="h-4 w-4"
                />
                A specialist started this medication
              </label>
              {specialistFieldsShown && (
                <div className="space-y-3 pt-1">
                  <div className="space-y-1.5">
                    <Label htmlFor="prescriber_name">Specialist name</Label>
                    <Input
                      id="prescriber_name"
                      placeholder="e.g. Dr. Adeyemi (Cardiologist)"
                      value={prescriberName}
                      onChange={(event) => setPrescriberName(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="prescriber_document_url">
                      Consultation document link (optional)
                    </Label>
                    <Input
                      id="prescriber_document_url"
                      type="url"
                      placeholder="https://…"
                      value={prescriberDocUrl}
                      onChange={(event) => setPrescriberDocUrl(event.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          {displayError && <p className="text-sm text-red-600">{displayError}</p>}
          {success && <p className="text-sm text-brand-green">Medication added.</p>}
          <Button type="submit" disabled={addMedication.isPending}>
            {addMedication.isPending ? "Saving…" : "Add medication"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
