import AsyncStorage from "@react-native-async-storage/async-storage";
import { NO_WELLBEING_FEATURES, parseWellbeingFeatures, type WellbeingFeatures } from "@tarragon/shared";
import { supabase } from "@/lib/supabase";

/**
 * Which of the S56b wellbeing features are open for this person (public.wellbeing_features_open), with the last good answer kept on the phone
 * so the calm tool still opens with no signal. Every flag fails CLOSED: with no answer and no saved answer, nothing is shown.
 *
 * The saved answer is per person (several people can use one phone) and is only an answer to "is this open", never any wellbeing data.
 * The server refuses the share and the hide preference whatever this says; the calm tool needs no server at all once open.
 */
export interface FeatureIO {
  fetchOpen(): Promise<unknown>;
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export async function resolveWellbeingFeatures(io: FeatureIO): Promise<WellbeingFeatures> {
  try {
    const raw = await io.fetchOpen();
    const features = parseWellbeingFeatures(raw);
    // Store the parsed answer in the server's own shape, so a later read goes through the same fail-closed parser.
    await io.write(JSON.stringify({ panic: features.panic, insights: features.insights, share: features.share, insights_hidden: features.insightsHidden })).catch(() => undefined);
    return features;
  } catch {
    try {
      const saved = await io.read();
      return saved === null ? NO_WELLBEING_FEATURES : parseWellbeingFeatures(JSON.parse(saved));
    } catch {
      return NO_WELLBEING_FEATURES;
    }
  }
}

export const featuresCacheKey = (patientId: string): string => `tarragon.wellbeingFeatures.v1.${patientId}`;

export function loadWellbeingFeatures(patientId: string): Promise<WellbeingFeatures> {
  return resolveWellbeingFeatures({
    fetchOpen: async () => {
      const { data, error } = await supabase.rpc("wellbeing_features_open");
      if (error) throw error;
      return data;
    },
    read: () => AsyncStorage.getItem(featuresCacheKey(patientId)),
    write: (v) => AsyncStorage.setItem(featuresCacheKey(patientId), v),
  });
}
