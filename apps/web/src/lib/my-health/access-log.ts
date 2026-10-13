import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { en, t, type Locale, type MessageKey } from "@tarragon/i18n";

/** One row of `public.my_access_log()`. Who, when, what kind of thing. Never a value, a reason or a name of a medicine, condition or allergen. */
export interface AccessLogEntry {
  at: string;
  kind:
    | "share_opened"
    | "share_pin_wrong"
    | "share_locked"
    | "emergency_card_opened"
    | "emergency_access_grant"
    | "emergency_record_access"
    | "delegated_access"
    | "staff_record_opened";
  actor_label: string;
  actor_name: string | null;
  categories: string[];
  status: string | null;
  ends_at: string | null;
}

const KINDS = new Set<string>([
  "share_opened",
  "share_pin_wrong",
  "share_locked",
  "emergency_card_opened",
  "emergency_access_grant",
  "emergency_record_access",
  "delegated_access",
  "staff_record_opened",
]);

export type AccessLogResult = { ok: true; entries: AccessLogEntry[] } | { ok: false };

/** Never throws: a failed read is `{ ok: false }` so the page can say so instead of showing an empty list that looks like "no one looked". */
export async function fetchAccessLog(supabase: SupabaseClient<Database>, before?: string): Promise<AccessLogResult> {
  const { data, error } = await supabase.rpc("my_access_log", before ? { p_before: before } : {});
  if (error || !Array.isArray(data)) return { ok: false };
  const entries = (data as unknown[]).filter(
    (e): e is AccessLogEntry => typeof e === "object" && e !== null && typeof (e as AccessLogEntry).at === "string" && KINDS.has((e as AccessLogEntry).kind),
  );
  return { ok: true, entries };
}

export interface DescribedEntry {
  title: string;
  who: string;
  what: string;
  status: string | null;
}

export function describeEntry(entry: AccessLogEntry, locale: Locale = "en"): DescribedEntry {
  const categoryName = (c: string) => {
    const key = `my_health.log.category.${c}` as MessageKey;
    // An unknown category falls back to a neutral word rather than show a key.
    return Object.hasOwn(en, key) ? t(key, locale) : t("my_health.log.category.record", locale);
  };
  const statusKey = entry.status ? (`my_health.log.status.${entry.status}` as MessageKey) : null;
  const status = statusKey && Object.hasOwn(en, statusKey) ? t(statusKey, locale) : null;
  return {
    title: t(`my_health.log.kind.${entry.kind}` as MessageKey, locale),
    who: entry.actor_name ? `${entry.actor_name} (${entry.actor_label})` : entry.actor_label,
    what: t("my_health.log.what", locale, { what: entry.categories.map(categoryName).join(", ") }),
    status,
  };
}
