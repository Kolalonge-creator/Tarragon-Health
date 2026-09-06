import { DANGER_SIGNS, type DangerSign } from "@/lib/validation/emergency";

/**
 * Keyword phrases for each fixed DANGER_SIGNS value (lib/validation/emergency.ts)
 * — §24.7's "clinical vs non-clinical support" rule: a support ticket whose
 * free text reads like a real emergency must route to the existing
 * emergency pathway (emergency_events, source='support_ticket_intake')
 * instead of becoming an ordinary ticket. Deliberately matches against the
 * SAME fixed vocabulary the one-touch danger-symptom check uses, rather
 * than inventing a second taxonomy, so both paths raise the identical
 * emergency-tier clinician_alert. This is intentionally a small, precise
 * phrase list, not a general symptom classifier — a false negative here
 * still leaves the patient able to describe the same thing to a human via
 * the ticket, while a false positive just shows the emergency banner one
 * extra time.
 */
const DANGER_SIGN_KEYWORDS: Record<DangerSign, string[]> = {
  chest_pain: ["chest pain", "chest pressure", "tight chest", "chest hurts"],
  trouble_breathing: ["can't breathe", "cant breathe", "trouble breathing", "difficulty breathing", "short of breath", "shortness of breath"],
  face_arm_weakness_or_slurred_speech: ["slurred speech", "face drooping", "one side of my face", "arm weakness", "can't move my arm", "cant move my arm"],
  severe_bleeding: ["severe bleeding", "won't stop bleeding", "wont stop bleeding", "bleeding a lot"],
  fainting_or_unresponsive: ["fainted", "passed out", "unresponsive", "lost consciousness"],
  seizure: ["seizure", "convulsion", "convulsing"],
  severe_allergic_reaction: ["throat is closing", "throat tightening", "can't swallow", "cant swallow", "severe allergic reaction", "anaphylaxis"],
  thoughts_of_self_harm: ["harm myself", "hurt myself", "kill myself", "end my life", "suicidal"],
  sudden_severe_headache: ["worst headache", "sudden severe headache", "sudden, severe headache"],
  severe_abdominal_pain: ["severe stomach pain", "severe abdominal pain", "unbearable stomach pain"],
};

/**
 * Scans free text (a draft support-ticket subject+description) for the
 * fixed danger-sign vocabulary. Returns the matched signs, or an empty
 * array if none matched — never throws, never blocks ticket creation on
 * its own (the caller decides what to do with a match).
 */
export function detectDangerSigns(text: string): DangerSign[] {
  const normalised = text.toLowerCase();
  return DANGER_SIGNS.filter((sign) => DANGER_SIGN_KEYWORDS[sign].some((phrase) => normalised.includes(phrase)));
}
