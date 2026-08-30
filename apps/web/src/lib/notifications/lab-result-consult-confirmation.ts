import type { createServiceRoleClient } from "@/lib/supabase/service-role";
import { koboToNaira, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

const CANCELLATION_RULES =
  "Free to cancel or reschedule any time before the visit starts, from your dashboard.";

/**
 * Consultation System §9.11 "appointment confirmation" shape — date, time,
 * provider, consultation type, location/video link, cost, cancellation
 * rules — cloned from sendVideoConsultBookedConfirmation
 * (notifications/video-consult-confirmation.ts) for the lab-result
 * consultation fee's own booking path
 * (accept_lab_result_consult_request), which has no shared table with
 * video_visit_requests to join back through for the provider name/cost —
 * this walks lab_result_consult_requests instead.
 *
 * Sends both whatsapp (best-effort — Meta template approval is still
 * pending platform-wide, see CLAUDE.md) and an in_app companion, same
 * guaranteed-delivery discipline as
 * 20260811235133_guarantee_in_app_notification_companions.sql applied to
 * every other patient-facing confirmation. content_class is left at its
 * default ('non_clinical') — a booking confirmation is logistics, not a
 * clinical finding, same as the video-visit equivalent.
 */
export async function sendLabResultConsultBookedConfirmation(params: {
  service: ServiceClient;
  consultId: string;
  joinUrl: string | null;
}): Promise<void> {
  const { service, consultId, joinUrl } = params;

  const { data: consult } = await service
    .from("video_consultations")
    .select("organisation_id, patient_id, scheduled_at, join_url")
    .eq("id", consultId)
    .maybeSingle();
  if (!consult) return;

  const { data: request } = await service
    .from("lab_result_consult_requests")
    .select("amount_minor, currency, accepted_by")
    .eq("video_consultation_id", consultId)
    .maybeSingle();

  let providerName: string | null = null;
  if (request?.accepted_by) {
    const { data: staff } = await service
      .from("clinical_staff")
      .select("profile_id")
      .eq("id", request.accepted_by)
      .maybeSingle();
    if (staff?.profile_id) {
      const { data: profile } = await service
        .from("profiles")
        .select("full_name")
        .eq("id", staff.profile_id)
        .maybeSingle();
      providerName = profile?.full_name ?? null;
    }
  }

  const cost =
    request && request.amount_minor > 0
      ? `${CURRENCY_SYMBOL[request.currency as Currency] ?? request.currency}${koboToNaira(request.amount_minor).toLocaleString()}`
      : "Already paid";

  const payload = {
    scheduled_at: consult.scheduled_at,
    consultation_type: "video",
    provider_name: providerName,
    join_url: joinUrl ?? consult.join_url ?? null,
    cost,
    cancellation_rules: CANCELLATION_RULES,
  };

  await service.from("notifications").insert([
    {
      organisation_id: consult.organisation_id,
      recipient_id: consult.patient_id,
      channel: "whatsapp",
      status: "pending",
      template: "lab_result_consult_booked",
      payload,
    },
    {
      organisation_id: consult.organisation_id,
      recipient_id: consult.patient_id,
      channel: "in_app",
      status: "pending",
      template: "lab_result_consult_booked",
      payload,
    },
  ]);
}
