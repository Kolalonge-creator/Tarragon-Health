import { cache } from "react";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { PATIENT_FEATURES, type PatientSignals } from "@/lib/patient/feature-registry";

/** Every entitlement code any registry row actually gates on. Derived from the
 * registry rather than hardcoded, so adding a `relevance.feature` to a
 * feature costs nothing here and can never silently go unchecked. */
const GATED_FEATURE_CODES = Array.from(
  new Set(
    PATIENT_FEATURES.map((f) => f.relevance?.feature).filter(
      (code): code is string => typeof code === "string",
    ),
  ),
).sort();

/**
 * What we know about a patient, for deciding what to mention unprompted.
 *
 * Read-only and cheap: one profiles row, one care_plans row set, and one
 * has_feature_access call per code the registry actually gates on (four, at
 * the time of writing). Everything runs under the caller's own session, so
 * RLS applies exactly as it does everywhere else.
 *
 * cache()-wrapped for the same reason getPatientDashboardContext is: the
 * shell, a directory page and the discovery card can each ask for signals
 * within one request, and this should resolve once.
 */
export const getPatientSignals = cache(async function getPatientSignals(
  patientId: string,
): Promise<PatientSignals> {
  const supabase = await createClient();

  const [{ data: profile }, { data: plans }] = await Promise.all([
    supabase.from("profiles").select("sex, date_of_birth").eq("id", patientId).maybeSingle(),
    supabase.from("care_plans").select("condition").eq("patient_id", patientId).eq("status", "active"),
  ]);

  // has_feature_access reads the CALLER's entitlements, not an arbitrary
  // patient's. When a supporter is acting for somebody, the plan that matters
  // is the subject's, so fall back to the patient-scoped private helper's
  // public wrapper only where one exists — today it does not, so a supporter
  // acting for somebody sees suggestions computed from their own entitlements.
  // That is conservative in the right direction: it can only ever under-suggest
  // a paid feature, never wrongly promise one. Worth revisiting if acting-for
  // sessions become common.
  const featureResults = await Promise.all(
    GATED_FEATURE_CODES.map(async (code) => {
      const { data } = await supabase.rpc("has_feature_access", { feature: code });
      return data === true ? code : null;
    }),
  );

  const sex = profile?.sex === "male" || profile?.sex === "female" ? profile.sex : null;

  return {
    sex,
    ageYears: profile?.date_of_birth ? ageFromDateOfBirth(profile.date_of_birth) : null,
    conditions: (plans ?? []).map((p) => p.condition as string),
    features: featureResults.filter((c): c is string => c !== null),
  };
});
