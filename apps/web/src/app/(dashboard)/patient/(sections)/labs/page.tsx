import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { LabCatalogue } from "@/app/(dashboard)/patient/lab-catalogue";
import { LabOrdersList } from "@/app/(dashboard)/patient/lab-orders-list";
import { ResultsTrendsCard } from "@/app/(dashboard)/patient/results-trends-card";
import { LabResults } from "@/app/(dashboard)/patient/lab-results";
import { ResultDocuments } from "@/app/(dashboard)/patient/result-documents";
import { BookingRequestsList } from "@/app/(dashboard)/patient/booking-requests-list";

export default async function PatientLabsPage() {
  const { subjectId } = await getPatientDashboardContext();

  return (
    <DashboardSection
      id="labs"
      title="Labs & bookings"
      description="Request lab tests, and track your requests and results."
      icon={SEMANTIC_ICON.labs}
    >
      {/* Lab-request coordination and the screening calendar are free to every
          patient since the pay-per-service rework: writing a request and
          tracking a result costs no clinician time, and a result a patient is
          holding must always reach a doctor whatever they pay. What stays paid
          is the doctor's own review of that result (result_document_review),
          gated where the review is offered rather than on this whole section. */}
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
