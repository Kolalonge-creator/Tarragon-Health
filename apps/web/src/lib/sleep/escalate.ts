import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { SLEEP_ABNORMAL_DURATION_HOURS, SLEEP_ABNORMAL_SLEEPINESS } from "@/lib/validation/sleep";

const ALERT_TITLE = "Sleep check-in: possible sleep concern";

/**
 * Spec §18.11 — "abnormal findings can trigger appropriate clinical
 * assessment". Deliberately conservative: only fires when a very short
 * night (<4h) AND high self-rated daytime sleepiness show up together,
 * never on either alone, to avoid over-flagging one rough night. Mirrors
 * flagCvRiskEscalations (apps/web/src/lib/cv-risk/escalate.ts) — raises a
 * clinician_alerts row for a doctor to look at, never auto-diagnoses (e.g.
 * never labels this "sleep apnoea"). Idempotent: won't duplicate an
 * already-open alert. Best-effort — callers must not let it block logging.
 */
export async function flagAbnormalSleep(
  patientId: string,
  organisationId: string,
  entry: { duration_hours: number; daytime_sleepiness: number | null },
): Promise<void> {
  const isAbnormal =
    entry.duration_hours < SLEEP_ABNORMAL_DURATION_HOURS &&
    (entry.daytime_sleepiness ?? 0) >= SLEEP_ABNORMAL_SLEEPINESS;
  if (!isAbnormal) return;

  const supabase = createServiceRoleClient();

  const { data: openAlert } = await supabase
    .from("clinician_alerts")
    .select("id")
    .eq("patient_id", patientId)
    .eq("status", "open")
    .eq("title", ALERT_TITLE)
    .maybeSingle();
  if (openAlert) return;

  await supabase.from("clinician_alerts").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    level: "clinician_review",
    escalation_level: 2,
    status: "open",
    title: ALERT_TITLE,
    detail: `Patient logged ${entry.duration_hours}h sleep with high daytime sleepiness — worth a clinical look, never auto-diagnosed here.`,
    category: "clinical",
    type_code: "symptom_escalation",
  });
}
