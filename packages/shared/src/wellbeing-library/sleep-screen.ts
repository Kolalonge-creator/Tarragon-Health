/**
 * The snoring and daytime sleepiness questionnaire (S57, function 10.11). Item ids only: the wording lives in i18n (`sleep.screen.*`)
 * and the points and cut-off live in the server's active `sleep_apnoea_screen_config` (PROPOSED, DRAFT, unsigned until the CMO confirms).
 * The client never scores and never decides a result; it shows the server's answer, and only when the server says the instrument is signed.
 */
export const SLEEP_SCREEN_ITEM_IDS = ["snoring", "tired", "observed_pauses", "high_blood_pressure", "bmi_over_35", "age_over_50", "neck_large", "sex_male"] as const;
export type SleepScreenItemId = (typeof SLEEP_SCREEN_ITEM_IDS)[number];
export type SleepScreenAnswer = "yes" | "no" | "unsure";

export interface SleepScreenResult {
  readonly saved: boolean;
  readonly show_result: boolean;
  readonly cut_off_met: boolean | null;
  readonly unsure_count: number;
}

/** Which of the result messages to show. An unsigned instrument shows only that the answers were saved. */
export function sleepScreenMessageKey(r: SleepScreenResult): "sleep.screen.saved_only" | "sleep.screen.talk_to_care_team" | "sleep.screen.nothing_flagged" {
  if (!r.show_result || r.cut_off_met === null) return "sleep.screen.saved_only";
  return r.cut_off_met ? "sleep.screen.talk_to_care_team" : "sleep.screen.nothing_flagged";
}
