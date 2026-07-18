"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createMeeting } from "@/lib/zoom/meetings";
import { isZoomConfigured } from "@/lib/zoom/client";

const confirmSchema = z.object({
  consultId: z.string().uuid(),
  slot: z.string().datetime(),
});

export type ConfirmSlotState =
  | { error: string }
  | { success: true; scheduledAt: string; hasLink: boolean }
  | undefined;

/**
 * Patient confirms one of the clinician's proposed video-consult slots — the
 * day/time handshake. Ownership is verified through the RLS-scoped SELECT
 * (video_consultations only returns the caller's own rows). The staff-only
 * UPDATE RLS means the actual write goes through the service-role client after
 * that ownership + slot-membership check — same pattern as
 * set_pharmacy_order_delivery_address / the subscriber-side subscription
 * cancel. The scheduled Zoom meeting is created best-effort (skipped, not
 * failed, when Zoom isn't configured yet). WhatsApp/SMS only reminds.
 */
export async function confirmAnnualReviewSlot(
  consultId: string,
  slot: string,
): Promise<ConfirmSlotState> {
  const parsed = confirmSchema.safeParse({ consultId, slot });
  if (!parsed.success) {
    return { error: "Invalid selection" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  // RLS ensures this only resolves for the patient's own consult.
  const { data: consult } = await supabase
    .from("video_consultations")
    .select("id, organisation_id, patient_id, proposed_slots, scheduled_at, status")
    .eq("id", parsed.data.consultId)
    .maybeSingle();
  if (!consult) {
    return { error: "Consultation not found" };
  }
  if (consult.patient_id !== user.id) {
    return { error: "Not your consultation" };
  }
  if (consult.status === "cancelled") {
    return { error: "This consultation was cancelled." };
  }

  const proposed = (consult.proposed_slots ?? []).map((s) => new Date(s).toISOString());
  if (!proposed.includes(new Date(parsed.data.slot).toISOString())) {
    return { error: "That time is no longer offered." };
  }

  const service = createServiceRoleClient();
  const { error: updateError } = await service
    .from("video_consultations")
    .update({
      scheduled_at: parsed.data.slot,
      patient_confirmed_at: new Date().toISOString(),
    })
    .eq("id", consult.id);
  if (updateError) {
    return { error: updateError.message };
  }

  // Best-effort scheduled Zoom meeting once the slot is agreed.
  let hasLink = false;
  if (isZoomConfigured()) {
    const meeting = await createMeeting({
      topic: "Tarragon Health — annual review consult",
      startTime: parsed.data.slot,
    });
    if (meeting.ok) {
      hasLink = true;
      await service
        .from("video_consultations")
        .update({
          zoom_meeting_id: meeting.data.meetingId,
          join_url: meeting.data.joinUrl,
          host_start_url: meeting.data.hostStartUrl,
        })
        .eq("id", consult.id);
    }
  }

  // Reminder notification (notification layer only, never the interface).
  await service.from("notifications").insert({
    organisation_id: consult.organisation_id,
    recipient_id: consult.patient_id,
    channel: "whatsapp",
    status: "pending",
    template: "annual_review_consult_scheduled",
    payload: { scheduled_at: parsed.data.slot },
  });

  return { success: true, scheduledAt: parsed.data.slot, hasLink };
}
