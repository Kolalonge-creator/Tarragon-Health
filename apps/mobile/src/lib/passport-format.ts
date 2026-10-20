import { t } from "@tarragon/i18n";

/** "20 Oct 2026" in Lagos time, or "" for a value that is not a date. Never throws. */
export function formatPassportDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/** "20 Oct 2026, 14:05" in Lagos time. */
export function formatPassportDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * The one line a screen shows above a copy it could not refresh. It says why (no connection, or a failed refresh) and when the copy was
 * saved, and never claims the copy is current.
 */
export function staleNotice(offline: boolean, savedAt: string | null): string {
  const when = formatPassportDateTime(savedAt);
  if (offline) return when ? t("mpass.stale_offline", "en", { when }) : t("mpass.stale_offline_unknown");
  return when ? t("mpass.stale_error", "en", { when }) : t("mpass.stale_error_unknown");
}

/** What to say when there is no live read and no saved copy. A lost connection is not an empty record. */
export function failedLoadMessage(offline: boolean): string {
  return offline ? t("mpass.offline_empty") : t("mpass.load_failed");
}
