"use server";

import { createClient } from "@/lib/supabase/server";
import { getActingFor } from "@/lib/acting/acting-for";
import { notSureInputSchema, notSureNote } from "@/lib/medications/not-sure";

/**
 * P16 (CMO decision from chat, 2026-11-07): a "Not sure" answer raises one routine care-team task through the existing
 * medicine-issue route, a medication_dispense_flags row (flag_type 'patient_query') that the /clinician/medication-issues
 * worklist reads. No urgency, threshold, alert or page is added.
 *
 * Refused while acting for someone: the table only accepts a patient's own row (patient_id = auth.uid()), so the only row a
 * supporter could write is one on their OWN record, which is exactly what must not happen.
 *
 * One per patient per Lagos day: the database refuses a second one (unique index
 * medication_dispense_flags_not_sure_one_per_day) and that refusal is reported here as success, because the care team has
 * already been asked today.
 */

export type NotSureResult = { ok: true; alreadyRaisedToday: boolean } | { ok: false; error: string };

const FAILED = "We couldn't let your care team know just now. Please try again.";

export async function raiseMedicationNotSureTask(input: unknown): Promise<NotSureResult> {
  const parsed = notSureInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: FAILED };
  if (await getActingFor()) {
    return { ok: false, error: "This can only be sent from their own account, so it reaches their care team as their answer." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile?.organisation_id) return { ok: false, error: FAILED };

  let medicationId: string | null = null;
  let note: string;
  if (parsed.data.source === "checkin") {
    const { data: checkin, error } = await supabase
      .from("medication_adherence_checkins")
      .select("checkin_type, medication_id")
      .eq("id", parsed.data.checkinId)
      .eq("patient_id", user.id)
      .maybeSingle();
    if (error || !checkin) return { ok: false, error: FAILED };
    medicationId = checkin.medication_id;
    let drugName: string | null = null;
    if (medicationId) {
      const { data: med } = await supabase
        .from("medications")
        .select("drug_name")
        .eq("id", medicationId)
        .eq("patient_id", user.id)
        .maybeSingle();
      drugName = med?.drug_name ?? null;
    }
    note = notSureNote("checkin", { drugName, checkinType: checkin.checkin_type });
  } else {
    note = notSureNote("reconciliation");
  }

  const { error } = await supabase.from("medication_dispense_flags").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    medication_id: medicationId,
    flag_type: "patient_query",
    note,
  });
  if (error) {
    if (error.code === "23505" && error.message.includes("not_sure_one_per_day")) return { ok: true, alreadyRaisedToday: true };
    return { ok: false, error: FAILED };
  }
  return { ok: true, alreadyRaisedToday: false };
}
