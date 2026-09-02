"use client";

import Link from "next/link";
import { usePatientTimeline, type TimelineEvent, type TimelineEventType } from "@/lib/queries/patient-timeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  medication_received: { dot: "bg-clinical-navy", label: "Medication" },
  encounter_documented: { dot: "bg-clinical-navy", label: "Clinical note" },
  condition_recorded: { dot: "bg-clinical-navy", label: "Condition" },
  condition_status_changed: { dot: "bg-amber-500", label: "Condition" },
  referral_outcome_recorded: { dot: "bg-clinical-navy", label: "Referral" },
  document_uploaded: { dot: "bg-clinical-navy", label: "Document" },
  imaging_report_uploaded: { dot: "bg-clinical-navy", label: "Imaging" },
  record_conflict_flagged: { dot: "bg-amber-500", label: "Record conflict" },
  record_conflict_resolved: { dot: "bg-green-600", label: "Record conflict" },
  clinical_summary_validated: { dot: "bg-green-600", label: "Clinical summary" },
  dependent_account_transitioned: { dot: "bg-clinical-navy", label: "Account access" },
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

// The single per-event row, shared by both flat and grouped-by-month
// rendering below so the two modes can never visually drift apart.
function TimelineEventRow({ event }: { event: TimelineEvent }) {
  const style = EVENT_STYLE[event.event_type];
  return (
    <li className="relative">
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
        <p className="shrink-0 text-xs text-charcoal-ink/50">{formatWhen(event.occurred_at)}</p>
      </div>
      {event.summary && <p className="text-sm text-charcoal-ink/70">{humaniseSummary(event.summary)}</p>}
      <ActorAttribution actor={event.actor} />
    </li>
  );
}

type TimelineMonthGroup = { key: string; label: string; events: TimelineEvent[] };

// `data` always arrives newest-first (occurred_at desc), so grouping in
// first-seen order naturally yields newest-month-first groups without a
// separate sort pass.
function groupEventsByMonth(events: TimelineEvent[]): TimelineMonthGroup[] {
  const groups: TimelineMonthGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const event of events) {
    const occurred = new Date(event.occurred_at);
    const key = `${occurred.getFullYear()}-${occurred.getMonth()}`;
    let idx = indexByKey.get(key);
    if (idx === undefined) {
      const label = new Date(occurred.getFullYear(), occurred.getMonth(), 1).toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
      });
      idx = groups.length;
      indexByKey.set(key, idx);
      groups.push({ key, label, events: [] });
    }
    groups[idx].events.push(event);
  }
  return groups;
}

export function PatientTimeline({
  patientId,
  limit,
  groupByMonth = false,
  viewAllHref,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
}: {
  patientId: string;
  limit?: number;
  /** Group events under a month/year heading (newest month first) instead of
   * one flat list — the full-history page's presentation. Default `false`
   * keeps every existing usage (the Overview preview, both clinician views)
   * pixel-identical to before this prop existed. */
  groupByMonth?: boolean;
  /** Shows a "View full timeline" link in the card header, pointing at the
   * full-history page. Omit to keep the header exactly as it was. */
  viewAllHref?: string;
  /** Renders a "Load more" button below the list when provided — the
   * full-history page's pagination control. Omit to render no button at all. */
  onLoadMore?: () => void;
  /** Whether another page is known to exist; disables/hides "Load more"
   * once the feed is exhausted. Ignored when `onLoadMore` is omitted. */
  hasMore?: boolean;
  /** Drives the "Load more" button's disabled/loading state while the next
   * page is in flight. Ignored when `onLoadMore` is omitted. */
  isLoadingMore?: boolean;
}) {
  const { data, isLoading, isError } = usePatientTimeline(patientId, limit);
  const monthGroups = groupByMonth && data ? groupEventsByMonth(data) : null;

  return (
    <Card>
      <CardHeader
        className={viewAllHref ? "flex flex-row items-center justify-between gap-2 space-y-0" : undefined}
      >
        <CardTitle>Activity timeline</CardTitle>
        {viewAllHref && (
          <Link href={viewAllHref} className="text-sm font-medium text-brand-green hover:underline">
            View full timeline
          </Link>
        )}
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
          <>
            {monthGroups ? (
              <div className="space-y-6">
                {monthGroups.map((group) => (
                  <div key={group.key}>
                    <h3 className="mb-3 text-sm font-semibold text-charcoal-ink">{group.label}</h3>
                    <ol className="relative space-y-5 border-l border-charcoal-ink/10 pl-5">
                      {group.events.map((event) => (
                        <TimelineEventRow key={event.id} event={event} />
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            ) : (
              <ol className="relative space-y-5 border-l border-charcoal-ink/10 pl-5">
                {data.map((event) => (
                  <TimelineEventRow key={event.id} event={event} />
                ))}
              </ol>
            )}
            {onLoadMore && (
              <div className="mt-6 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onLoadMore}
                  disabled={isLoadingMore || !hasMore}
                >
                  {isLoadingMore ? "Loading…" : hasMore ? "Load more" : "That's everything"}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
