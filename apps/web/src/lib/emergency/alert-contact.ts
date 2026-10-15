import type { SupabaseClient } from "@supabase/supabase-js";
import { type Database } from "@tarragon/shared";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type AlertContactResult = { error?: string; success?: boolean };

/**
 * Immediately alerts the saved emergency contact (push, in-app and email, never SMS) for one of the patient's own active emergency events, without waiting for the
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
  if (!profile?.emergency_contact_phone) return { error: "Add an emergency contact number first. We can only alert a contact who uses Tarragon, so please call them yourself too." };
  if (!profile.emergency_contact_consent) return { error: "Confirm your emergency contact has agreed to be contacted before we alert them." };

  // No SMS (founder decision OQ-333). The contact is told by push, in-app and email only when they are also a Tarragon account with a
  // confirmed phone number matching the one on file. The database function does the matching and consent check and says how many
  // copies it queued. Service role only, because `notifications` is queue-write only.
  const serviceRole = createServiceRoleClient();
  const { data: queued, error: notifyError } = await serviceRole.rpc("alert_emergency_contact", { p_event_id: args.eventId, p_actor_id: args.actorId });
  if (notifyError) return { error: "We could not alert your emergency contact just now. Please call them, or use the emergency numbers." };
  if (!queued || queued < 1) {
    return { error: "We can only alert a contact who uses Tarragon, and we could not reach yours that way. Please call them now, or use the emergency numbers." };
  }
  return { success: true };
}
