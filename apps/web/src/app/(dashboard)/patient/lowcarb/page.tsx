import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loadPatientLowCarb } from "@/lib/lowcarb/patient-gate";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckinCard, OfferCard, StopCard } from "./lowcarb-client";

/**
 * S50b: the patient's calm view of the supported eating programme. Reachable only when a clinician has offered it. It shows the offer, today's
 * check-in, what to do if a reading is low and how to reach the care team. It never shows a reading, a condition, or why a programme was paused, and
 * it never shows a medicine change: those come only as a signed change the patient confirms. Not marketed anywhere.
 */
export default async function LowCarbPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");
  const supabase = await createClient();
  const view = await loadPatientLowCarb(supabase, profile.id);

  return (
    <div className="space-y-6">
      <PageHeader title={t("lowcarb.title")} description="" />
      {view.state === "unavailable" ? (
        <p role="status" className="text-sm">
          {t("lowcarb.offer.unavailable")}
        </p>
      ) : (
        <>
          {view.status === "offered" ? <OfferCard enrolmentId={view.enrolmentId} /> : null}
          {view.status === "active" ? <CheckinCard checkins={view.checkins} /> : null}
          {view.status === "paused" ? (
            <Card role="status">
              <CardHeader>
                <CardTitle>{t("lowcarb.paused.title")}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-start gap-3">
                <Badge variant="amber">Paused</Badge>
                <p className="text-sm">{t("lowcarb.paused.body")}</p>
              </CardContent>
            </Card>
          ) : null}
          {view.status !== "offered" ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t("lowcarb.low.title")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{t("lowcarb.low.body", undefined, { line: String(view.lowLine) })}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t("lowcarb.contact.title")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm">{t("lowcarb.contact.body")}</p>
                  <p className="text-sm">{t("lowcarb.food.body")}</p>
                </CardContent>
              </Card>
              <StopCard enrolmentId={view.enrolmentId} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
