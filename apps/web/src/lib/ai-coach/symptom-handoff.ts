/**
 * S51 (spec 7.6): when a patient describes NEW symptoms the assistant hands them to the symptom checker; it does not assess them itself.
 * The model classifies `suggestedAction`, and this deterministic check is a floor under it: if the message plainly describes symptoms
 * and the model said nothing, the action is still set. No model, no network. Over-offering a link to the checker is the accepted failure.
 *
 * Emergency wording never reaches this (the red-flag screen runs first and stops the turn).
 */
const SYMPTOM_WORDS = [
  "pain", "ache", "aching", "hurts", "hurting", "cough", "coughing", "fever", "feverish", "headache", "dizzy", "dizziness", "nausea", "nauseous",
  "vomit", "vomiting", "diarrhoea", "diarrhea", "rash", "itch", "itching", "swelling", "swollen", "sore throat", "blurred", "blurry", "tired all the time",
  "weak", "weakness", "bloated", "cramps", "cramping", "short of breath", "breathless", "palpitations", "burning when", "discharge", "lump",
  "loss of appetite", "weight loss", "night sweats", "numb", "tingling", "chills",
];

const ONSET_WORDS = [
  "since yesterday", "since this morning", "for a few days", "for two days", "for three days", "for a week", "for days", "started", "began", "just noticed",
  "keep getting", "keep having", "i have been having", "i've been having", "i've had", "i have had", "woke up with", "suddenly", "new ", "all of a sudden",
  "i feel", "i am feeling", "i'm feeling", "i am having", "i'm having",
];

/** Questions about what a symptom IS, or about the patient's own existing record, are not a request to assess new symptoms. */
const NOT_NEW = ["what is", "what does", "what are", "explain my", "my results", "my reading", "my last", "my record"];

export function describesNewSymptoms(message: string): boolean {
  const m = message.toLowerCase().replace(/[‘’]/g, "'");
  if (NOT_NEW.some((p) => m.includes(p)) && !ONSET_WORDS.some((p) => m.includes(p))) return false;
  const hasSymptom = SYMPTOM_WORDS.some((w) => m.includes(w));
  const hasOnset = ONSET_WORDS.some((w) => m.includes(w));
  return hasSymptom && hasOnset;
}
