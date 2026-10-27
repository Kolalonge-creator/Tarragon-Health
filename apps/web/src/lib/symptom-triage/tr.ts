import { t, type MessageKey } from "@tarragon/i18n";
import type { Translate } from "@tarragon/symptom-triage-engine";

/** The catalogue as the engine package's injected translator. English only (D-14). */
export const tr: Translate = (key, params) => t(key as MessageKey, "en", params);
