import type { createServiceRoleClient } from "@/lib/supabase/service-role";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/**
 * Tells a patient their care team would like a quick call. In app only: INV-08 reserves SMS for sign-in codes, and
 * the old escalation path texted the raw Zoom join link, which carried the patient's name in the meeting topic as well
 * (INV-07). The row names nothing but the consultation id; the page it opens issues the link.
 */
export async function queueVideoCallRequestedNotice(params: {
  service: ServiceClient;
  organisationId: string;
  patientId: string;
  consultationId: string;
}): Promise<boolean> {
  const { error } = await params.service.from("notifications").insert([
    {
      organisation_id: params.organisationId,
      recipient_id: params.patientId,
      channel: "in_app",
      status: "pending",
      template: "video_call_requested",
      payload: { consultation_id: params.consultationId },
      content_class: "non_clinical",
    },
  ]);
  return !error;
}
