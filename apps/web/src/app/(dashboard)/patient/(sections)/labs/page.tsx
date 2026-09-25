import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { LabCatalogue } from "@/app/(dashboard)/patient/lab-catalogue";
import { LabOrdersList } from "@/app/(dashboard)/patient/lab-orders-list";
import { LabLocationDirectory } from "@/app/(dashboard)/patient/lab-location-directory";
import { ResultsTrendsCard } from "@/app/(dashboard)/patient/results-trends-card";
import { LabResults } from "@/app/(dashboard)/patient/lab-results";
import { ResultDocuments } from "@/app/(dashboard)/patient/result-documents";
import { EcgReportDocuments } from "@/app/(dashboard)/patient/ecg-report-documents";
import { ImagingReportDocuments } from "@/app/(dashboard)/patient/imaging-report-documents";
import { BookingRequestsList } from "@/app/(dashboard)/patient/booking-requests-list";

export default async function PatientLabsPage() {
  const { subjectId } = await getPatientDashboardContext();

  return (
    <DashboardSection
      id="labs"
      title="Labs & bookings"
      description="Request lab tests, and upload and track your lab, ECG, and imaging results."
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
          <EcgReportDocuments patientId={subjectId} />
          <ImagingReportDocuments patientId={subjectId} />
          <ResultsTrendsCard patientId={subjectId} />
        </div>
        <div className="space-y-4">
          <LabOrdersList patientId={subjectId} />
          <LabCatalogue />
          {/* Synlab Nigeria was contracted 2026-08-21 and this branch
              directory shipped 2026-08-29 (list_lab_test_locations) — the
              older "no facility directory" line here predated both and is
              stale. Pharmacies/specialists remain unaffected by this. */}
          <LabLocationDirectory />
          {/* BookingRequestsList stays because vaccination bookings still
              create real requests a patient needs to see. */}
          <BookingRequestsList patientId={subjectId} />
        </div>
      </div>
    </DashboardSection>
  );
}
