import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

/**
 * S47a: water, sleep, mood and the inhaler log are behind the platform module `extended_observations` (born off, INV-14). The phone offers the entries
 * only when the switch is on. The last answer is remembered per account so the card still shows with no signal; an answer that was never learned is
 * "off" (fail closed), and the server and the database refuse the rows anyway while the switch is off.
 */
export const EXTENDED_OBSERVATIONS_KEY = "extended_observations";
const cacheKey = (userId: string) => `@tarragon/extended-observations/v1:${userId}`;

export async function readExtendedObservationsEnabled(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("platform_modules").select("is_enabled").eq("key", EXTENDED_OBSERVATIONS_KEY).maybeSingle();
    if (!error && data && typeof data.is_enabled === "boolean") {
      await AsyncStorage.setItem(cacheKey(userId), String(data.is_enabled)).catch(() => undefined);
      return data.is_enabled;
    }
  } catch {
    // fall through to the remembered answer
  }
  try {
    return (await AsyncStorage.getItem(cacheKey(userId))) === "true";
  } catch {
    return false;
  }
}
