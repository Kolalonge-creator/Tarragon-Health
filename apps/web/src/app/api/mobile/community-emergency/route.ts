import { NextResponse } from "next/server";
import { authenticateCommunity } from "@/lib/community/api-auth";
import { alertEmergencyContact } from "@/lib/emergency/alert-contact";

/**
 * POST /api/mobile/community-emergency: the safety card's "Alert my emergency contact" button on the phone. It does what the web card
 * does (community-actions.ts startEmergencyFromSafetyCard): records an emergency event for the signed-in person and messages their saved
 * contact now. It runs ONLY when the person taps the button; nothing in Community ever calls it by itself, and the post's words are never
 * sent or stored here. The person's own account only: there is no acting-for here.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticateCommunity(request);
  if ("response" in auth) return auth.response;
  const { supabase, userId } = auth;

  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", userId).single();
  if (!profile?.organisation_id) return NextResponse.json({ ok: false }, { status: 400 });

  const { data: event, error } = await supabase
    .from("emergency_events")
    .insert({
      patient_id: userId,
      organisation_id: profile.organisation_id,
      source: "danger_symptom_checklist",
      trigger_detail: "Asked for help from a message",
      status: "active",
    })
    .select("id")
    .single();
  if (error || !event) return NextResponse.json({ ok: false }, { status: 502 });

  const alerted = await alertEmergencyContact(supabase, { eventId: event.id, subjectId: userId, actorId: userId });
  // The event exists either way, so the app's emergency guidance still shows. `contact` says whether a message went out and, if not, why.
  return NextResponse.json({ ok: true, contact: alerted.error ? "not_sent" : "sent", reason: alerted.error ?? null });
}
