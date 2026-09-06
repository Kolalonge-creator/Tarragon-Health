"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  SEXUAL_HEALTH_INSTRUMENTS,
  SEXUAL_HEALTH_SCHEMA_BY_INSTRUMENT,
  type SexualHealthInstrument,
} from "@/lib/validation/sexual-health-screen";
import {
  scoreSexualHealthScreen,
  SEXUAL_HEALTH_ITEM_COUNT,
  type SexualHealthSeverityBand,
} from "@/lib/rules/sexual-health-scoring";
import type { Json } from "@tarragon/shared";

export type SubmitSexualHealthScreenState =
  | {
      error?: string;
      success?: boolean;
      instrument?: SexualHealthInstrument;
      totalScore?: number;
      severityBand?: SexualHealthSeverityBand;
      cardiometabolicFlag?: boolean;
    }
  | undefined;

/**
 * Records a sexual dysfunction screen (spec §47.10). Scored here — never
 * trusting a client-supplied total/band — and written via the service role:
 * sexual_health_screens has no client-facing INSERT policy at all (same
 * discipline as mental_health_screens). When cardiometabolicFlag comes back
 * true (iief5 at moderate/severe), we don't create a new alert type or a
 * second risk engine — the result just carries the flag so the UI can nudge
 * the patient toward the existing CV-risk questionnaire
 * (/patient/prevention#risk-assessment).
 */
export async function submitSexualHealthScreen(
  _prevState: SubmitSexualHealthScreenState,
  formData: FormData
): Promise<SubmitSexualHealthScreenState> {
  const instrumentRaw = formData.get("instrument");
  if (
    typeof instrumentRaw !== "string" ||
    !(SEXUAL_HEALTH_INSTRUMENTS as readonly string[]).includes(instrumentRaw)
  ) {
    return { error: "Choose which concern you'd like to check first" };
  }
  const instrument = instrumentRaw as SexualHealthInstrument;

  const schema = SEXUAL_HEALTH_SCHEMA_BY_INSTRUMENT[instrument];
  const raw: Record<string, FormDataEntryValue | null> = {};
  for (let i = 1; i <= SEXUAL_HEALTH_ITEM_COUNT; i++) {
    raw[`${instrument}_${i}`] = formData.get(`${instrument}_${i}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please answer every question" };
  }
  const answers = parsed.data as Record<string, number>;
  const items = Array.from(
    { length: SEXUAL_HEALTH_ITEM_COUNT },
    (_, i) => answers[`${instrument}_${i + 1}`]
  );

  const { totalScore, severityBand, cardiometabolicFlag } = scoreSexualHealthScreen(
    instrument,
    items
  );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const service = createServiceRoleClient();
  const { error: insertError } = await service.from("sexual_health_screens").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    instrument,
    total_score: totalScore,
    severity_band: severityBand,
    cardiometabolic_flag: cardiometabolicFlag,
    item_responses: { items } as Json,
  });
  if (insertError) return { error: insertError.message };

  return { success: true, instrument, totalScore, severityBand, cardiometabolicFlag };
}
