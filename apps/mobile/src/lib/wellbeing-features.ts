import AsyncStorage from "@react-native-async-storage/async-storage";
import { NO_WELLBEING_FEATURES, featuresToRaw, getProposedConfig, parseWellbeingFeatures, type WellbeingFeatures } from "@tarragon/shared";
import { supabase } from "@/lib/supabase";

/**
 * Which of the S56b wellbeing features are open for this person (public.wellbeing_features_open), with the last good answer kept on the phone so
 * the calm tool still opens with no signal. Every flag fails CLOSED.
 *
 * Rules for the saved answer (config wellbeing.features_cache):
 *   - it is only used when the phone could not REACH the server (a network failure). An answer the server gave back as a refusal, for example an
 *     expired session, closes everything and is never papered over by the saved copy;
 *   - a saved CLOSED answer can only ever give closed (it is never turned into an open one);
 *   - a saved OPEN answer for the share and patterns features is trusted for offline_trust_days and then ignored;
 *   - the calm tool is the documented exception: a saved "open" is kept for it with no limit, because losing a grounding exercise while offline
 *     is the harm; it needs no server and shows no data. The server's next real answer replaces it.
 * The saved answer is per person (several people can use one phone) and is only an answer to "is this open", never wellbeing data.
 */
export class FeatureRefusedError extends Error {}

export interface FeatureIO {
  fetchOpen(): Promise<unknown>;
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  now?(): number;
}

interface Saved { savedAt: number; raw: unknown }

export async function resolveWellbeingFeatures(io: FeatureIO, trustDays: number = getProposedConfig<{ offline_trust_days: number }>("wellbeing.features_cache").value.offline_trust_days): Promise<WellbeingFeatures> {
  const now = io.now ? io.now() : Date.now();
  try {
    const raw = await io.fetchOpen();
    const features = parseWellbeingFeatures(raw);
    await io.write(JSON.stringify({ savedAt: now, raw: featuresToRaw(features) } satisfies Saved)).catch(() => undefined);
    return features;
  } catch (e) {
    if (e instanceof FeatureRefusedError) return NO_WELLBEING_FEATURES;
    try {
      const text = await io.read();
      if (text === null) return NO_WELLBEING_FEATURES;
      const saved = JSON.parse(text) as Partial<Saved>;
      const f = parseWellbeingFeatures(saved.raw);
      const savedAt = typeof saved.savedAt === "number" ? saved.savedAt : 0;
      const fresh = now - savedAt <= trustDays * 86_400_000;
      // the calm tool keeps its saved answer (see above); everything else needs a fresh one
      return fresh ? f : { ...NO_WELLBEING_FEATURES, panic: f.panic };
    } catch {
      return NO_WELLBEING_FEATURES;
    }
  }
}

export const featuresCacheKey = (patientId: string): string => `tarragon.wellbeingFeatures.v2.${patientId}`;

export function loadWellbeingFeatures(patientId: string): Promise<WellbeingFeatures> {
  return resolveWellbeingFeatures({
    fetchOpen: async () => {
      const res = await supabase.rpc("wellbeing_features_open");
      // The server answered with a refusal (an error code or an HTTP error status, for example an expired session): that closes everything. An
      // error with neither is the phone failing to reach the server, and only that may fall back to the saved answer.
      if (res.error && (res.error.code || res.status >= 400)) throw new FeatureRefusedError(res.error.message);
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    read: () => AsyncStorage.getItem(featuresCacheKey(patientId)),
    write: (v) => AsyncStorage.setItem(featuresCacheKey(patientId), v),
  });
}
