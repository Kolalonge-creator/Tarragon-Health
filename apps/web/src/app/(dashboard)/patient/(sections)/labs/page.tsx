import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { PreventionTabs, type PreventionTab } from "@/app/(dashboard)/patient/prevention-tabs";
import { AnnualBundleCard } from "@/app/(dashboard)/patient/annual-bundle-card";
import { LabCatalogue } from "@/app/(dashboard)/patient/lab-catalogue";
import { LabOrdersList } from "@/app/(dashboard)/patient/lab-orders-list";
import { LabLocationDirectory } from "@/app/(dashboard)/patient/lab-location-directory";
import { ResultsTrendsCard } from "@/app/(dashboard)/patient/results-trends-card";
import { ReleasedLabResults } from "@/app/(dashboard)/patient/released-lab-results";
import { LabTrendCard } from "@/app/(dashboard)/patient/lab-trend-card";
import { LabResults } from "@/app/(dashboard)/patient/lab-results";
import { ResultDocuments } from "@/app/(dashboard)/patient/result-documents";
import { EcgReportDocuments } from "@/app/(dashboard)/patient/ecg-report-documents";
import { ImagingReportDocuments } from "@/app/(dashboard)/patient/imaging-report-documents";
import { BookingRequestsList } from "@/app/(dashboard)/patient/booking-requests-list";

export default async function PatientLabsPage() {
  const { subjectId, uiLanguage } = await getPatientDashboardContext();

  const tabs: PreventionTab[] = [
    {
      id: "results",
      label: "Results & orders",
      content: (
        <>
          {/* Lab notifications link to /patient/labs with no hash, so the first tab must hold everything a notification
              is about: a released result and the status of an order in progress. */}
          <LabOrdersList patientId={subjectId} />
          <ReleasedLabResults patientId={subjectId} locale={uiLanguage} />
          <LabTrendCard patientId={subjectId} locale={uiLanguage} />
          <LabResults patientId={subjectId} />
          <ResultsTrendsCard patientId={subjectId} />
        </>
      ),
    },
    {
      id: "book",
      label: "Book a test",
      anchorIds: ["locations"],
      content: (
        <>
          {/* BookingRequestsList stays because vaccination bookings still
              create real requests a patient needs to see. */}
          <BookingRequestsList patientId={subjectId} />
          <AnnualBundleCard patientId={subjectId} />
          <LabCatalogue />
          {/* Synlab Nigeria was contracted 2026-08-21 and this branch
              directory shipped 2026-08-29 (list_lab_test_locations) — the
              older "no facility directory" line here predated both and is
              stale. Pharmacies/specialists remain unaffected by this.
              The id is the target of the symptom-triage "nearest clinic" link (/patient/labs#locations). */}
          <div id="locations" className="scroll-mt-24">
            <LabLocationDirectory />
          </div>
        </>
      ),
    },
    {
      id: "documents",
      label: "Documents",
      content: (
        <>
          <ResultDocuments patientId={subjectId} />
          <EcgReportDocuments patientId={subjectId} />
          <ImagingReportDocuments patientId={subjectId} />
        </>
      ),
    },
  ];

  return (
    <DashboardSection
      id="labs"
      title="Labs & bookings"
      description="Request laboratory tests, and upload and track your laboratory, ECG and imaging results."
      icon={SEMANTIC_ICON.labs}
    >
      {/* Lab-request coordination and the screening calendar are free to every
          patient since the pay-per-service rework: writing a request and
          tracking a result costs no clinician time, and a result a patient is
          holding must always reach a doctor whatever they pay. What stays paid
          is the doctor's own review of that result (result_document_review),
          gated where the review is offered rather than on this whole section. */}
      {/* Three tabs instead of one 11,000px scroll (design audit W1): what came back, what to order, and the files.
          Every panel stays mounted, so an upload in progress survives a tab switch. */}
      <PreventionTabs ariaLabel="Labs sections" tabs={tabs} />
    </DashboardSection>
  );
}
