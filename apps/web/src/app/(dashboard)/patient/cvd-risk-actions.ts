"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assessCvdWho2019, supabaseCvdDataSource } from "@/lib/cv-risk/who-2019";

export type CvdRiskActionResult =
  | { ok: true; status: "scored"; bandCode: string; tier: string; furtherAssessment: boolean }
  | { ok: true; status: "not_scored"; reason: string }
  | { ok: false; error: "not_signed_in" | "unavailable" };

/**
 * Runs the WHO 2019 cardiovascular estimate for the signed-in patient and stores the result (S45, function 3.2).
 *
 * The patient id is always the session's own id, never a form field. The result is a band and a plain tier, never a percentage. While
 * the instrument is off, or for anyone it does not apply to (age, diabetes, treatment already indicated, missing data), the run still
 * records WHY it did not score, so it is never silently dropped. The write itself is service role only (record_risk_assessment).
 */
export async function runMyCvdRiskAssessment(): Promise<CvdRiskActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_signed_in" };

  const source = supabaseCvdDataSource(supabase, createServiceRoleClient());
  const result = await assessCvdWho2019(source, user.id, { recordedBy: user.id });
  if (!result.ok) return { ok: false, error: "unavailable" };
  const o = result.outcome;
  if (o.status === "scored") return { ok: true, status: "scored", bandCode: o.bandCode, tier: o.tier, furtherAssessment: o.furtherAssessment };
  return { ok: true, status: "not_scored", reason: o.status };
}
