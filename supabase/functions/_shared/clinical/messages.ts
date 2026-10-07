/**
 * Catalogue keys (in `@tarragon/i18n`) for each explanation code the engine can
 * return. The text itself lives in the catalogue so it can be translated and
 * reviewed; a test checks that every key here exists in English.
 */
export interface MessageKeys {
  readonly title: string;
  readonly body: string;
}

const keys = (stem: string): MessageKeys => ({ title: `${stem}.title`, body: `${stem}.body` });

export const TRIAGE_MESSAGE_KEYS: Readonly<Record<string, MessageKeys>> = {
  "EMG-001": keys("triage.emg_001"),
  "EMG-001L": keys("triage.emg_001l"),
  "TRI-001": keys("triage.tri_001"),
  "TRI-002": keys("triage.tri_002"),
  "TRI-003": keys("triage.tri_003"),
  "TRI-005": keys("triage.tri_005"),
  "TRI-006": keys("triage.tri_006"),
  "notify.triage.task_created": keys("notify.triage.task_created"),
};

/** The catalogue keys for an explanation code, or null for a code with no message. */
export const messageKeyFor = (code: string | null): MessageKeys | null => (code === null ? null : (TRIAGE_MESSAGE_KEYS[code] ?? null));
