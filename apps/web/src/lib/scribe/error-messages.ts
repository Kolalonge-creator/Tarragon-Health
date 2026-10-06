import { t } from "@tarragon/i18n";

const CONSENT_CODES = new Set(["consent_not_found", "consent_not_active", "consent_encounter_mismatch"]);

/**
 * The scribe function and actions fail with short codes (model_call_failed, consent_not_active, ...). A clinician should
 * never read those: consent problems get their own plain sentence, everything else falls back to "write the note yourself".
 */
export function scribeErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (CONSENT_CODES.has(message) || /consent is not active/i.test(message)) return t("scribe.error.consent", "en");
  return t("scribe.draft.failed", "en");
}
