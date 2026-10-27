import "server-only";
import { createClient } from "@/lib/supabase/server";
import { NO_WELLBEING_FEATURES, parseWellbeingFeatures, type WellbeingFeatures } from "./features";

/** Reads the patient's open wellbeing features on the server. Never throws: any failure closes every feature. */
export async function getWellbeingFeatures(): Promise<WellbeingFeatures> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("wellbeing_features_open");
    if (error) return NO_WELLBEING_FEATURES;
    return parseWellbeingFeatures(data);
  } catch {
    return NO_WELLBEING_FEATURES;
  }
}
