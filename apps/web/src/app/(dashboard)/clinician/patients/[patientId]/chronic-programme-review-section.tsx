"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  useChronicEnrolments,
  useActiveChronicProgrammes,
  useProgrammeScheduleOccurrences,
  useProgrammeEndReview,
  useProgrammeCheckinAppointments,
  useMedicationDoseHistory,
  type ChronicEnrolment,
} from "@/lib/queries/chronic-programmes";
import { completeChronicProgrammeReview } from "./chronic-programme-review-actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One enrolment's 12-week review: schedule summary, the 3 doctor-checkin
 * calls with real per-call attribution (doctor-supported only), titration
 * history in the window, and the sign-off form. Composes existing display
 * building blocks (VitalsTrendChart) rather than a new trend engine — per
 * CLAUDE.md's "never rebuild the Annual Health Review as a parallel record"
 * rule, this whole section is orchestration, not computation. */
function EnrolmentReview({
  patientId,
  enrolment,
  programmeName,
}: {
  patientId: string;
  enrolment: ChronicEnrolment;
  programmeName: string;
}) {
  const { data: occurrences } = useProgrammeScheduleOccurrences(enrolment.id);
  const { data: review } = useProgrammeEndReview(enrolment.id);
  const checkinOccurrences = (occurrences ?? []).filter((o) => o.occurrence_type === "doctor_checkin");
  const appointmentIds = checkinOccurrences.map((o) => o.appointment_id).filter((id): id is string => !!id);
  const { data: appointments } = useProgrammeCheckinAppointments(appointmentIds);
  const { data: doseHistory } = useMedicationDoseHistory(
    patientId,
    enrolment.programme_started_at && enrolment.programme_ends_at
      ? { from: enrolment.programme_started_at, to: enrolment.programme_ends_at }
      : undefined
  );

  // review always exists by the time this renders anything meaningful (the
  // end-review shell is created alongside the rest of the 12-week schedule
  // at enrolment time — see private.create_chronic_programme_end_review) —
  // bound unconditionally (hooks can't be called conditionally) with a
  // placeholder id while it's still loading; the form itself only renders
  // once `review` is truthy, so the placeholder is never actually submitted.
  const action = completeChronicProgrammeReview.bind(null, review?.id ?? "");
  const [state, formAction, pending] = useActionState(action, undefined);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  const labOccurrences = (occurrences ?? []).filter((o) => o.occurrence_type === "lab_panel");

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{programmeName} — 12-week programme</CardTitle>
          <Badge variant={enrolment.track === "doctor_supported" ? "green" : "grey"}>
            {enrolment.track === "doctor_supported" ? "Doctor-supported" : "Self-monitoring"}
          </Badge>
        </div>
        <CardDescription>
          {formatDate(enrolment.programme_started_at)} – {formatDate(enrolment.programme_ends_at)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <VitalsTrendChart patientId={patientId} />

        <div>
          <p className="text-xs font-medium text-charcoal-ink/70">Lab panels</p>
          <ul className="mt-1 space-y-1">
            {labOccurrences.map((o) => (
              <li key={o.id} className="text-xs text-charcoal-ink/70">
                Week {o.week_number}: {o.status}
                {o.lab_order_id ? " · order on file" : ""}
              </li>
            ))}
          </ul>
        </div>

        {enrolment.track === "doctor_supported" && (
          <div>
            <p className="text-xs font-medium text-charcoal-ink/70">Doctor check-in calls</p>
            <ul className="mt-1 space-y-1">
              {checkinOccurrences.map((o) => {
                const appt = appointments?.find((a) => a.id === o.appointment_id);
                return (
                  <li key={o.id} className="text-xs text-charcoal-ink/70">
                    Week {o.week_number}:{" "}
                    {appt
                      ? `${appt.status} with ${appt.clinician?.full_name ?? "a doctor"} (${formatDate(appt.scheduled_for)})`
                      : "not yet booked"}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {doseHistory && doseHistory.length > 0 && (
          <div>
            <p className="text-xs font-medium text-charcoal-ink/70">Medication changes this programme</p>
            <ul className="mt-1 space-y-1">
              {doseHistory.map((row) => (
                <li key={row.id} className="text-xs text-charcoal-ink/70">
                  {row.medication?.drug_name ?? "Medication"} — {formatDate(row.created_at)}
                  {row.changed_reason ? `: ${row.changed_reason}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-charcoal-ink/10 pt-3">
          {review?.reviewed_at && (
            <p className="mb-2 text-charcoal-ink/70">
              Reviewed {formatDate(review.reviewed_at)}
              {review.summary ? `: ${review.summary}` : ""}
            </p>
          )}
          {review && (
            <form action={formAction} className="space-y-2">
              <Textarea
                name="summary"
                required
                rows={3}
                defaultValue={review?.summary ?? ""}
                placeholder="Summary of the 12-week trend and what happens next."
              />
              <Button type="submit" disabled={pending} variant={review?.reviewed_at ? "outline" : "default"}>
                {pending ? "Saving…" : review?.reviewed_at ? "Update review" : "Complete 12-week review"}
              </Button>
            </form>
          )}
          {state?.error && <p className="mt-2 text-red-600">{state.error}</p>}
          {state?.success && <p className="mt-2 text-brand-green">Review saved.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function ChronicProgrammeReviewSection({ patientId }: { patientId: string }) {
  const { data: enrolments, isLoading } = useChronicEnrolments(patientId);
  const { data: programmes } = useActiveChronicProgrammes();

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (!enrolments || enrolments.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">This patient has no active chronic-programme enrolment.</p>;
  }

  const programmeName = (programmeId: string) =>
    programmes?.find((p) => p.id === programmeId)?.name ?? "Chronic condition";

  return (
    <>
      {enrolments.map((enrolment) => (
        <EnrolmentReview
          key={enrolment.id}
          patientId={patientId}
          enrolment={enrolment}
          programmeName={programmeName(enrolment.programme_id)}
        />
      ))}
    </>
  );
}
