import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { runBestEffort } from "@/lib/sentry/run-best-effort";
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
 *
 * Optionally carries a client_reading_id (a UUID the phone generates at the
 * moment of local-first entry into its offline queue — see
 * apps/mobile/src/lib/offline-vitals-queue.ts). A queued reading may be
 * retried blind after a dropped connection, so vitals_readings_client_dedupe_idx
 * (patient_id, client_reading_id) makes a replay of the same id a no-op
 * rather than a duplicate row — see the 23505 handling below.
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

  const clientReadingParsed = z.object({ client_reading_id: z.string().uuid().optional() }).safeParse(body);
  const clientReadingId = clientReadingParsed.success ? clientReadingParsed.data.client_reading_id : undefined;

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
  // Narrowed into its own const: TS can't carry the null-check above through
  // the runBestEffort closures further down, which read this via a fresh
  // arrow function rather than a direct access.
  const organisationId = profile.organisation_id;

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
  row.client_reading_id = clientReadingId ?? null;

  const { error: insertError } = await supabase.from("vitals_readings").insert(row);
  if (insertError) {
    // A queued offline reading may retry blind after a dropped connection —
    // a 23505 against vitals_readings_client_dedupe_idx means this exact
    // client_reading_id already landed, so the replay is a no-op success,
    // not a duplicate to reject. Only applies when the client actually sent
    // one; a bare unique-violation with no client_reading_id is a real error.
    if (clientReadingId && insertError.code === "23505") {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // From here on the reading is durably saved — every failure below is
  // post-insert best-effort work, never a reason to report the save itself
  // as failed. assessBpControlBestEffort/assessHeartRateBestEffort/
  // assessGlucoseBestEffort are documented "never throws," but that isn't
  // literally enforced by a try/catch inside any of them (confirmed by
  // reading each), so a genuine network/DB drop right after the insert above
  // can still throw here. Without runBestEffort, that throw would propagate
  // out of this route handler as an uncaught exception — Next.js turns that
  // into a 500 with no JSON body, which the mobile offline queue
  // (offline-vitals-queue.ts) reads as "not synced" and keeps retrying. That
  // retry is not free here: a retried client_reading_id hits the 23505
  // dedupe branch above and returns early WITHOUT ever re-running this
  // assessment, so a 500 buys nothing but a stuck queue entry for a reading
  // that is, in fact, already safely stored. These three calls are the
  // platform's actual red-flag/escalation detection for this reading (BP
  // crisis, pulse EMERGENCY range, DKA/severe hypo) — CLAUDE.md is explicit
  // that an abnormal-result event must "never deprioritise or silently
  // swallow" it, so a failure here is reported to Sentry AND surfaced in the
  // response body (never a silent, unqualified success), separately from the
  // genuinely inert health-score bookkeeping below (only one branch below
  // ever runs, per row.vital_type, so one runBestEffort call is enough).
  let safetyAssessmentFailed = false;
  const safetyExtra = { route: "api/mobile/vitals", stage: "safety_assessment", vitalType: row.vital_type };
  if (row.vital_type === "blood_pressure") {
    safetyAssessmentFailed = await runBestEffort(
      () => assessBpControlBestEffort(supabase, subjectId, organisationId),
      safetyExtra
    );
  } else if (row.vital_type === "pulse") {
    safetyAssessmentFailed = await runBestEffort(
      () => assessHeartRateBestEffort(supabase, subjectId, organisationId),
      safetyExtra
    );
  } else if (row.vital_type === "glucose") {
    safetyAssessmentFailed = await runBestEffort(
      () => assessGlucoseBestEffort(supabase, subjectId, organisationId),
      safetyExtra
    );
  }

  // Genuinely inert bookkeeping — a lost health-score refresh has no
  // clinical-safety consequence, unlike the red-flag assessments above, so a
  // failure here staying silent (Sentry-only, return value ignored) is the
  // right call.
  await runBestEffort(
    () => assessHealthScoreBestEffort(supabase, subjectId, organisationId),
    { route: "api/mobile/vitals", stage: "post_insert_best_effort" }
  );

  return NextResponse.json({
    success: true,
    ...(safetyAssessmentFailed ? { safetyAssessmentFailed: true } : {}),
  });
}
