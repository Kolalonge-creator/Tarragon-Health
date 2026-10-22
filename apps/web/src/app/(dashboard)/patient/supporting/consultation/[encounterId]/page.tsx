import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { t } from "@tarragon/i18n";
import { CaregiverRoom } from "@/components/consultation/caregiver-room";
import { callPolicyFor } from "@/lib/consultations/call-config";
import { parseCaregiverInvites } from "@/lib/consultations/caregivers";

export const metadata = { title: "Join the call", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CGJ: the room an invited caregiver joins a consultation from. The database answers only the signed-in person's own live invites
 * (my_consultation_invites), so a stranger, a removed caregiver, an ended call and an unknown id all read the same: "not available".
 * Nothing about the patient's record is read here, and there is no link to the call: the call runs inside the page or not at all.
 */
export default async function CaregiverConsultationPage({ params }: { params: Promise<{ encounterId: string }> }) {
  const { encounterId } = await params;
  if (!UUID.test(encounterId)) notFound();
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const { uiLanguage } = await getPatientDashboardContext();
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_consultation_invites" as never);
  const invite = parseCaregiverInvites(data).find((i) => i.encounter_id === encounterId) ?? null;
  // null unless the Meeting SDK is configured; a caregiver has no other way into the call, so the room says so when it is null.
  const policy = callPolicyFor(120);

  return (
    <div className="space-y-6">
      <PageHeader title={t("consult.cg.room_title", uiLanguage)} icon={SEMANTIC_ICON.family} backTo={{ href: "/patient/supporting", label: "People you support" }} />
      <CaregiverRoom invite={invite} locale={uiLanguage} call={policy ? { policy } : null} />
    </div>
  );
}
