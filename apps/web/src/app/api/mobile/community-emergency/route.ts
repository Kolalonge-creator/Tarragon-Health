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
  const auth = await authenticateCommunity(request, { bearerOnly: true });
  if ("response" in auth) return auth.response;
  const { supabase, userId } = auth;

  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", userId).single();
  if (!profile?.organisation_id) return NextResponse.json({ ok: false }, { status: 400 });

  // A double tap, a retry or a script must not message the contact again: one alert from a message per ten minutes.
  const TRIGGER = "Asked for help from a message";
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from("emergency_events")
    .select("id")
    .eq("patient_id", userId)
    .eq("trigger_detail", TRIGGER)
    .gte("created_at", since)
    .limit(1);
  if (recent && recent.length > 0) return NextResponse.json({ ok: true, contact: "already_sent", reason: null });

  const { data: event, error } = await supabase
    .from("emergency_events")
    .insert({
      patient_id: userId,
      organisation_id: profile.organisation_id,
      source: "danger_symptom_checklist",
      trigger_detail: TRIGGER,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !event) return NextResponse.json({ ok: false }, { status: 502 });

  const alerted = await alertEmergencyContact(supabase, { eventId: event.id, subjectId: userId, actorId: userId });
  // The event exists either way, so the app's emergency guidance still shows. `contact` says whether a message went out and, if not, why.
  // alertEmergencyContact only ever returns fixed plain-English sentences, never database text.
  return NextResponse.json({ ok: true, contact: alerted.error ? "not_sent" : "sent", reason: alerted.error ?? null });
}
