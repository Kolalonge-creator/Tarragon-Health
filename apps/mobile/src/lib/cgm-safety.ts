import { severeLowMessage, type CgmSample } from "@tarragon/shared";
import { supabase } from "./supabase";

/**
 * The severe-low safety message from a glucose sensor stream, decided ON THE PHONE (S70a, 18.5, INV-06): the rule and the words come from the
 * bundled shared package, so the message appears at once and offline, before any server round trip. The server separately creates the
 * clinician task; this never replaces it and never pages anyone. It looks at the last two hours of the person's own sensor readings.
 */
export async function loadSevereLowMessage(patientId: string, now: Date = new Date()): Promise<string | null> {
  try {
    const since = new Date(now.getTime() - 2 * 3600_000).toISOString();
    const { data, error } = await supabase
      .from("vitals_readings")
      .select("taken_at, glucose_mmol_l")
      .eq("patient_id", patientId)
      .eq("source", "cgm")
      .eq("vital_type", "glucose")
      .gte("taken_at", since)
      .order("taken_at", { ascending: true })
      .limit(60);
    if (error || !data) return null;
    const samples: CgmSample[] = data.flatMap((r) => (r.glucose_mmol_l === null ? [] : [{ takenAt: r.taken_at, mmolL: Number(r.glucose_mmol_l) }]));
    return severeLowMessage(samples);
  } catch {
    return null;
  }
}
