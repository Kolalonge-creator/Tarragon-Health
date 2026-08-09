import { createClient } from "@/lib/supabase/server";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { LabCatalogue } from "@/app/(dashboard)/patient/lab-catalogue";
import { LabOrdersList } from "@/app/(dashboard)/patient/lab-orders-list";
import { ResultsTrendsCard } from "@/app/(dashboard)/patient/results-trends-card";
import { LabResults } from "@/app/(dashboard)/patient/lab-results";
import { BookingRequestsList } from "@/app/(dashboard)/patient/booking-requests-list";

export default async function PatientLabsPage() {
  const { subjectId } = await getPatientDashboardContext();

  const supabase = await createClient();
  const { data: labCoordinationEnabled } = await supabase.rpc("has_feature_access", {
    feature: "lab_coordination",
  });
  const { data: preventionCoordinationEnabled } = await supabase.rpc("has_feature_access", {
    feature: "prevention_coordination",
  });
  const screeningBookingEnabled = (labCoordinationEnabled ?? false) || (preventionCoordinationEnabled ?? false);

  return (
    <DashboardSection
      id="labs"
      title="Labs & bookings"
      description="Book lab tests, track orders and results, and find facilities near you."
      icon={SEMANTIC_ICON.labs}
    >
      {/* lab_coordination (chronic plans) OR prevention_coordination
          (Prevent tier / prevention-screening add-on) both open this
          section — a Prevent subscriber who books screenings needs to see
          and pay for their own orders. Plain conditional rather than
          RequiresEntitlement because the gate is an OR of two keys. */}
      {screeningBookingEnabled ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div className="space-y-4">
            <LabResults patientId={subjectId} />
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
      ) : (
        <>
          <UpgradePrompt feature="lab_coordination" />
          {/* A Free user can still hold real requests and upload real
              results — a result a patient is holding must always reach a
              doctor, whatever they pay — so the request list, trends, and
              results stay visible below the prompt. */}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
            <div className="space-y-4">
              <LabResults patientId={subjectId} />
              <ResultsTrendsCard patientId={subjectId} />
            </div>
            <LabOrdersList patientId={subjectId} />
          </div>
        </>
      )}
    </DashboardSection>
  );
}
