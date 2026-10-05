import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

/**
 * The platform-wide Pidgin kill switch (`platform_switches.pidgin_language`,
 * flipped from the admin console), as the phone sees it.
 *
 * Off means English everywhere, signed in and signed out. A saved Pidgin choice
 * is never rewritten, so switching it back on restores it.
 *
 * Offline behaviour matters here: this app's patients are often on poor
 * connections, and a failed lookup must not strip Pidgin from someone while an
 * admin has it on. So a failed read falls back to the last value this phone
 * successfully saw; only a phone that has never seen the switch assumes on
 * (the state before the switch existed). The cost: a phone offline since before
 * an admin switched Pidgin off keeps showing Pidgin until it next connects.
 */
const STORAGE_KEY = "pidgin-switch-v1";
/** How long a read is trusted before the next screen mount asks again. */
export const PIDGIN_SWITCH_TTL_MS = 3 * 60 * 1000;

let cached: { value: Promise<boolean>; at: number } | null = null;

async function remember(value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, value ? "on" : "off");
  } catch {
    // Best effort: the in-memory value still applies this session.
  }
}

async function lastKnown(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return stored !== "off";
  } catch {
    return true;
  }
}

async function fetchEnabled(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("platform_switch_is_on", { p_key: "pidgin_language" });
    if (error || typeof data !== "boolean") return await lastKnown();
    await remember(data);
    return data;
  } catch {
    return await lastKnown();
  }
}

export function getPidginEnabled(): Promise<boolean> {
  if (!cached || Date.now() - cached.at > PIDGIN_SWITCH_TTL_MS) {
    cached = { value: fetchEnabled(), at: Date.now() };
  }
  return cached.value;
}

/** For tests, and after sign-in/out so the next read is fresh. */
export function clearPidginSwitchCache(): void {
  cached = null;
}

/** True until proven off, so a screen never flashes the language picker away on first paint. */
export function usePidginEnabled(): boolean {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    let active = true;
    void getPidginEnabled().then((v) => {
      if (active) setEnabled(v);
    });
    return () => {
      active = false;
    };
  }, []);
  return enabled;
}
