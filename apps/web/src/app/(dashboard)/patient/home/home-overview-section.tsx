import { loadHomeOverview } from "@/lib/patient/home-overview";
import { HomeStatusStrip } from "./home-status-strip";
import { NextAppointmentCard } from "./next-appointment-card";
import { CareJourneyCard } from "./care-journey-card";

/**
 * The status strip, next appointment and care journey, in the PD-05 order, from one request-scoped read. Rendered inside a
 * Suspense boundary on Home so its dozen small reads stream in without holding up the greeting and next step above.
 */
export async function HomeOverviewSection({
  patientId,
  acting,
  hasRiskAssessment,
  hasAnyVitals,
}: {
  patientId: string;
  acting: boolean;
  hasRiskAssessment: boolean;
  hasAnyVitals: boolean;
}) {
  const overview = await loadHomeOverview(patientId, { acting, hasRiskAssessment, hasAnyVitals });
  return (
    <div className="space-y-6">
      <HomeStatusStrip overview={overview} />
      <NextAppointmentCard appointment={overview.nextAppointment} />
      <CareJourneyCard stages={overview.journey} />
    </div>
  );
}
