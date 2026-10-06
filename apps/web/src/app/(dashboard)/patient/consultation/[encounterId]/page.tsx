import { notFound } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { ConsultationRoom, type RoomView } from "@/components/consultation/consultation-room";
import { t } from "@tarragon/i18n";

/**
 * S21: the patient's consultation room. consultation_room_view() answers null for anyone who is not the patient or the
 * clinician on this consultation, which is also what an unknown id gets, so this 404 cannot be used to probe for ids.
 */
export default async function PatientConsultationPage({ params }: { params: Promise<{ encounterId: string }> }) {
  const { encounterId } = await params;
  const { uiLanguage } = await getPatientDashboardContext();
  const supabase = await createClient();
  const { data } = await supabase.rpc("consultation_room_view" as never, { p_encounter: encounterId } as never);
  const view = data as unknown as RoomView | null;
  if (!view || view.role !== "patient") notFound();

  return (
    <div className="space-y-6">
      <PageHeader title={t("consult.room.title", uiLanguage)} icon={SEMANTIC_ICON.clinicianFollowUp} backTo={{ href: "/patient/care", label: "Care" }} />
      <ConsultationRoom view={view} locale={uiLanguage} />
    </div>
  );
}
