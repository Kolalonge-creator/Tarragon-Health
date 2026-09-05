"use client";

import { useState, type FormEvent } from "react";
import { useAddMedication } from "@/lib/queries/medications";
import { checkMedicationSafetyAfterAdd } from "./actions";
import { medicationSchema, type MedicationInput } from "@/lib/validation/medications";
import { diabetesDrugSafety, type DrugSafetySeverity } from "@/lib/rules/diabetes-drug-safety";
import { controlledSubstanceInfo } from "@/lib/rules/controlled-substances";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SEVERITY_STYLE: Record<DrugSafetySeverity, string> = {
  contraindicated: "text-red-700 dark:text-red-300",
  caution: "text-amber-700 dark:text-amber-300",
  info: "text-charcoal-ink/70 dark:text-night-ink/70",
};

/** Medication safety pathway 64.7 — Morning/Afternoon/Evening, so a patient doesn't need to translate "morning" into a clock time themselves. Custom entry (below) covers everything else. */
const DOSE_TIME_PRESETS: { label: string; time: string }[] = [
  { label: "Morning", time: "08:00" },
  { label: "Afternoon", time: "13:00" },
  { label: "Evening", time: "20:00" },
];

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

  // Prescription order-entry detail (Care Team / Provider Workspace §5.10) —
  // clinician-source only, a patient self-adding a medication they're already
  // taking has no route/duration/repeats to record.
  const [route, setRoute] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [quantity, setQuantity] = useState("");
  const [repeatsAllowed, setRepeatsAllowed] = useState("");
  const [indication, setIndication] = useState("");
  const [instructions, setInstructions] = useState("");

  // Draft -> Signed (§5.11, clinician path only): nothing is written until
  // the clinician explicitly signs on the review screen. The patient
  // self-add path is unchanged — a single-step submit, since it's a
  // self-report, not a clinical order.
  const [step, setStep] = useState<"form" | "review">("form");
  const [pendingData, setPendingData] = useState<MedicationInput | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  // Care Team / Provider Workspace §5.19 — an additional, separate
  // acknowledgement for a controlled/restricted medicine, required alongside
  // (not instead of) the general safety-notes checkbox above.
  const [controlledAcknowledged, setControlledAcknowledged] = useState(false);

  function addTime() {
    addScheduleTime(newTime);
    setNewTime("");
  }

  /** Medication safety pathway 64.7 — Morning/Afternoon/Evening presets, alongside the free-entry "custom" time above. */
  function addScheduleTime(time: string) {
    if (time && !scheduleTimes.includes(time)) {
      setScheduleTimes((prev) => [...prev, time].sort());
    }
  }

  function removeTime(time: string) {
    setScheduleTimes((prev) => prev.filter((t) => t !== time));
  }

  function resetForm() {
    setDrugName("");
    setDose("");
    setFrequency("");
    setRefillDate("");
    setScheduleTimes([]);
    setStartedBySpecialist(false);
    setPrescriberName("");
    setPrescriberDocUrl("");
    setRoute("");
    setDurationDays("");
    setQuantity("");
    setRepeatsAllowed("");
    setIndication("");
    setInstructions("");
    setStep("form");
    setPendingData(null);
    setAcknowledged(false);
    setControlledAcknowledged(false);
  }

  function submitMedication(data: MedicationInput) {
    const effectiveSource = specialistFieldsShown ? "specialist" : source;
    addMedication.mutate(
      { ...data, patientId, source: effectiveSource },
      {
        onSuccess: () => {
          setSuccess(true);
          resetForm();
          // Medication safety pathway 64.16-64.18: only a clinician actually
          // driving this form satisfies the underlying RPC's org-staff check
          // (see checkMedicationSafetyAfterAdd) — never fired for a patient's
          // own self-add, even one attributed to a specialist. Fire-and-forget:
          // never awaited, never blocks or affects the success state above.
          if (source === "clinician") {
            void checkMedicationSafetyAfterAdd(patientId);
          }
        },
      }
    );
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
      route: source === "clinician" ? route || undefined : undefined,
      duration_days: source === "clinician" ? durationDays || undefined : undefined,
      quantity: source === "clinician" ? quantity || undefined : undefined,
      repeats_allowed: source === "clinician" ? repeatsAllowed || undefined : undefined,
      indication: source === "clinician" ? indication || undefined : undefined,
      instructions: source === "clinician" ? instructions || undefined : undefined,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    setSuccess(false);

    if (source === "patient") {
      submitMedication(parsed.data);
      return;
    }

    // Clinician path: hold the validated draft for review instead of writing
    // it — the actual insert only fires from "Sign & prescribe" below.
    setPendingData(parsed.data);
    setStep("review");
  }

  function handleSign() {
    if (!pendingData || !acknowledged) return;
    submitMedication(pendingData);
  }

  const mutationError = (addMedication.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  // Clinician-facing prescribe-time drug-safety cautions (§13.5). Advisory only
  // — the platform never blocks a prescription; the doctor decides. Shown for
  // recognised glucose-lowering drugs; patient self-add keeps a calm UI.
  const safetyNotes = source === "clinician" ? diabetesDrugSafety(drugName, { pregnant }) : [];
  const controlledInfo =
    step === "review" && pendingData ? controlledSubstanceInfo(pendingData.drug_name) : null;

  if (step === "review" && pendingData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Review &amp; sign prescription</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3 text-sm">
            <ReviewRow label="Drug" value={pendingData.drug_name} />
            <ReviewRow label="Dose" value={pendingData.dose} />
            <ReviewRow label="Frequency" value={pendingData.frequency} />
            <ReviewRow label="Route" value={pendingData.route} />
            <ReviewRow
              label="Duration"
              value={pendingData.duration_days ? `${pendingData.duration_days} day(s)` : undefined}
            />
            <ReviewRow label="Quantity" value={pendingData.quantity} />
            <ReviewRow
              label="Repeats allowed"
              value={pendingData.repeats_allowed !== undefined ? String(pendingData.repeats_allowed) : undefined}
            />
            <ReviewRow label="Indication" value={pendingData.indication} />
            <ReviewRow label="Instructions" value={pendingData.instructions} />
            <ReviewRow label="Refill date" value={pendingData.refill_date} />
            <ReviewRow
              label="Dose times"
              value={pendingData.schedule_times.length > 0 ? pendingData.schedule_times.join(", ") : undefined}
            />
          </dl>

          {safetyNotes.length > 0 && (
            <div className="space-y-1 rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/10 p-2.5">
              <p className="text-xs font-medium text-charcoal-ink/80 dark:text-night-ink/80">Prescribing notes (advisory)</p>
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

          {controlledInfo && (
            <div className="space-y-2 rounded-md border border-red-200 dark:border-red-500/30 bg-red-50/60 dark:bg-red-500/10 p-2.5">
              <p className="text-xs font-medium text-red-800 dark:text-red-300">
                Controlled/restricted medicine: {controlledInfo.label}
              </p>
              <p className="text-xs text-red-800/80 dark:text-red-300/80">{controlledInfo.note}</p>
              <label className="flex items-start gap-2 text-sm text-charcoal-ink dark:text-night-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={controlledAcknowledged}
                  onChange={(event) => setControlledAcknowledged(event.target.checked)}
                />
                I confirm the additional safeguard above for this controlled/restricted medicine.
              </label>
            </div>
          )}

          <label className="flex items-start gap-2 text-sm text-charcoal-ink dark:text-night-ink">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            I&apos;ve reviewed the safety notes above and the Medication Safety panel for this
            patient, and confirm this prescription is correct.
          </label>

          {displayError && <p className="text-sm text-red-600 dark:text-red-300">{displayError}</p>}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={handleSign}
              disabled={!acknowledged || (!!controlledInfo && !controlledAcknowledged) || addMedication.isPending}
            >
              {addMedication.isPending ? "Signing…" : "Sign & prescribe"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep("form")}
              disabled={addMedication.isPending}
            >
              Back to edit
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{source === "clinician" ? "Prescribe a medication" : "Add a medication"}</CardTitle>
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
              <div className="mt-1 space-y-1 rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/10 p-2.5">
                <p className="text-xs font-medium text-charcoal-ink/80 dark:text-night-ink/80">
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
          {source === "clinician" && (
            <div className="space-y-3 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
              <p className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">Prescription detail</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="route">Route</Label>
                  <Input
                    id="route"
                    placeholder="e.g. Oral"
                    value={route}
                    onChange={(event) => setRoute(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="duration_days">Duration (days)</Label>
                  <Input
                    id="duration_days"
                    type="number"
                    min={1}
                    placeholder="Leave blank if ongoing"
                    value={durationDays}
                    onChange={(event) => setDurationDays(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input
                    id="quantity"
                    placeholder="e.g. 30 tablets"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="repeats_allowed">Repeats allowed</Label>
                  <Input
                    id="repeats_allowed"
                    type="number"
                    min={0}
                    max={99}
                    placeholder="0"
                    value={repeatsAllowed}
                    onChange={(event) => setRepeatsAllowed(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="indication">Indication</Label>
                <Input
                  id="indication"
                  placeholder="Why this was prescribed, e.g. Hypertension"
                  value={indication}
                  onChange={(event) => setIndication(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="instructions">Patient instructions</Label>
                <Input
                  id="instructions"
                  placeholder="e.g. Take with food"
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                />
              </div>
            </div>
          )}
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
            <div className="flex flex-wrap gap-2">
              {DOSE_TIME_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addScheduleTime(preset.time)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                id="new_time"
                type="time"
                value={newTime}
                onChange={(event) => setNewTime(event.target.value)}
                className="w-32"
              />
              <Button type="button" variant="outline" size="sm" onClick={addTime}>
                Add custom time
              </Button>
            </div>
            {scheduleTimes.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {scheduleTimes.map((time) => (
                  <span
                    key={time}
                    className="inline-flex items-center gap-1 rounded-full bg-charcoal-ink/10 dark:bg-night-ink/15 px-2.5 py-1 text-xs text-charcoal-ink/80 dark:text-night-ink/80"
                  >
                    {time}
                    <button
                      type="button"
                      onClick={() => removeTime(time)}
                      aria-label={`Remove ${time}`}
                      className="text-charcoal-ink/50 dark:text-night-ink/55 hover:text-charcoal-ink dark:hover:text-night-ink"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          {source === "patient" && (
            <div className="space-y-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
              <label className="flex items-center gap-2 text-sm text-charcoal-ink dark:text-night-ink">
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
          {displayError && <p className="text-sm text-red-600 dark:text-red-300">{displayError}</p>}
          {success && <p className="text-sm text-brand-green dark:text-brand-green-bright">Medication added.</p>}
          <Button type="submit" disabled={addMedication.isPending}>
            {source === "clinician"
              ? "Continue to review"
              : addMedication.isPending
                ? "Saving…"
                : "Add medication"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ReviewRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">{label}</dt>
      <dd className="text-charcoal-ink dark:text-night-ink">{value}</dd>
    </div>
  );
}
