import { notFound } from "next/navigation";
import { isTherapyProgrammeCode } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { Card, CardContent } from "@/components/ui/card";
import { SharedPhoneGate } from "@/components/mental-health/shared-phone-gate";
import { SharedPhoneSettings } from "@/components/mental-health/shared-phone-settings";
import { TherapyEntryScreen } from "@/components/therapy/entry-screen";
import { TherapySessionPlayer } from "@/components/therapy/session-player";
import { TherapyShareConsentCard } from "@/components/therapy/share-consent-card";

/**
 * One programme. No open enrolment: the entry screen. Active: the next session through the player (which re-checks the entry
 * questions first). Paused: a calm note that the care team is looking. Everything sits inside the shared-phone gate.
 */
export default async function PatientProgrammePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isTherapyProgrammeCode(code)) notFound();
  const { profile, subjectId } = await getPatientDashboardContext();
  const own = subjectId === profile.id;

  let enrolment: { id: string; state: string; completed_count: number } | null = null;
  if (own) {
    const supabase = await createClient();
    const { data: programme } = await supabase.from("therapy_programmes").select("id").eq("code", code).maybeSingle();
    if (programme) {
      const { data } = await supabase
        .from("therapy_enrolments")
        .select("id, state, completed_count")
        .eq("programme_id", programme.id)
        .in("state", ["active", "paused"])
        .maybeSingle();
      enrolment = data ?? null;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("therapy.title")} icon={SEMANTIC_ICON.mood} backTo={{ href: "/patient/programmes", label: t("therapy.guidance.back") }} />
      <SharedPhoneSettings />
      <SharedPhoneGate>
        {!own ? (
          <Card><CardContent className="py-4 text-sm">{t("therapy.guidance.not_available")}</CardContent></Card>
        ) : enrolment === null ? (
          <TherapyEntryScreen code={code} />
        ) : enrolment.state === "paused" ? (
          <>
            <Card><CardContent className="py-4 text-sm">{t("therapy.player.paused_review")}</CardContent></Card>
            <TherapyShareConsentCard enrolmentId={enrolment.id} />
          </>
        ) : (
          <>
            <TherapySessionPlayer enrolmentId={enrolment.id} programmeCode={code} ordinal={enrolment.completed_count + 1} />
            <TherapyShareConsentCard enrolmentId={enrolment.id} />
          </>
        )}
      </SharedPhoneGate>
    </div>
  );
}
