import { t } from "@tarragon/i18n";

/**
 * S47d: the database refuses a write to a reproductive health, mental health or device data table when the person has not said yes (error text
 * `consent_required:<type>`). A server action that passes the raw database message to the screen would show that code to a person. This turns it into a plain
 * sentence, and leaves every other message alone.
 */
export function friendlyDbError(message: string | undefined | null): string {
  const text = message ?? "";
  const match = /consent_required:(reproductive|mental_health|device_data)/.exec(text);
  if (match) return t(`consent.feature.${match[1]}.ask` as Parameters<typeof t>[0]);
  return text;
}

export function isFeatureConsentError(message: string | undefined | null): boolean {
  return /consent_required:(reproductive|mental_health|device_data)/.test(message ?? "");
}
