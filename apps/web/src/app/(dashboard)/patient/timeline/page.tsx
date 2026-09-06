import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
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
      <PageHeader
        title="Activity timeline"
        icon={NAV_ICON.audit}
        description="Every lab result, medication change, screening, and care-team update on your record, grouped by month."
      />
      <TimelineClient patientId={subjectId} />
    </div>
  );
}
