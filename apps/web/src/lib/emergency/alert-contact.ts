import type { SupabaseClient } from "@supabase/supabase-js";
import { type Database, type Json } from "@tarragon/shared";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type AlertContactResult = { error?: string; success?: boolean };

/**
 * Immediately messages the saved emergency contact (SMS) for one of the patient's own active emergency events, without waiting for the
 * acknowledge-gated timeout. Shared by the web action (cookie session) and the mobile route (bearer token).
 *
 * Ownership and the contact are read under the PATIENT'S OWN session first (RLS), scoped to `subjectId` (the account the emergency belongs
 * to). Only then is the service role used, because `notifications` is queue-write only. A contact is never messaged without the patient's
 * recorded consent. `actorId` is who pressed the button (written to the audit log by `mark_emergency_contact_notified`).
 */
export async function alertEmergencyContact(
  supabase: SupabaseClient<Database>,
  args: { eventId: string; subjectId: string; actorId: string },
): Promise<AlertContactResult> {
  const { data: event } = await supabase
    .from("emergency_events")
    .select("id, organisation_id, contact_notified_at")
    .eq("id", args.eventId)
    .eq("patient_id", args.subjectId)
    .single();
  if (!event) return { error: "Emergency not found" };
  if (event.contact_notified_at) return { success: true };

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, emergency_contact_consent")
    .eq("id", args.subjectId)
    .single();
  if (!profile?.emergency_contact_phone) return { error: "Add an emergency contact number first so we can alert them." };
  if (!profile.emergency_contact_consent) return { error: "Confirm your emergency contact has agreed to be contacted before we alert them." };

  const payload = {
    to_phone: profile.emergency_contact_phone,
    contact_name: profile.emergency_contact_name ?? "there",
    contact_relationship: profile.emergency_contact_relationship,
    patient_name: profile.full_name ?? "someone who lists you as their emergency contact",
  } as Json;

  const serviceRole = createServiceRoleClient();
  const { error: notifyError } = await serviceRole.from("notifications").insert([
    {
      organisation_id: event.organisation_id,
      recipient_id: args.subjectId,
      channel: "sms",
      status: "pending",
      template: "emergency_contact_alert",
      payload,
    },
  ]);
  if (notifyError) return { error: notifyError.message };

  await serviceRole.rpc("mark_emergency_contact_notified", { p_event_id: args.eventId, p_actor_id: args.actorId });
  return { success: true };
}
