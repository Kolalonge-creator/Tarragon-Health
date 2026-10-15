import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, TablesInsert } from "@tarragon/shared";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { flagHazardousAlcoholUse } from "@/lib/alcohol/escalate";
import { runBestEffort } from "@/lib/sentry/run-best-effort";
import { scorePhq9, scoreGad7, scoreAuditC, scoreEpds, EPDS_ITEM_COUNT } from "@/lib/rules/mental-health-screening";
import type { MentalHealthScreenInput } from "@/lib/validation/mental-health-screen";

/**
 * The one place a mental-health screen is scored and saved. The web server action and the mobile route both call it, so the two
 * cannot drift on the one screen where a missed crisis signal is the worst outcome (S56 moved the duplicated body here unchanged,
 * except for the neutral wording below).
 *
 * Scores are computed here (never trusting the client) and written through the service role: a client cannot post a spoofed total.
 * A self-harm answer (PHQ-9 item 9, EPDS item 10) is turned into a crisis by the database (triggers on mental_health_screens:
 * emergency event, priority task, page; no model anywhere in that path). The emergency event inserted below is the older
 * belt-and-braces route and is skipped when the database trigger already raised one in the last hour.
 *
 * INV-07 and S56: the emergency event's text names no instrument, score or wording about self-harm. The detail is read through the
 * audited path by a clinician who holds the task.
 */
export const CRISIS_EVENT_DETAIL = "A check-in needs urgent follow-up";

/**
 * `told` is true only when an emergency event for this crisis exists (the database trigger raised one, or the fallback below did), so
 * the card never says "your care team has been told" on the strength of nothing. It is false when a crisis was flagged and no event
 * could be raised: the card then shows the same go-to-the-nearest-hospital guidance without that promise.
 */
export type SaveScreensResult = { ok: true; crisis: boolean; told: boolean } | { ok: false; error: string };

export async function saveMentalHealthScreens(args: {
  /** The signed-in user's own session (used for the profile read and the emergency event, under their RLS). */
  userClient: SupabaseClient<Database>;
  userId: string;
  answers: MentalHealthScreenInput;
}): Promise<SaveScreensResult> {
  const { userClient: supabase, userId, answers } = args;
  const { data: profile } = await supabase.from("profiles").select("organisation_id, sex").eq("id", userId).single();
  if (!profile?.organisation_id) return { ok: false, error: "No organisation on file" };
  const organisationId = profile.organisation_id;

  const pick = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => answers[`${prefix}_${i + 1}` as keyof typeof answers] as unknown as number);
  const phq9Items = pick("phq9", 9);
  const gad7Items = pick("gad7", 7);
  const auditcItems = pick("auditc", 3);
  const phq9 = scorePhq9(phq9Items);
  const gad7 = scoreGad7(gad7Items);
  const auditc = scoreAuditC(auditcItems, profile.sex);

  // EPDS is opt-in (perinatal self-identification): only scored and saved when the full set was answered.
  const epdsItems = Array.from(
    { length: EPDS_ITEM_COUNT },
    (_, i) => answers[`epds_${i + 1}` as keyof typeof answers] as unknown as number | undefined
  );
  const epds = answers.is_perinatal && epdsItems.every((v) => v !== undefined) ? scoreEpds(epdsItems as number[]) : null;

  const rows: TablesInsert<"mental_health_screens">[] = [
    { organisation_id: organisationId, patient_id: userId, instrument: "phq9", total_score: phq9.total, severity_band: phq9.band, crisis_flagged: phq9.crisis, item_responses: { items: phq9Items } as Json },
    { organisation_id: organisationId, patient_id: userId, instrument: "gad7", total_score: gad7.total, severity_band: gad7.band, item_responses: { items: gad7Items } as Json },
    { organisation_id: organisationId, patient_id: userId, instrument: "auditc", total_score: auditc.total, severity_band: auditc.band, hazardous: auditc.hazardous, item_responses: { items: auditcItems } as Json },
  ];
  if (epds) {
    rows.push({ organisation_id: organisationId, patient_id: userId, instrument: "epds", total_score: epds.total, severity_band: epds.band, crisis_flagged: epds.crisis, item_responses: { items: epdsItems } as Json });
  }
  // Accepted tension with the service-role helper's contract: item_responses is the patient's own input, but it rides in the same row
  // as the server-computed score and the table has no patient INSERT policy so a client can never post a spoofed total. Identity is the
  // authenticated session's user id, never anything client-supplied.
  const service = createServiceRoleClient();
  const { error: insertError } = await service.from("mental_health_screens").insert(rows);
  if (insertError) return { ok: false, error: insertError.message };

  const crisis = phq9.crisis || epds?.crisis === true;
  let told = false;
  if (crisis) {
    // Skip when the database trigger already raised an active event in the last hour (it does for every crisis row).
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from("emergency_events")
      .select("id")
      .eq("patient_id", userId)
      .eq("status", "active")
      .in("source", ["mental_health_screen", "intake_screen"])
      .gte("created_at", since)
      .limit(1);
    if (existing && existing.length > 0) {
      told = true;
    } else {
      // The database trigger is the primary route; this is the belt-and-braces one. A failure here must be seen (Sentry), never
      // dropped: the screen itself is already saved and the patient still gets the crisis card, so it does not fail the request.
      await runBestEffort(async () => {
        const { error: eventError } = await supabase.from("emergency_events").insert({
          patient_id: userId,
          organisation_id: organisationId,
          source: "intake_screen",
          trigger_detail: CRISIS_EVENT_DETAIL,
          status: "active",
        });
        if (eventError) throw new Error(`crisis emergency event could not be raised: ${eventError.message}`);
        told = true;
      }, { step: "crisis_emergency_event", userId });
    }
  }

  // Alcohol referral pathway (spec 18.10): best-effort, never blocks the screen from saving, but a failure is reported.
  if (auditc.hazardous) {
    await runBestEffort(() => flagHazardousAlcoholUse(userId, organisationId), { step: "hazardous_alcohol_referral", userId });
  }
  return { ok: true, crisis, told };
}
