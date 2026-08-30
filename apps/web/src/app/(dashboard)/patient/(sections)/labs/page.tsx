import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { LabCatalogue } from "@/app/(dashboard)/patient/lab-catalogue";
import { LabOrdersList } from "@/app/(dashboard)/patient/lab-orders-list";
import { ResultsTrendsCard } from "@/app/(dashboard)/patient/results-trends-card";
import { LabResults } from "@/app/(dashboard)/patient/lab-results";
import { ResultDocuments } from "@/app/(dashboard)/patient/result-documents";
import { BookingRequestsList } from "@/app/(dashboard)/patient/booking-requests-list";

/**
 * Episodic-fee rebuild: lab_coordination/prevention_coordination retired.
 * Every diagnostic is pay-per-use now (Health Check catalog + partner
 * billing), so hiding "can I buy this" behind a separate subscription
 * paywall was a contradiction once nothing here is free to unlock — same
 * precedent this repo already applied to family_dashboard (removal 4,
 * 20260729143514). The catalogue and booking surfaces are unconditional for
 * every patient now.
 */
export default async function PatientLabsPage() {
  const { subjectId } = await getPatientDashboardContext();

  return (
    <DashboardSection
      id="labs"
      title="Labs & bookings"
      description="Request lab tests, and track your requests and results."
      icon={SEMANTIC_ICON.labs}
    >
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <LabResults patientId={subjectId} />
          <ResultDocuments patientId={subjectId} />
          <ResultsTrendsCard patientId={subjectId} />
        </div>
        <div className="space-y-4">
          <LabOrdersList patientId={subjectId} />
          <LabCatalogue />
          {/* No facility directory. Labs, pharmacies and specialists are all
              suspended (founder decision 2026-08-03): the platform takes no
              payment for a test and has inspected no laboratory, so it lists
              none. BookingRequestsList stays because vaccination bookings
              still create real requests a patient needs to see. */}
          <BookingRequestsList patientId={subjectId} />
        </div>
      </div>
    </DashboardSection>
  );
}
