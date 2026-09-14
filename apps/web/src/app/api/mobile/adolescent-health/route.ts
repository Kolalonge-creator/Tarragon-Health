import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { adolescentPsychosocialScreenSchema } from "@/lib/validation/adolescent-psychosocial-screen";
import { scoreAdolescentPsychosocialScreen } from "@/lib/rules/adolescent-psychosocial-screening";
import type { Json } from "@tarragon/shared";

/**
 * Mobile equivalent of apps/web/.../patient/adolescent-health-actions.ts's
 * submitAdolescentPsychosocialScreen. Ported verbatim, not reimplemented --
 * same shape as /api/mobile/mental-health-screen: scoring
 * (scoreAdolescentPsychosocialScreen) and the service-role insert happen
 * here, server-side, so a mobile client can never post a spoofed
 * self_harm_flagged/immediate_danger_flagged value. The row insert itself
 * fires private.handle_adolescent_psychosocial_screen_flags() (an AFTER
 * INSERT trigger), which raises the emergency/safeguarding pathway --
 * unlike mental-health-screen's route, this one does not also insert into
 * emergency_events itself, matching the web action's own comment on why
 * that's trigger-guaranteed here rather than app-layer.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = adolescentPsychosocialScreenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Please answer every question" },
      { status: 400 }
    );
  }
  const answers = parsed.data;

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  const result = scoreAdolescentPsychosocialScreen({
    homeFeelsSafe: answers.home_feels_safe,
    homeHurtOrThreatened: answers.home_hurt_or_threatened,
    educationNote: answers.education_note,
    daysActivePerWeek: answers.days_active_per_week,
    sleepHoursPerNight: answers.sleep_hours_per_night,
    substanceUseLastMonth: answers.substance_use_last_month,
    sexualHealthSupportRequested: answers.sexual_health_support_requested,
    selfHarmThoughts: answers.self_harm_thoughts,
    unsafeElsewhere: answers.unsafe_elsewhere,
    immediateDanger: answers.immediate_danger,
    notes: answers.notes,
  });

  const service = createServiceRoleClient();
  const { error: insertError } = await service.from("adolescent_psychosocial_screens").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    domain_responses: result.domainResponses as Json,
    self_harm_flagged: result.selfHarmFlagged,
    immediate_danger_flagged: result.immediateDangerFlagged,
    abuse_neglect_exploitation_flagged: result.abuseNeglectExploitationFlagged,
    substance_use_concern_flagged: result.substanceUseConcernFlagged,
    sexual_health_follow_up_requested: result.sexualHealthFollowUpRequested,
  });
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    selfHarmFlagged: result.selfHarmFlagged,
    immediateDangerFlagged: result.immediateDangerFlagged,
    abuseNeglectExploitationFlagged: result.abuseNeglectExploitationFlagged,
  });
}
