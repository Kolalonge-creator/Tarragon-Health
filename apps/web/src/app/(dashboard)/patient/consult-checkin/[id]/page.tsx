import { notFound } from "next/navigation";
import { z } from "zod";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { t } from "@tarragon/i18n";
import { checkinViewSchema } from "@/lib/consult-checkin/model";
import { CheckinForm } from "./checkin-form";

/**
 * PCC: the patient's check-in after a consultation. my_post_consult_checkin() answers only for the signed-in patient's own check-in; anyone
 * else, and an unknown id, gets the same 404, so this page cannot be used to probe for ids.
 */
export default async function ConsultCheckinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { uiLanguage, subjectId } = await getPatientDashboardContext();
  const supabase = await createClient();
  const { data, error } = await (supabase as unknown as { rpc(fn: string, a: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }> }).rpc(
    "my_post_consult_checkin",
    { p_id: id },
  );
  if (error?.code === "P0002") notFound();
  const view = checkinViewSchema.safeParse(data);
  if (error || !view.success) {
    return (
      <div className="space-y-6">
        <PageHeader title="Check-in" icon={SEMANTIC_ICON.clinicianFollowUp} backTo={{ href: "/patient/care", label: t("consult.checkin.back", uiLanguage) }} />
        <p role="alert" className="text-sm text-red-600">{t("consult.checkin.error", uiLanguage)}</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader title={view.data.title} icon={SEMANTIC_ICON.clinicianFollowUp} backTo={{ href: "/patient/care", label: t("consult.checkin.back", uiLanguage) }} />
      <CheckinForm view={view.data} patientId={subjectId} />
    </div>
  );
}
