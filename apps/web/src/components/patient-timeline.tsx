"use client";

import { usePatientTimeline, type TimelineEvent, type TimelineEventType } from "@/lib/queries/patient-timeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";

/**
 * The shared unified activity timeline. Rendered on both the patient dashboard
 * and the clinician patient-detail view (same component, same query) — RLS
 * decides what each caller sees. Reads the append-only public.patient_timeline
 * feed; it never writes and never re-derives — every row was written by a
 * source-table trigger.
 */

// Each event type gets a small status dot. This is the clinical status-colour
// system (attention/action/positive/neutral), deliberately separate from the
// brand palette per docs/BRAND_GUIDE.md §5.
const EVENT_STYLE: Record<TimelineEventType, { dot: string; label: string }> = {
  lab_abnormal: { dot: "bg-red-600", label: "Abnormal result" },
  medication_missed: { dot: "bg-red-600", label: "Missed doses" },
  escalation_raised: { dot: "bg-red-600", label: "Escalation" },
  screening_due: { dot: "bg-amber-500", label: "Screening" },
  referral_status_changed: { dot: "bg-amber-500", label: "Referral" },
  lab_completed: { dot: "bg-green-600", label: "Lab result" },
  screening_completed: { dot: "bg-green-600", label: "Screening" },
  escalation_resolved: { dot: "bg-green-600", label: "Escalation" },
  vaccination_recorded: { dot: "bg-green-600", label: "Vaccination" },
  discharge_recorded: { dot: "bg-green-600", label: "Discharge" },
  medication_started: { dot: "bg-clinical-navy", label: "Medication" },
  medication_stopped: { dot: "bg-clinical-navy", label: "Medication" },
  referral_created: { dot: "bg-clinical-navy", label: "Referral" },
  care_plan_updated: { dot: "bg-clinical-navy", label: "Care plan" },
  admission_recorded: { dot: "bg-clinical-navy", label: "Admission" },
  message_posted: { dot: "bg-clinical-navy", label: "Message" },
  medication_dispensed: { dot: "bg-clinical-navy", label: "Medication" },
  encounter_documented: { dot: "bg-clinical-navy", label: "Clinical note" },
};

// Belt-and-braces only — private.record_timeline_event() now strips
// underscores from summary at write time (2026-07-30 v3 port, proof_log gap
// closure), so every current and future writer gets this for free at the DB
// layer, not just this one component. Kept here as a second pass in case a
// row was written before that guarantee existed, or by some future path
// that bypasses the shared writer.
function humaniseSummary(summary: string): string {
  return summary.replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g, (token) => token.replace(/_/g, " "));
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Null-gated attribution: only ever rendered from event.actor, which is a
// real clinical_staff row (FK-guaranteed) — but a real row is not the same as
// a real doctor. isClinicalTier excludes a Care Coordinator's active row
// (doctor_tier = 'care_coordinator'), so an event they caused (e.g. raising
// an escalation, sending a care message) reads "By your care team" rather
// than a fabricated "Dr. <coordinator's name>".
function ActorAttribution({ actor }: { actor: TimelineEvent["actor"] }) {
  if (!actor?.full_name) return null;
  if (!isClinicalTier(actor)) {
    return <p className="text-xs text-charcoal-ink/60">By your care team</p>;
  }
  const credential =
    actor.credential_type && actor.credential_number
      ? ` · ${actor.credential_type} ${actor.credential_number}`
      : "";
  return (
    <p className="text-xs text-charcoal-ink/60">
      By <span className="font-medium">Dr. {actor.full_name}</span>
      {credential}
    </p>
  );
}

export function PatientTimeline({ patientId, limit }: { patientId: string; limit?: number }) {
  const { data, isLoading, isError } = usePatientTimeline(patientId, limit);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity timeline</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading activity…</p>}
        {isError && (
          <p className="text-sm text-charcoal-ink/60">
            We couldn&apos;t load the timeline just now. Please try again shortly.
          </p>
        )}
        {!isLoading && !isError && (!data || data.length === 0) && (
          <p className="text-sm text-charcoal-ink/60">
            No activity yet. Lab results, medications, screenings and more will appear here as they
            happen.
          </p>
        )}
        {data && data.length > 0 && (
          <ol className="relative space-y-5 border-l border-charcoal-ink/10 pl-5">
            {data.map((event) => {
              const style = EVENT_STYLE[event.event_type];
              return (
                <li key={event.id} className="relative">
                  <span
                    className={`absolute -left-[1.4375rem] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${style.dot}`}
                    aria-hidden
                  />
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-charcoal-ink/40">
                        {style.label}
                      </p>
                      <p className="text-sm font-medium text-charcoal-ink">{event.title}</p>
                    </div>
                    <p className="shrink-0 text-xs text-charcoal-ink/50">
                      {formatWhen(event.occurred_at)}
                    </p>
                  </div>
                  {event.summary && (
                    <p className="text-sm text-charcoal-ink/70">{humaniseSummary(event.summary)}</p>
                  )}
                  <ActorAttribution actor={event.actor} />
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
