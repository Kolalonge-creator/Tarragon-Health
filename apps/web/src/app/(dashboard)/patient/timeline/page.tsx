import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { TimelineClient } from "./timeline-client";

/**
 * The full, browsable activity history behind the Overview page's 6-item
 * preview (spec §76.4 "health timeline") — every lab result, medication
 * change, screening, referral, and care-team update on the patient's record,
 * grouped by month/year, loaded a page at a time. Deliberately has no
 * top-level nav entry (see CLAUDE.md's navigation.ts guardrail) — reached via
 * the "View full timeline" link on Overview's PatientTimeline card and,
 * separately, from the Health Summary page.
 */
export default async function PatientTimelinePage() {
  const { subjectId } = await getPatientDashboardContext();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Activity timeline</h1>
        <p className="text-sm text-charcoal-ink/60">
          Every lab result, medication change, screening, and care-team update on your record, grouped
          by month.
        </p>
      </div>
      <TimelineClient patientId={subjectId} />
    </div>
  );
}
