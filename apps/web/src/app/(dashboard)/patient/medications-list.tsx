"use client";

import { useState, type FormEvent } from "react";
import {
  useConfirmMedicationRefill,
  useMedications,
  useStoppedMedications,
  useStopMedication,
  type MedicationWithCarePlan,
} from "@/lib/queries/medications";
import { usePatientNextReview } from "@/lib/queries/medication-reviews";
import { usePatientLabMonitoring } from "@/lib/queries/lab-monitoring";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEMANTIC_ICON } from "@/lib/icons";

const SOURCE_BADGE: Record<
  string,
  { variant: "blue" | "grey" | "amber"; label: string }
> = {
  clinician: { variant: "blue", label: "Prescribed" },
  specialist: { variant: "amber", label: "Specialist" },
  patient: { variant: "grey", label: "Self-added" },
};

export function MedicationsList({
  patientId,
  refillCoordinationEnabled,
  canConfirmRefill = false,
  canStop = false,
}: {
  patientId: string;
  /** 'medication_refills' feature — Free tier tracks medications but gets
   * no refill-date coordination (pricing.ts's Free-tier footnote). */
  refillCoordinationEnabled: boolean;
  /** Tier 1 doctors only (docs/Tarragon_Health_Master_Operating_Plan_v4.md
   * §4/§8) — confirms/continues an existing clinician-prescribed medication
   * without full prescribing authority. Never true for the patient's own
   * view or for Tier 2+/Director, who use AddMedicationForm's unrestricted
   * edit path instead. The DB (medications_update RLS +
   * enforce_medication_confirm_only trigger) is the real gate; this only
   * decides whether the control renders. */
  canConfirmRefill?: boolean;
  /** Renders the "Stop medication" control (patient's own view). RLS decides
   * the real permission — the patient may stop their own self-/specialist-
   * sourced rows; a clinician row needs prescribing authority. */
  canStop?: boolean;
}) {
  const { data, isLoading, isError } = useMedications(patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.medication className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Medications
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CabinetSummary patientId={patientId} />
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load medications.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No active medications.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((medication) => {
              const badge = SOURCE_BADGE[medication.source] ?? SOURCE_BADGE.patient;
              return (
                <li key={medication.id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">
                      {medication.drug_name}
                    </p>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {medication.care_plan?.condition && (
                      <Badge variant="green">
                        {formatCondition(medication.care_plan.condition)}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-charcoal-ink/60">
                    {[medication.dose, medication.frequency].filter(Boolean).join(" — ") ||
                      "No dose/frequency set"}
                  </p>
                  {medication.source === "specialist" && medication.prescriber_name && (
                    <p className="text-xs text-charcoal-ink/60">
                      Started by {medication.prescriber_name}
                      {medication.prescriber_document_url && (
                        <>
                          {" · "}
                          <a
                            href={medication.prescriber_document_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            consultation document
                          </a>
                        </>
                      )}
                    </p>
                  )}
                  {medication.refill_date && refillCoordinationEnabled && (
                    <p className="text-xs text-charcoal-ink/60">
                      Refill by {new Date(medication.refill_date).toLocaleDateString()} ·{" "}
                      {daysLeftLabel(medication.refill_date)}
                    </p>
                  )}
                  {medication.refill_date && !refillCoordinationEnabled && (
                    <p className="text-xs text-charcoal-ink/60">
                      Refill coordination is part of a paid plan —{" "}
                      <a href="/patient/subscription" className="underline">
                        see plans
                      </a>
                      .
                    </p>
                  )}
                  {medication.last_confirmed_at && (
                    <p className="text-xs text-charcoal-ink/60">
                      Confirmed by your care team ·{" "}
                      {new Date(medication.last_confirmed_at).toLocaleDateString()}
                    </p>
                  )}
                  {canConfirmRefill && medication.source === "clinician" && (
                    <ConfirmRefillForm medication={medication} patientId={patientId} />
                  )}
                  {canStop && (
                    <StopMedicationForm medication={medication} patientId={patientId} />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <PastMedications patientId={patientId} />
      </CardContent>
    </Card>
  );
}

/** Human-friendly care-plan condition label (enum values are snake_case). */
function formatCondition(condition: string): string {
  return condition
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** "· 5 days left" / "· due today" / "· 3 days overdue" for a date string. */
function daysLeftLabel(dateStr: string): string {
  const today = new Date(new Date().toDateString());
  const target = new Date(new Date(dateStr).toDateString());
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} left`;
  if (days === 0) return "due today";
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}

/** Top-of-cabinet summary: next medication review + next lab monitoring due. */
function CabinetSummary({ patientId }: { patientId: string }) {
  const { data: nextReview } = usePatientNextReview(patientId);
  const { data: labMonitoring } = usePatientLabMonitoring(patientId);
  const nextLab = (labMonitoring ?? []).find((m) => m.due_date != null);

  if (!nextReview && !nextLab) return null;

  return (
    <div className="mb-3 grid gap-2 rounded-md bg-charcoal-ink/5 p-3 sm:grid-cols-2">
      {nextReview && (
        <div>
          <p className="text-xs text-charcoal-ink/50">Next medication review</p>
          <p className="text-sm text-charcoal-ink">
            {new Date(nextReview.due_date).toLocaleDateString()}{" "}
            <span className="text-charcoal-ink/50">· {daysLeftLabel(nextReview.due_date)}</span>
          </p>
        </div>
      )}
      {nextLab && nextLab.due_date && (
        <div>
          <p className="text-xs text-charcoal-ink/50">Next lab test</p>
          <p className="text-sm text-charcoal-ink">
            {nextLab.monitoring_label}
            <span className="text-charcoal-ink/50">
              {" "}
              · {new Date(nextLab.due_date).toLocaleDateString()}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

function ConfirmRefillForm({
  medication,
  patientId,
}: {
  medication: MedicationWithCarePlan;
  patientId: string;
}) {
  const confirmRefill = useConfirmMedicationRefill();
  const [refillDate, setRefillDate] = useState(medication.refill_date ?? "");
  const [success, setSuccess] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(false);
    confirmRefill.mutate(
      { medicationId: medication.id, patientId, refillDate: refillDate || null },
      { onSuccess: () => setSuccess(true) }
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 pt-1">
      <div className="space-y-1">
        <Label htmlFor={`confirm_refill_date_${medication.id}`} className="text-xs">
          Refill date
        </Label>
        <Input
          id={`confirm_refill_date_${medication.id}`}
          type="date"
          value={refillDate}
          onChange={(event) => setRefillDate(event.target.value)}
          className="h-8 w-40 text-xs"
        />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={confirmRefill.isPending}>
        {confirmRefill.isPending ? "Confirming…" : "Confirm & continue"}
      </Button>
      {confirmRefill.isError && (
        <p className="text-xs text-red-600 basis-full">
          {(confirmRefill.error as Error).message || "Could not confirm this prescription."}
        </p>
      )}
      {success && !confirmRefill.isPending && (
        <p className="text-xs text-brand-green basis-full">Confirmed and continued.</p>
      )}
    </form>
  );
}

function StopMedicationForm({
  medication,
  patientId,
}: {
  medication: MedicationWithCarePlan;
  patientId: string;
}) {
  const stopMedication = useStopMedication();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-1 h-7 px-2 text-xs text-charcoal-ink/70"
        onClick={() => setOpen(true)}
      >
        Stop medication
      </Button>
    );
  }

  return (
    <div className="mt-1 flex flex-wrap items-end gap-2 rounded-md bg-charcoal-ink/5 p-2">
      <div className="min-w-48 flex-1 space-y-1">
        <Label htmlFor={`stop_reason_${medication.id}`} className="text-xs">
          Reason (optional) — e.g. switched, side effects
        </Label>
        <Input
          id={`stop_reason_${medication.id}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="h-8 text-xs"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={stopMedication.isPending}
        onClick={() =>
          stopMedication.mutate(
            { medicationId: medication.id, patientId, stoppedReason: reason.trim() || null },
            { onSuccess: () => setOpen(false) }
          )
        }
      >
        {stopMedication.isPending ? "Stopping…" : "Confirm stop"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {stopMedication.isError && (
        <p className="basis-full text-xs text-red-600">
          {(stopMedication.error as Error).message || "Could not stop this medication."}
        </p>
      )}
    </div>
  );
}

/** Collapsible medication history — stopped/switched drugs with when + why. */
function PastMedications({ patientId }: { patientId: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useStoppedMedications(patientId);

  if (!data || data.length === 0) return null;

  return (
    <div className="mt-3 border-t border-charcoal-ink/10 pt-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-charcoal-ink/70"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "Hide" : "Show"} past medications ({data.length})
      </Button>
      {open && (
        <ul className="mt-1 divide-y divide-charcoal-ink/10">
          {data.map((medication) => (
            <li key={medication.id} className="py-2">
              <p className="text-sm text-charcoal-ink/70 line-through decoration-charcoal-ink/30">
                {medication.drug_name}
                {medication.dose ? ` — ${medication.dose}` : ""}
              </p>
              <p className="text-xs text-charcoal-ink/50">
                Stopped
                {medication.stopped_at
                  ? ` ${new Date(medication.stopped_at).toLocaleDateString()}`
                  : ""}
                {medication.stopped_reason ? ` · ${medication.stopped_reason}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
