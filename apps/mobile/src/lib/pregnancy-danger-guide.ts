import { PREGNANCY_DANGER_SIGN_LABEL, PREGNANCY_DANGER_SIGNS, type PregnancyDangerSign } from "./womens-health";

/**
 * The offline danger-sign guide (spec 16.8, INV-06). Bundled in the app as plain data so it opens with no signal and no login lock.
 * The signs are the app's own list (the same list the pregnancy red-flag check sends to the care team); this file only adds the
 * fixed "what to do" line, which never tells anyone to wait. Wording is draft pending CMO review (OQ-343); the audio slot is the S32
 * manifest clip id, or null when there is no recording yet (the text is always shown).
 */
export interface DangerGuideEntry {
  sign: PregnancyDangerSign;
  label: string;
  /** S32 audio manifest clip id; null until a signed recording exists. */
  audioClipId: string | null;
}

/** The only action line the guide gives. */
export const DANGER_GUIDE_ACTION = "Go to your nearest health facility now, or contact your care team.";

export const DANGER_GUIDE_REVIEW_STATE = "draft_pending_cmo" as const;

export function pregnancyDangerGuide(): readonly DangerGuideEntry[] {
  return PREGNANCY_DANGER_SIGNS.map((sign) => ({ sign, label: PREGNANCY_DANGER_SIGN_LABEL[sign], audioClipId: null }));
}
