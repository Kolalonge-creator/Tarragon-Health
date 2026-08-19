import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { assessBpControlBestEffort } from "@/lib/ml/assess-bp-control";
import { assessHeartRateBestEffort } from "@/lib/vitals/assess-heart-rate";
import { assessGlucoseBestEffort } from "@/lib/vitals/assess-glucose";
import { assessHealthScoreBestEffort } from "@/lib/health-score/assess-health-score";
import {
  bloodPressureSchema,
  glucoseSchema,
  weightSchema,
  pulseSchema,
  temperatureSchema,
  spo2Schema,
  GLUCOSE_RANGE,
} from "@/lib/validation/vitals";
import { mgDlToMmolL, type TablesInsert } from "@tarragon/shared";
import { z } from "zod";

/**
 * Manual-entry vitals ingestion for the Expo mobile app's native quick-log
 * (the highest-frequency native write in the app per
 * docs/MOBILE_APP_SPEC.md §2.2) — mirrors logVital's per-vital-type branches
 * in apps/web/src/app/(dashboard)/patient/actions.ts (insert + the matching
 * best-effort ML/red-flag assessment + health-score reassessment) so a
 * dangerous reading logged from the phone escalates exactly like one logged
 * on web, per CLAUDE.md's "never deprioritise or silently swallow an
 * abnormal result" rule.
 *
 * Covers the six vital types §2.2 lists for native quick-log: blood
 * pressure, glucose, weight, temperature, SpO2, pulse. Ketones and waist
 * circumference stay web-only — the native screen doesn't collect them, and
 * temperature/SpO2 already escalate via their own DB-trigger red-flag
 * engines (see project_vitals_red_flag_escalation_20260807 memory), so no
 * app-layer assessor call is needed for those two beyond the health score.
 *
 * Optionally scoped to a beneficiary_profile_id instead of the signed-in
 * user — the mobile equivalent of web's acting-for cookie
 * (apps/web/src/lib/acting/acting-for.ts). A native app has no cookie jar for
 * its bearer-authenticated API calls, so the client passes the beneficiary id
 * explicitly and it is re-checked here against private.can_act_for on every
 * request, same as resolveSubjectId does for web — a stale or forged id gets
 * nothing, only a live 'manage' grant does. Other /api/mobile/* routes
 * (device-readings, cgm-readings, health-samples) still have no acting-for
 * support; this one needed it because the native Vitals screen is the
 * mobile equivalent of logVital, which already has it.
 */
const mobileVitalsSchema = z
  .discriminatedUnion("vital_type", [
    bloodPressureSchema,
    glucoseSchema,
    weightSchema,
    pulseSchema,
    temperatureSchema,
    spo2Schema,
  ])
  .superRefine((data, ctx) => {
    if (data.vital_type === "glucose") {
      const range = GLUCOSE_RANGE[data.glucose_unit];
      if (data.glucose_value < range.min || data.glucose_value > range.max) {
        ctx.addIssue({
          code: "custom",
          path: ["glucose_value"],
          message: `Glucose must be between ${range.min} and ${range.max} ${range.label}`,
        });
      }
    }
  });

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

  const parsed = mobileVitalsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { taken_at, ...reading } = parsed.data;

  // beneficiary_profile_id is validated separately rather than folded into
  // mobileVitalsSchema's discriminated union, so each vital-type branch
  // doesn't need to repeat it — mobileVitalsSchema.safeParse above already
  // ignores this extra key (none of the vital schemas are .strict()).
  const beneficiaryParsed = z
    .object({ beneficiary_profile_id: z.string().uuid().optional() })
    .safeParse(body);
  const beneficiaryId = beneficiaryParsed.success
    ? beneficiaryParsed.data.beneficiary_profile_id
    : undefined;

  let subjectId = user.id;
  if (beneficiaryId) {
    const { data: allowed } = await supabase.rpc("can_act_for", { p_beneficiary: beneficiaryId });
    if (allowed !== true) {
      return NextResponse.json(
        { error: "You don't have permission to log this for that person." },
        { status: 403 }
      );
    }
    subjectId = beneficiaryId;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", subjectId)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  // Same glucose_value/glucose_unit → glucose_mmol_l normalisation as
  // logVital — vitals_readings only ever stores the canonical mmol/L column.
  const row: TablesInsert<"vitals_readings"> =
    reading.vital_type === "glucose"
      ? {
          patient_id: subjectId,
          organisation_id: profile.organisation_id,
          source: "manual",
          vital_type: "glucose",
          glucose_mmol_l:
            reading.glucose_unit === "mg_dl" ? mgDlToMmolL(reading.glucose_value) : reading.glucose_value,
          note: reading.note ?? null,
        }
      : {
          patient_id: subjectId,
          organisation_id: profile.organisation_id,
          source: "manual",
          ...reading,
          note: reading.note ?? null,
        };
  row.taken_at = taken_at ? new Date(taken_at).toISOString() : new Date().toISOString();

  const { error: insertError } = await supabase.from("vitals_readings").insert(row);
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  if (row.vital_type === "blood_pressure") {
    await assessBpControlBestEffort(supabase, subjectId, profile.organisation_id);
  }
  if (row.vital_type === "pulse") {
    await assessHeartRateBestEffort(supabase, subjectId, profile.organisation_id);
  }
  if (row.vital_type === "glucose") {
    await assessGlucoseBestEffort(supabase, subjectId, profile.organisation_id);
  }
  await assessHealthScoreBestEffort(supabase, subjectId, profile.organisation_id);

  return NextResponse.json({ success: true });
}
