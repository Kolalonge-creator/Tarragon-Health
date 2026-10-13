import * as SecureStore from "expo-secure-store";
import { buildLockScreenPayload, type LockScreenFacts, type LockScreenPayload } from "@tarragon/shared";
import { en, t, type MessageKey } from "@tarragon/i18n";
import { supabase } from "./supabase";

/** One row of `public.my_access_log()`: who, when, what kind of thing. Never a value, a reason or a medicine, condition or allergen name. */
export interface AccessLogEntry {
  at: string;
  rid: string;
  kind: string;
  actor_label: string;
  actor_name: string | null;
  categories: string[];
  status: string | null;
  ends_at: string | null;
}

export type AccessLogResult = { ok: true; entries: AccessLogEntry[] } | { ok: false };

/** A failed read is `{ ok: false }`, never an empty list that would read as "no one has looked". */
export async function loadAccessLog(before?: { at: string; rid: string }): Promise<AccessLogResult> {
  const { data, error } = await supabase.rpc("my_access_log", before ? { p_before: before.at, p_before_id: before.rid } : {});
  if (error || !Array.isArray(data)) return { ok: false };
  const entries = (data as unknown[]).filter(
    (e): e is AccessLogEntry => typeof e === "object" && e !== null && typeof (e as AccessLogEntry).at === "string" && typeof (e as AccessLogEntry).rid === "string" && typeof (e as AccessLogEntry).kind === "string",
  );
  return { ok: true, entries };
}

export interface DescribedEntry {
  title: string;
  who: string;
  what: string;
  status: string | null;
}

export function describeAccessEntry(entry: AccessLogEntry): DescribedEntry {
  const known = (key: string): key is MessageKey => Object.hasOwn(en, key);
  const kindKey = `my_health.log.kind.${entry.kind}`;
  const categories = entry.categories.map((c) => {
    const key = `my_health.log.category.${c}`;
    return known(key) ? t(key) : t("my_health.log.category.record");
  });
  const statusKey = entry.status ? `my_health.log.status.${entry.status}` : null;
  return {
    title: known(kindKey) ? t(kindKey) : t("my_health.log.kind.other"),
    who: entry.actor_name ? `${entry.actor_name} (${entry.actor_label})` : entry.actor_label,
    what: entry.kind === "staff_record_opened" ? "" : t("my_health.log.what", "en", { what: categories.join(", ") }),
    status: statusKey && known(statusKey) ? t(statusKey) : null,
  };
}

/** The setting is cached per account, so a second person signing in on the same phone never inherits the first person's choice. */
const passKey = (userId: string) => `lock-screen-pass-enabled-v1-${userId}`;

export interface PassState {
  facts: LockScreenFacts;
  /** The version a phone or wallet may show: null until the patient turned it on AND the CMO signed the field list. */
  devicePayload: LockScreenPayload | null;
  /** The patient's own printable card: not held back by the signature. */
  cardPayload: LockScreenPayload | null;
}

export async function loadPassState(userId: string): Promise<{ ok: true; state: PassState } | { ok: false }> {
  const { data, error } = await supabase.rpc("my_lock_screen_facts");
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return { ok: false };
  const facts = data as LockScreenFacts;
  // Keep the device copy of the setting in step with the server, best effort. The server is the source of truth.
  SecureStore.setItemAsync(passKey(userId), facts.enabled === true ? "true" : "false").catch(() => {});
  return {
    ok: true,
    state: {
      facts,
      devicePayload: buildLockScreenPayload(facts, { requireSigned: true }),
      cardPayload: buildLockScreenPayload(facts, { requireSigned: false }),
    },
  };
}

/** The setting as last seen on this phone, for use before the network answers. Off when unknown. */
export async function loadCachedPassEnabled(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(passKey(userId))) === "true";
  } catch {
    return false;
  }
}

export async function setPassEnabled(enabled: boolean, userId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("set_lock_screen_pass", { p_enabled: enabled });
  if (error) return { error: error.message };
  SecureStore.setItemAsync(passKey(userId), enabled ? "true" : "false").catch(() => {});
  return {};
}
