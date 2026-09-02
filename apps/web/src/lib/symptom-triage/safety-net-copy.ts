import type { TriageCategory } from "@tarragon/symptom-triage-engine";

/**
 * Patient-facing "safest next step" copy (platform brief §37.8): a clear
 * action, never a diagnosis. "Based on what you've told us, you should seek
 * urgent medical assessment" — never "you probably have condition X."
 * Brand voice: warm, no fear-based urgency, no "WARNING:", no jargon.
 *
 * Every `safetyNetMessageKey` the engine can produce falls back to its
 * category's generic copy below, so the UI always has something correct to
 * show even for a key this file hasn't been given specific copy for yet —
 * SPECIFIC_SAFETY_NET_MESSAGE only needs to cover the keys worth a more
 * tailored line, not every key the config can ever produce.
 */
export const CATEGORY_SAFETY_NET_MESSAGE: Record<TriageCategory, string> = {
  emergency:
    "Based on what you've told us, please go to the nearest emergency department now, or call emergency services. Don't wait to hear back from us first.",
  urgent:
    "Based on what you've told us, you should be seen by a clinician soon. Our care team has been notified and will follow up with you.",
  routine:
    "Based on what you've told us, this is best followed up with a routine appointment — nothing suggests it needs to be seen right away.",
  self_management:
    "Based on what you've told us, this looks manageable with self-care and a bit of monitoring for now. If it changes or gets worse, come back and check again.",
};

const SPECIFIC_SAFETY_NET_MESSAGE: Partial<Record<string, string>> = {
  "redflag.headache.thunderclap_onset":
    "A sudden, severe headache like this needs to be checked urgently. Please go to the nearest emergency department now.",
  "redflag.headache.neuro_deficit":
    "New weakness, numbness, or confusion alongside a headache needs to be checked urgently. Please go to the nearest emergency department now.",
  "redflag.chest_pain.cardiac_pattern":
    "Chest pain with breathlessness, sweating, or arm/jaw pain needs to be checked urgently. Please go to the nearest emergency department now.",
  "redflag.breathlessness.spo2_low":
    "Your reported oxygen level needs urgent attention. Please go to the nearest emergency department now.",
  "headache.self_mild":
    "A mild headache like this often settles with rest, fluids, and an over-the-counter pain reliever if you'd normally use one.",
  "chest_pain.self_msk":
    "Pain that's worse when you press on your chest and has stayed stable for a day or more is often muscular — rest and an over-the-counter pain reliever, if you'd normally use one, is a reasonable next step.",
};

export function getSafetyNetMessage(safetyNetMessageKey: string, category: TriageCategory): string {
  return SPECIFIC_SAFETY_NET_MESSAGE[safetyNetMessageKey] ?? CATEGORY_SAFETY_NET_MESSAGE[category];
}
