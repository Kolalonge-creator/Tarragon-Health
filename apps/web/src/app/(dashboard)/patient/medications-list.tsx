"use client";

import { useState, type FormEvent } from "react";
import {
  useConfirmMedicationRefill,
  useMedicationCollections,
  useMedications,
  useStoppedMedications,
  useStopMedication,
  type MedicationCollection,
  type MedicationWithCarePlan,
} from "@/lib/queries/medications";
import {
  useMedicationRepeatRequests,
  useRequestMedicationRepeat,
  type MedicationRepeatRequest,
} from "@/lib/queries/medication-repeat-requests";
import { MedicationCollectionForm } from "./medication-collection-form";
import { AmendMedicationForm } from "@/app/(dashboard)/clinician/patients/[patientId]/amend-medication-form";
import { MedicationIssueReportForm } from "./medication-issue-report-form";
import { SymptomLogForm } from "./symptom-log-form";
import { MedicationAccessBarrierForm } from "./medication-access-barrier-form";
import { computeRefillGapSignal, REFILL_GAP_DISCLAIMER } from "@/lib/rules/adherence-signals";
import { usePatientNextReview } from "@/lib/queries/medication-reviews";
import { usePatientLabMonitoring } from "@/lib/queries/lab-monitoring";
import {
  useMedicationRenewalRequest,
  useRequestPrescriptionRenewal,
} from "@/lib/queries/prescription-renewal";
import { useHasAvailableServicePurchase } from "@/lib/queries/service-purchases";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";
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
  canAmend = false,
  isClinicianView = false,
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
  /** Renders the "Amend" control on the status trail (clinician view only —
   * spec §62.14). private.has_prescribing_authority is the real gate; this
   * only decides whether the control renders. Never true for the patient's
   * own view — only clinical staff may amend a signed prescription. */
  canAmend?: boolean;
  /**
   * A clinician/staff member viewing a patient's chart, not the patient's
   * own dashboard — this component is shared between both (see clinician/
   * patients/[patientId]/page.tsx). Swaps MedicationCollectionForm's
   * first-person "I picked this up" self-report control (unmistakably
   * patient-voiced copy: "This confirms YOUR prescription") for a read-only
   * prescription status trail — that control had been rendering unchanged
   * in the clinician view with no way to tell who was actually meant to
   * click it.
   */
  isClinicianView?: boolean;
}) {
  const { data, isLoading, isError } = useMedications(patientId);
  // Needed both for the clinician-view status trail and for the 64.6
  // refill-gap signal shown on both views — unlike repeatRequests below, this
  // one is never disabled by view.
  const { data: collections } = useMedicationCollections(patientId);
  // Only needed for the patient's own "request next supply" control — empty
  // patientId keeps the query disabled (see `enabled: !!patientId`) on the
  // clinician view.
  const { data: repeatRequests } = useMedicationRepeatRequests(!isClinicianView ? patientId : "");

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
                    {[medication.dose, medication.frequency].filter(Boolean).join(", ") ||
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
                      Refill coordination is part of a paid plan;{" "}
                      <a href="/patient/subscription" className="underline">
                        see plans
                      </a>
                      .
                    </p>
                  )}
                  {medication.last_confirmed_at && (
                    <p className="text-xs text-charcoal-ink/60">
                      Refill checked and still valid ·{" "}
                      {new Date(medication.last_confirmed_at).toLocaleDateString()}
                      <span className="text-charcoal-ink/40">
                        {" "}
                        (an administrative check, not a new dose review)
                      </span>
                    </p>
                  )}
                  <RefillGapNote medication={medication} collections={collections ?? []} />
                  {canConfirmRefill && medication.source === "clinician" && (
                    <ConfirmRefillForm medication={medication} patientId={patientId} />
                  )}
                  {isClinicianView ? (
                    medication.source === "clinician" && (
                      <PrescriptionStatusTrail
                        medication={medication}
                        collections={collections ?? []}
                        patientId={patientId}
                        canAmend={canAmend}
                      />
                    )
                  ) : (
                    // Buy anywhere, tell us afterwards. Ungated: knowing
                    // whether a patient actually has their medicine is a
                    // safety signal, not a paid feature.
                    <>
                      <MedicationCollectionForm medication={medication} patientId={patientId} />
                      <MedicationIssueReportForm medication={medication} patientId={patientId} />
                      <RequestRenewalButton
                        medication={medication}
                        patientId={patientId}
                        organisationId={medication.organisation_id}
                      />
                    </>
                  )}
                  {!isClinicianView &&
                    medication.source === "clinician" &&
                    medication.repeats_allowed > 0 && (
                      <RepeatRequestControl
                        medication={medication}
                        patientId={patientId}
                        requests={repeatRequests ?? []}
                      />
                    )}
                  {canStop && (
                    <StopMedicationForm medication={medication} patientId={patientId} />
                  )}
                  {!isClinicianView && (
                    <ReportSideEffectButton
                      patientId={patientId}
                      medicationId={medication.id}
                      drugName={medication.drug_name}
                    />
                  )}
                  {!isClinicianView && (
                    <AccessBarrierButton medicationId={medication.id} drugName={medication.drug_name} />
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

/**
 * Medication safety pathway 64.6 — a non-diagnostic "potential gap" signal
 * from the medication's own day-supply (duration_days) vs. the actual
 * interval between its two most recent collections. Silent (renders
 * nothing) when there's no day-supply on file or no gap worth surfacing —
 * see computeRefillGapSignal for the exact rule and its 5-day noise floor.
 */
function RefillGapNote({
  medication,
  collections,
}: {
  medication: MedicationWithCarePlan;
  collections: MedicationCollection[];
}) {
  const dispenseDates = collections
    .filter((c) => c.medication_id === medication.id)
    .map((c) => c.dispensed_on);
  const signal = computeRefillGapSignal(medication.id, medication.duration_days, dispenseDates);
  if (!signal) return null;

  return (
    <p className="text-xs text-amber-700">
      Adherence signal: potential {signal.gapDays}-day gap ({signal.expectedIntervalDays}-day
      supply, {signal.actualIntervalDays} days between the last two pickups).{" "}
      <span className="text-charcoal-ink/50">{REFILL_GAP_DISCLAIMER}</span>
    </p>
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

/**
 * Care Team / Provider Workspace §5.11 "prescription status", adapted to
 * Tarragon's actual fulfilment model — there is deliberately no "sent to
 * pharmacy" step. Tarragon dropped pharmacy routing entirely 2026-08-03
 * (20260803132008_medication_collected_anywhere.sql — "keep the record,
 * drop the routing"), so claiming one would misrepresent a path that no
 * longer exists. Composed entirely from data that already exists elsewhere
 * in this schema — see 20260827200208_prescription_workspace_fields.sql:
 *   Signed          -> created_at / added_by (medications_insert already
 *                       requires prescribing authority, so the row IS the
 *                       signed order; added_by is server-stamped, never
 *                       client-supplied — see stamp_medication_added_by)
 *   Patient notified -> automatic at insert (medications_enqueue_prescribed_
 *                       notifications); no per-row delivery status is
 *                       tracked, so this only claims the notification was
 *                       raised, not that it was read
 *   Collected        -> pharmacy_order_dispenses.medication_id, self- or
 *                       staff-logged
 * Clinician-sourced only (medication.source === "clinician") — a specialist-
 * sourced row's added_by is the patient's own id (they logged it, not
 * Tarragon), so "Signed by" would misattribute; that source already shows
 * its own "Started by {prescriber_name}" line elsewhere in this list.
 */
function PrescriptionStatusTrail({
  medication,
  collections,
  patientId,
  canAmend,
}: {
  medication: MedicationWithCarePlan;
  collections: MedicationCollection[];
  patientId: string;
  canAmend: boolean;
}) {
  const [amending, setAmending] = useState(false);
  const latestCollection = collections
    .filter((c) => c.medication_id === medication.id)
    .sort((a, b) => (a.dispensed_on < b.dispensed_on ? 1 : -1))[0];

  const signedBy = medication.added_by_profile?.full_name
    ? `Dr. ${medication.added_by_profile.full_name}`
    : "Tarragon care team";

  const steps: { label: string; done: boolean; detail: string }[] = [
    {
      label: "Signed",
      done: true,
      detail: `${signedBy} · ${new Date(medication.created_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })}${medication.rx_number ? ` · ${medication.rx_number}` : ""}${
        medication.version > 1 ? ` · v${medication.version}` : ""
      }`,
    },
    {
      label: "Patient notified",
      done: true,
      detail: "Email/WhatsApp sent at time of prescribing",
    },
    {
      label: "Collected",
      done: !!latestCollection,
      detail: latestCollection
        ? [
            new Date(latestCollection.dispensed_on).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            }),
            latestCollection.pharmacy_name,
          ]
            .filter(Boolean)
            .join(" · ")
        : "Not yet recorded",
    },
  ];

  const expiresAt = medication.expires_at ? new Date(medication.expires_at) : null;
  const isExpired = !!expiresAt && expiresAt.getTime() < new Date().getTime();

  return (
    <>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {expiresAt && (
          <span className={isExpired ? "text-red-700" : "text-charcoal-ink/50"}>
            {isExpired ? "Expired" : "Valid until"}{" "}
            {expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </span>
        )}
        {steps.map((step) => (
          <span key={step.label} className="inline-flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                step.done ? "bg-brand-green" : "bg-charcoal-ink/20"
              }`}
              aria-hidden="true"
            />
            <span className={step.done ? "text-charcoal-ink/70" : "text-charcoal-ink/40"}>
              {step.label} · {step.detail}
            </span>
          </span>
        ))}
        {canAmend && !amending && (
          <button
            type="button"
            onClick={() => setAmending(true)}
            className="text-charcoal-ink/50 underline hover:text-charcoal-ink"
          >
            Amend
          </button>
        )}
      </div>
      {canAmend && amending && (
        <AmendMedicationForm
          medication={medication}
          patientId={patientId}
          onDone={() => setAmending(false)}
        />
      )}
    </>
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
      <p className="basis-full text-xs text-charcoal-ink/50">
        This confirms your prescription is still valid for pickup. It is an
        administrative check, not a new medical review of your dose.
      </p>
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
        {confirmRefill.isPending ? "Confirming…" : "Confirm refill is still needed"}
      </Button>
      {confirmRefill.isError && (
        <p className="text-xs text-red-600 basis-full">
          {(confirmRefill.error as Error).message || "Could not confirm this prescription."}
        </p>
      )}
      {success && !confirmRefill.isPending && (
        <p className="text-xs text-brand-green basis-full">
          Refill confirmed as still valid.
        </p>
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
          Reason (optional): e.g. switched, side effects
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

/**
 * "I need my next supply" (spec §62.11) — shown only for a clinician-issued
 * prescription with repeats remaining. Every request needs clinical review
 * (20260829011000_medication_repeat_requests.sql — no auto-approve path), so
 * this only ever offers "Request" or shows the latest request's outcome, it
 * never claims a repeat is ready before a clinician has said so.
 */
function RepeatRequestControl({
  medication,
  patientId,
  requests,
}: {
  medication: MedicationWithCarePlan;
  patientId: string;
  requests: MedicationRepeatRequest[];
}) {
  const requestRepeat = useRequestMedicationRepeat();
  const latest = requests
    .filter((r) => r.medication_id === medication.id)
    .sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1))[0];

  if (latest?.status === "pending") {
    return (
      <p className="mt-1 text-xs text-charcoal-ink/60">
        Next supply requested {new Date(latest.requested_at).toLocaleDateString()} · awaiting review
      </p>
    );
  }

  return (
    <div className="mt-1 space-y-1">
      {latest?.status === "approved" && (
        <p className="text-xs text-brand-green">
          Approved {new Date(latest.reviewed_at ?? latest.requested_at).toLocaleDateString()} — you can
          collect your next supply.
        </p>
      )}
      {latest?.status === "denied" && (
        <p className="text-xs text-red-700">
          Request declined{latest.denial_reason ? `: ${latest.denial_reason}` : ""}
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-charcoal-ink/70"
        disabled={requestRepeat.isPending}
        onClick={() => requestRepeat.mutate({ medicationId: medication.id, patientId })}
      >
        {requestRepeat.isPending ? "Requesting…" : "Request next supply"}
      </Button>
      {requestRepeat.isError && (
        <p className="text-xs text-red-600">
          {(requestRepeat.error as Error).message || "Could not request a repeat."}
        </p>
      )}
    </div>
  );
}

const RENEWAL_CREDIT_CODE = "prescription_renewal_credit";

/**
 * Pay-per-service item: request a doctor's review to renew this
 * prescription. Server-side, prescription_renewal_requests_enforce_credit
 * accepts either plan access (medication_refills) or a redeemed
 * prescription_renewal_credit — this button doesn't pre-check plan access
 * itself (has_available_service_purchase only tells us about a credit), so
 * a plan-covered patient's request just succeeds on submit without ever
 * needing to buy anything.
 */
function RequestRenewalButton({
  medication,
  patientId,
  organisationId,
}: {
  medication: MedicationWithCarePlan;
  patientId: string;
  organisationId: string;
}) {
  const { data: openRequest } = useMedicationRenewalRequest(medication.id);
  const { data: hasCredit } = useHasAvailableServicePurchase(patientId, RENEWAL_CREDIT_CODE);
  const requestRenewal = useRequestPrescriptionRenewal();
  const [isBuying, setIsBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (openRequest && (openRequest.status === "submitted" || openRequest.status === "in_review")) {
    return (
      <p className="mt-1 text-xs text-charcoal-ink/60">
        Renewal requested · a doctor will respond by{" "}
        {new Date(openRequest.sla_due_at).toLocaleDateString()}
      </p>
    );
  }
  if (openRequest?.status === "approved") {
    return <p className="mt-1 text-xs text-brand-green">Renewal approved by your care team.</p>;
  }

  async function onRequest() {
    setError(null);
    requestRenewal.mutate(
      { patientId, organisationId, medicationId: medication.id },
      {
        onError: async (err) => {
          const message = (err as Error).message ?? "";
          if (!message.includes("renewal credit")) {
            setError(message || "Could not send this request.");
            return;
          }
          // No plan access and no credit — start checkout, then retry on return.
          setIsBuying(true);
          const result = await purchaseServiceProduct({
            serviceProductCode: RENEWAL_CREDIT_CODE,
            callbackPath: "/patient",
          });
          setIsBuying(false);
          if (result?.error) setError(result.error);
          else if (result?.checkoutUrl) window.location.href = result.checkoutUrl;
        },
      }
    );
  }

  return (
    <div className="mt-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-charcoal-ink/70"
        disabled={requestRenewal.isPending || isBuying}
        onClick={onRequest}
      >
        {requestRenewal.isPending || isBuying
          ? "Requesting…"
          : hasCredit
            ? "Request renewal (credit ready)"
            : "Request renewal"}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Medication safety pathway 64.9 — "I'm experiencing a side effect": a
 * collapsible entry point per medication into SymptomLogForm, scoped to this
 * drug via medicationId. Severity-based triage (urgent vs. clinical review
 * vs. nothing) is entirely SymptomLogForm/logSymptom's existing behaviour;
 * this only supplies which medication the report is about.
 */
function ReportSideEffectButton({
  patientId,
  medicationId,
  drugName,
}: {
  patientId: string;
  medicationId: string;
  drugName: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-1 h-7 px-2 text-xs text-charcoal-ink/70"
        onClick={() => setOpen(true)}
      >
        I&apos;m experiencing a side effect
      </Button>
    );
  }

  return (
    <div className="mt-1">
      <SymptomLogForm patientId={patientId} medicationId={medicationId} drugName={drugName} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-1 h-7 px-2 text-xs"
        onClick={() => setOpen(false)}
      >
        Close
      </Button>
    </div>
  );
}

/**
 * Medication safety pathway 64.20/64.21 — "I cannot afford/get this
 * medicine". Same collapsible pattern as ReportSideEffectButton; the actual
 * pathway (never an automatic substitution) is entirely
 * MedicationAccessBarrierForm/reportMedicationAccessBarrier's behaviour.
 */
function AccessBarrierButton({ medicationId, drugName }: { medicationId: string; drugName: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-1 h-7 px-2 text-xs text-charcoal-ink/70"
        onClick={() => setOpen(true)}
      >
        I can&apos;t get or afford this medicine
      </Button>
    );
  }

  return (
    <div className="mt-1">
      <MedicationAccessBarrierForm medicationId={medicationId} drugName={drugName} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-1 h-7 px-2 text-xs"
        onClick={() => setOpen(false)}
      >
        Close
      </Button>
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
                {medication.dose ? `, ${medication.dose}` : ""}
              </p>
              <p className="text-xs text-charcoal-ink/50">
                {/* An amended prescription (spec §62.14) is superseded, not
                    stopped — it must never read as "discontinued"/"cancelled",
                    which would misrepresent a still-active course of
                    treatment that only changed dose/instructions/etc. (the
                    same "never falsely imply not supplied" spirit as §62.13).
                    amendment_reason lives on the NEW version's row (visible
                    in the active list above), not this superseded one, so
                    it isn't repeated here. */}
                {medication.superseded_at ? (
                  <>
                    Replaced by an updated prescription
                    {` ${new Date(medication.superseded_at).toLocaleDateString()}`}
                  </>
                ) : (
                  <>
                    Stopped
                    {medication.stopped_at
                      ? ` ${new Date(medication.stopped_at).toLocaleDateString()}`
                      : ""}
                    {medication.stopped_reason ? ` · ${medication.stopped_reason}` : ""}
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
