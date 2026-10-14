import { getProposedConfig } from "@tarragon/shared";
import { t, type Locale } from "@tarragon/i18n";

/**
 * The sharing and access-log settings (S09x). The live values are the active row of `my_health_config` in the database, which the functions
 * enforce; this is the app's mirror for what to OFFER (expiry choices, PIN length, session window). A test fails if the two drift.
 */
export interface SharingConfig {
  readonly default_expiry_hours: number;
  readonly max_expiry_hours: number;
  readonly expiry_options_hours: readonly number[];
  readonly pin_digits: number;
  readonly pin_max_misses: number;
  readonly one_session_window_minutes: number;
}

export function getSharingConfig(): SharingConfig {
  const value = getProposedConfig("my_health.sharing_and_access_log").value as unknown as { sharing: SharingConfig };
  return value.sharing;
}

export function getAccessLogPageSize(): number {
  const value = getProposedConfig("my_health.sharing_and_access_log").value as unknown as { access_log: { page_size: number } };
  return value.access_log.page_size;
}

/** "6 hours", "1 day", "7 days": whole days from 24 hours up. */
export function expiryLabel(hours: number, locale: Locale = "en"): string {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return t(days === 1 ? "share.expiry.days_one" : "share.expiry.days_other", locale, { count: String(days) });
  }
  return t(hours === 1 ? "share.expiry.hours_one" : "share.expiry.hours_other", locale, { count: String(hours) });
}
