import type { createServiceRoleClient } from "@/lib/supabase/service-role";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/**
 * Tells a patient their care team would like a quick call, in the app, by push and by email. INV-08 reserves SMS for sign-in
 * codes, and the old escalation path texted the raw Zoom join link, which carried the patient's name in the meeting topic as
 * well (INV-07). Every row names nothing but the consultation id; the page it opens issues the link. The in-app row is the
 * one that always counts: push and email only help a patient who is not looking at the app (the sender skips a channel the
 * patient has no device or address for, or has turned off).
 */
export async function queueVideoCallRequestedNotice(params: {
  service: ServiceClient;
  organisationId: string;
  patientId: string;
  consultationId: string;
}): Promise<boolean> {
  const row = (channel: "in_app" | "push" | "email") => ({
    organisation_id: params.organisationId,
    recipient_id: params.patientId,
    channel,
    status: "pending" as const,
    template: "video_call_requested",
    payload: { consultation_id: params.consultationId },
    content_class: "non_clinical" as const,
  });
  const { error } = await params.service.from("notifications").insert([row("in_app"), row("push"), row("email")]);
  return !error;
}
