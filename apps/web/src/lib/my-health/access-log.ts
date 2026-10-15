import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { en, t, type Locale, type MessageKey } from "@tarragon/i18n";

/** One row of `public.my_access_log()`. Who, when, what kind of thing. Never a value, a reason or a name of a medicine, condition or allergen. */
export interface AccessLogEntry {
  at: string;
  /** Unique per source row; with `at` it is the paging cursor, so rows that share a timestamp are never lost. */
  rid: string;
  /** One of the kinds below today; typed as a string because the server may add more. */
  kind: string;
  actor_label: string;
  actor_name: string | null;
  categories: string[];
  status: string | null;
  ends_at: string | null;
}

export type AccessLogResult = { ok: true; entries: AccessLogEntry[] } | { ok: false };

export interface AccessLogCursor {
  at: string;
  rid: string;
}

/**
 * Never throws: a failed read is `{ ok: false }` so the page can say so instead of showing an empty list that looks like "no one looked".
 * A row of a kind this build does not know is KEPT (describeEntry gives it a neutral title) rather than dropped, so a new kind added on the
 * server is never silently hidden and the page length still tells the caller whether another page exists.
 */
export async function fetchAccessLog(supabase: SupabaseClient<Database>, before?: AccessLogCursor): Promise<AccessLogResult> {
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

export function describeEntry(entry: AccessLogEntry, locale: Locale = "en"): DescribedEntry {
  const categoryName = (c: string) => {
    const key = `my_health.log.category.${c}` as MessageKey;
    // An unknown category falls back to a neutral word rather than show a key.
    return Object.hasOwn(en, key) ? t(key, locale) : t("my_health.log.category.record", locale);
  };
  const statusKey = entry.status ? (`my_health.log.status.${entry.status}` as MessageKey) : null;
  const status = statusKey && Object.hasOwn(en, statusKey) ? t(statusKey, locale) : null;
  return {
    title: Object.hasOwn(en, `my_health.log.kind.${entry.kind}`) ? t(`my_health.log.kind.${entry.kind}` as MessageKey, locale) : t("my_health.log.kind.other", locale),
    who: entry.actor_name ? `${entry.actor_name} (${entry.actor_label})` : entry.actor_label,
    what: entry.kind === "staff_record_opened" ? "" : t("my_health.log.what", locale, { what: entry.categories.map(categoryName).join(", ") }),
    status,
  };
}
