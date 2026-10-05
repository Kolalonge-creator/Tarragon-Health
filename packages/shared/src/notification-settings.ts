/** Pure helpers for the quiet hours and discreet mode settings, shared by the web card and the phone card. */
export interface NotificationSettingsValue {
  readonly quietEnabled: boolean;
  readonly quietStart: string; // "HH:MM"
  readonly quietEnd: string;
  readonly discreet: boolean;
}

/** The values used when a person has no saved row. Mirrors `notification_rules_config` v1 (notifications.rules). */
export const DEFAULT_SETTINGS: NotificationSettingsValue = { quietEnabled: true, quietStart: "21:00", quietEnd: "07:00", discreet: false };

/** "7:5", "07:05:00" and "07:05" all become "07:05"; anything else is null. */
export function normaliseTime(input: string): string | null {
  const m = /^(\d{1,2}):(\d{1,2})(?::\d{2})?$/.exec(input.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export type SettingsError = "times";

/** Two valid, different times (the database refuses equal times too). */
export function validateSettings(v: NotificationSettingsValue): SettingsError | null {
  const a = normaliseTime(v.quietStart);
  const b = normaliseTime(v.quietEnd);
  return a === null || b === null || a === b ? "times" : null;
}

/** A saved row (database time strings) to the form value; no row means the defaults. */
export function fromRow(
  row: { quiet_enabled: boolean; quiet_start: string; quiet_end: string } | null | undefined,
  discreet: boolean | null | undefined,
): NotificationSettingsValue {
  const base = row
    ? { quietEnabled: row.quiet_enabled, quietStart: normaliseTime(row.quiet_start) ?? DEFAULT_SETTINGS.quietStart, quietEnd: normaliseTime(row.quiet_end) ?? DEFAULT_SETTINGS.quietEnd }
    : { quietEnabled: DEFAULT_SETTINGS.quietEnabled, quietStart: DEFAULT_SETTINGS.quietStart, quietEnd: DEFAULT_SETTINGS.quietEnd };
  return { ...base, discreet: discreet === true };
}
