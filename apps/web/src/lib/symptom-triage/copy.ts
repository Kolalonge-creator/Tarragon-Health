import type { TriageCategory } from "./types";

/**
 * Patient-facing copy for every safetyNetMessageKey the active protocol can
 * produce. The protocol config carries only the KEY (clinical content is
 * the signed protocol's job); the words a patient actually reads are
 * authored here, in brand voice -- warm, no fear-based urgency, never
 * "WARNING:" (CLAUDE.md Brand section). Never claims a diagnosis; every
 * message ends by naming the next real step rather than leaving the
 * patient to guess.
 */
export const SAFETY_NET_COPY: Record<string, string> = {
  "headache.self_mild":
    "This sounds like a mild headache without anything concerning alongside it. Rest, water, and your usual approach should help -- if it changes or doesn't ease up, log it again or message your care team.",
  "headache.urgent_severe":
    "A headache this severe is worth a doctor looking at soon, even without a specific red flag today. We've let your care team know so they can follow up promptly.",
  "headache.routine_frequent":
    "Headaches this often are worth a proper look at what might be triggering them and how to manage them better -- we've queued this for a routine review with your care team.",
  "headache.routine_moderate":
    "A headache that's slowing you down like this is worth going over with your care team at a routine visit, so you have a plan for next time too.",
  "headache.urgent_worsening":
    "A headache that keeps getting worse, or wakes you from sleep, is worth a doctor checking soon. We've let your care team know so they can follow up promptly.",
  "chest_pain.self_msk":
    "This sounds like pain from the chest wall rather than your heart -- stable, reproducible when you press or move. Rest and your usual pain relief should help; message your care team if it changes.",
  "chest_pain.urgent_new":
    "New chest pain like this deserves a doctor's assessment soon, even without a clear explanation yet. We've let your care team know so they can follow up promptly.",
  "chest_pain.routine_msk":
    "Chest wall pain like this is usually not serious, but worth a routine check with your care team, especially since it's new or changing.",
  "chest_pain.routine_general":
    "This sounds like something worth going over at a routine visit with your care team, so they can help figure out what's behind it.",
  "chest_pain.urgent_exertional":
    "Pain that comes on with exercise and eases with rest is worth a doctor checking soon. We've let your care team know so they can follow up promptly.",
  "breathlessness.self_mild":
    "This sounds like mild, stable breathlessness. Keep an eye on it and message your care team if it changes or you're worried.",
  "breathlessness.urgent_worsening":
    "Breathlessness that keeps getting worse over a few days is worth a doctor checking soon. We've let your care team know so they can follow up promptly.",
  "breathlessness.routine_exertional":
    "Breathlessness that only shows up with exertion and eases with rest is worth going over with your care team at a routine visit.",
  "generic.fallback_review":
    "We weren't able to work out a clear next step from your answers, so we've sent this to your care team to look at directly rather than guess.",
  "generic.red_flag":
    "What you've described needs attention right now. Please call emergency services or go to the nearest hospital -- we've also let your care team know so they can follow up. This isn't a diagnosis, just a precaution.",
};

/** Falls back to a category-level default when a specific key isn't in the
 * dictionary yet (a newer protocol version can add pathways/outcomes this
 * dictionary hasn't caught up with) -- never renders nothing. */
const CATEGORY_FALLBACK: Record<TriageCategory, string> = {
  emergency: SAFETY_NET_COPY["generic.red_flag"],
  urgent: "This is worth a doctor checking soon. We've let your care team know so they can follow up promptly.",
  routine: "This is worth going over with your care team at a routine visit.",
  self_management:
    "This sounds manageable on your own for now -- message your care team if it changes or you're worried.",
};

export function safetyNetCopyFor(safetyNetMessageKey: string, category: TriageCategory): string {
  return SAFETY_NET_COPY[safetyNetMessageKey] ?? CATEGORY_FALLBACK[category];
}
