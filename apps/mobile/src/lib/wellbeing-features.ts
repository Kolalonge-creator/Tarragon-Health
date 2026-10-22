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

/**
 * Did the server REFUSE this person (signed out, expired or invalid session, not allowed)? Only a 401 or 403, or an explicit authentication error,
 * counts. A 5xx (502, 503, 504 during an outage) or a network failure means the server could not be reached, and then the saved answer is used:
 * closing the calm tool because the server is down would take away help exactly when it is needed.
 */
export function isServerRefusal(res: { status?: number; error: { code?: string | null; message?: string | null } | null }): boolean {
  if (!res.error) return false;
  if (res.status === 401 || res.status === 403) return true;
  const code = res.error.code ?? "";
  if (/^PGRST30[0-3]$/.test(code) || code === "42501" || /^(invalid_jwt|bad_jwt|not_authenticated|no_authorization)$/i.test(code)) return true;
  return /jwt (expired|invalid)|invalid jwt|invalid token|not authenticated/i.test(res.error.message ?? "");
}

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
      // A refusal (401, 403, an authentication error) closes everything. Anything else (a 5xx outage, a network failure) falls back to the saved answer.
      if (isServerRefusal(res)) throw new FeatureRefusedError(res.error?.message ?? "refused");
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    read: () => AsyncStorage.getItem(featuresCacheKey(patientId)),
    write: (v) => AsyncStorage.setItem(featuresCacheKey(patientId), v),
  });
}
