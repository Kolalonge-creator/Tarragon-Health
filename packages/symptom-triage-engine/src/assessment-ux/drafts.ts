/**
 * S59c: the four DRAFT configs, as shipped. ALL UNSIGNED. `status: "draft"` and `clinical_sign_off: null` on every one, so every feature
 * built on them is inert until the Chief Medical Officer signs a version through `sign_symptom_ux_config`. This file signs nothing and an
 * agent must never edit `status` or `clinical_sign_off` here: a signature is a human decision made in the database, and the signed text is
 * then copied back into this file (and into the registry) in the same commit, which the drift tests enforce.
 *
 * Three copies of each config must stay identical, and tests fail if they do not:
 *   1. this file (the copy the web and phone bundle, so the screens work offline),
 *   2. the PROPOSED registry entry in `packages/shared` (`symptom.checkback`, `symptom.describe_synonyms`, `symptom.result_explainer`,
 *      `symptom.safety_net`),
 *   3. the seed in `supabase/migrations/*_s59c_assessment_ux.sql` (`symptom_ux_config`, version 1, inactive).
 *
 * This file has no imports on purpose: it is written as plain data so a script can print it as JSON for the other two copies.
 *
 * WHERE THE WORDS COME FROM. The explainer reasons and the safety-net trigger lines restate the signed v1 red-flag rules and the
 * rationale already written on each signed outcome, in plain words. They add no clinical rule of their own. They have NOT been reviewed
 * by a clinician, and the lines for "other" pathways (fever, abdominal pain) are deliberately absent until those pathways are signed.
 * Wording is English only (D-14); the describe table keeps to plain English and common Nigerian English ("my body is hot", "my head is
 * paining me"). It carries no Pidgin.
 */

export const CHECKBACK_DRAFT = {
  version: 1,
  status: "draft",
  clinical_sign_off: null,
  provenance: {
    source: "docs/design/S59c.md section 2",
    note: "Agent-proposed timing for the CMO. Delays and the nudge rule are product choices, not clinical thresholds. Not reviewed by a clinician.",
  },
  categories: {
    self_management: { delay_hours: 48, same_nudge_after_hours: 72 },
    routine: { delay_hours: 24, same_nudge_after_hours: 24 },
  },
  expire_after_hours: 48,
  nudge_after_hours: 12,
  max_nudges: 1,
  notification_window: { start_hour: 7, end_hour: 21 },
};

export const DESCRIBE_DRAFT = {
  version: 1,
  status: "draft",
  clinical_sign_off: null,
  provenance: {
    source: "docs/design/S59c.md section 3",
    note: "Agent-proposed routing words. A wrong route only changes which questions are asked: the red-flag floor runs over every answer either way. Not reviewed by a clinician or a Nigerian-English speaker.",
  },
  min_score: 2,
  ambiguity_margin: 2,
  danger_event_min_gap_minutes: 30,
  entries: [
    { id: "headache_clear", pathway_key: "headache", weight: 2, phrases: ["headache*", "head ache", "head pain", "migraine*", "pain in my head", "pain in the head", "my head hurts", "head hurts", "head is hurting", "head is paining", "my head is paining me", "head is pounding", "pounding head", "throbbing head"] },
    { id: "headache_hint", pathway_key: "headache", weight: 1, phrases: ["head feels heavy", "heavy head", "sore head"] },
    { id: "chest_pain_clear", pathway_key: "chest_pain", weight: 2, phrases: ["chest pain*", "chest ache", "pain in my chest", "pain in the chest", "chest hurts", "chest is hurting", "chest is paining", "my chest is paining me", "chest paining", "heart pain", "pain around my heart"] },
    { id: "chest_pain_hint", pathway_key: "chest_pain", weight: 1, phrases: ["chest feels heavy", "heavy chest", "sore chest", "chest discomfort"] },
    { id: "breathlessness_clear", pathway_key: "breathlessness", weight: 2, phrases: ["breathless*", "short of breath", "shortness of breath", "difficulty breathing", "difficulty in breathing", "trouble breathing", "hard to breathe", "cannot catch my breath", "can't catch my breath", "out of breath", "panting", "wheez*"] },
    { id: "breathlessness_hint", pathway_key: "breathlessness", weight: 1, phrases: ["breathing is heavy", "breathing fast", "breathing hard", "chest is tight"] },
    { id: "fever_clear", pathway_key: "fever", weight: 2, phrases: ["fever*", "feverish", "high temperature", "my body is hot", "body is hot", "body hot", "hot body", "feeling hot", "chills", "shivering"] },
    { id: "fever_hint", pathway_key: "fever", weight: 1, phrases: ["temperature", "sweating at night"] },
    { id: "abdominal_pain_clear", pathway_key: "abdominal_pain", weight: 2, phrases: ["stomach pain*", "stomach ache", "stomach is paining", "my stomach is paining me", "belly pain", "belly ache", "belly is paining", "tummy pain", "tummy ache", "abdominal pain", "pain in my stomach", "pain in my belly", "cramps"] },
    { id: "abdominal_pain_hint", pathway_key: "abdominal_pain", weight: 1, phrases: ["stomach feels", "bloated", "upset stomach"] },
  ],
};

const HEADACHE_SOONER = [
  "the pain comes on suddenly and is very strong",
  "you have new weakness, numbness or confusion",
  "you lose some of your vision",
  "you get a fever with a stiff neck",
];
const CHEST_SOONER = [
  "the pain comes with breathlessness, sweating, or pain in your arm or jaw",
  "the pain starts suddenly and is very strong",
  "you faint",
];
const BREATH_SOONER = [
  "the breathlessness comes on suddenly and is severe even at rest",
  "you cannot finish a sentence",
  "you have chest pain with it",
  "one leg swells up",
];

export const EXPLAINER_DRAFT = {
  version: 1,
  status: "draft",
  clinical_sign_off: null,
  provenance: {
    source: "docs/design/S59c.md section 4",
    note: "Plain-words restatement of the signed v1 red-flag rules and the rationale on each signed outcome. No new clinical rule. Not reviewed by a clinician.",
  },
  entries: [
    { id: "rule:headache.thunderclap_onset", reason: "You told us the headache came on suddenly and is very strong. A sudden, very strong headache is one of the signs this check treats as serious." },
    { id: "rule:headache.neuro_deficit", reason: "You told us you have new weakness, numbness or confusion with the headache. Those are signs this check treats as serious." },
    { id: "rule:headache.meningitic_signs", reason: "You told us you have a fever and a stiff neck with the headache. Together they are signs this check treats as serious." },
    { id: "rule:headache.vision_loss", reason: "You told us you have lost some vision with the headache. That is a sign this check treats as serious." },
    { id: "rule:headache.recent_head_injury", reason: "You told us the headache followed a recent knock to the head and is quite strong. That is a sign this check treats as serious." },
    { id: "rule:headache.immunocompromised_new_severe", reason: "You told us about something in your health history that makes a strong headache worth a prompt look." },
    { id: "rule:headache.pregnancy_severe", reason: "You told us about something in your health history that makes a strong headache worth a prompt look." },
    { id: "rule:chest_pain.cardiac_pattern", reason: "You told us the chest pain comes with breathlessness, sweating, or pain in your arm or jaw. Together they are signs this check treats as serious." },
    { id: "rule:chest_pain.sudden_severe_tearing", reason: "You told us the chest pain started suddenly and is very strong. That is a sign this check treats as serious." },
    { id: "rule:chest_pain.syncope", reason: "You told us you fainted with the chest pain. That is a sign this check treats as serious." },
    { id: "rule:chest_pain.known_cardiac_history", reason: "You told us about something in your health history that makes chest pain worth checking straight away." },
    { id: "rule:breathlessness.severe_sudden", reason: "You told us the breathlessness came on suddenly and is severe even at rest. That is a sign this check treats as serious." },
    { id: "rule:breathlessness.spo2_low", reason: "You told us your oxygen reading was low. That is a sign this check treats as serious." },
    { id: "rule:breathlessness.chest_pain", reason: "You told us you have chest pain with the breathlessness. Together they are signs this check treats as serious." },
    { id: "rule:breathlessness.cannot_complete_sentences", reason: "You told us you are too breathless to finish a sentence. That is a sign this check treats as serious." },
    { id: "rule:breathlessness.unilateral_leg_swelling", reason: "You told us one leg is swollen along with the breathlessness. Together they are signs this check treats as serious." },
    { id: "outcome:headache.urgent_worsening", reason: "Your answers show a headache that is getting worse or waking you from sleep. This check asks for a prompt look at a headache that follows that pattern.", tell_us_sooner_if: HEADACHE_SOONER },
    { id: "outcome:headache.routine_frequent", reason: "Your answers show headaches that come often. This check suggests a routine appointment to look at the pattern.", tell_us_sooner_if: HEADACHE_SOONER },
    { id: "outcome:headache.self_mild", reason: "Your answers show a mild headache with none of the warning signs on this check's list. That is why it suggests looking after yourself and keeping an eye on it.", tell_us_sooner_if: HEADACHE_SOONER },
    { id: "outcome:headache.routine_moderate", reason: "Your answers show a headache that is slowing you down, with none of the warning signs on this check's list. This check suggests a routine appointment.", tell_us_sooner_if: HEADACHE_SOONER },
    { id: "outcome:headache.urgent_severe", reason: "Your answers show severe pain without a clear reason from the questions asked. This check asks for a prompt look.", tell_us_sooner_if: HEADACHE_SOONER },
    { id: "outcome:chest_pain.urgent_exertional", reason: "Your answers show chest pain that comes on with effort. This check asks for a prompt look at that pattern.", tell_us_sooner_if: CHEST_SOONER },
    { id: "outcome:chest_pain.self_msk", reason: "Your answers show chest pain that changes when you press on it and has stayed steady, with none of the warning signs on this check's list. That is why it suggests looking after yourself and keeping an eye on it.", tell_us_sooner_if: CHEST_SOONER },
    { id: "outcome:chest_pain.routine_msk", reason: "Your answers show chest pain that changes when you press on it and is new or changing. This check suggests a routine appointment.", tell_us_sooner_if: CHEST_SOONER },
    { id: "outcome:chest_pain.urgent_new", reason: "Your answers show new chest pain, under an hour old, without a clear pattern. This check asks for a prompt look.", tell_us_sooner_if: CHEST_SOONER },
    { id: "outcome:chest_pain.routine_general", reason: "Your answers show chest pain lasting several hours or longer, with none of the warning signs on this check's list. This check suggests a routine appointment.", tell_us_sooner_if: CHEST_SOONER },
    { id: "outcome:breathlessness.routine_exertional", reason: "Your answers show breathlessness that comes with effort and eases with rest. This check suggests a routine appointment.", tell_us_sooner_if: BREATH_SOONER },
    { id: "outcome:breathlessness.urgent_worsening", reason: "Your answers show breathlessness that has been getting worse over days. This check asks for a prompt look.", tell_us_sooner_if: BREATH_SOONER },
    { id: "outcome:breathlessness.self_mild", reason: "Your answers show mild, steady breathlessness with none of the warning signs on this check's list. That is why it suggests looking after yourself and keeping an eye on it.", tell_us_sooner_if: BREATH_SOONER },
  ],
};

export const SAFETY_NET_DRAFT = {
  version: 1,
  status: "draft",
  clinical_sign_off: null,
  provenance: {
    source: "docs/design/S59c.md section 5",
    note: "Plain-words restatement of the signed v1 red-flag rules of each pathway. No new clinical rule and no phone number. Not reviewed by a clinician.",
  },
  // 112 is recorded for the CMO to confirm; it is shown only when the config is signed AND confirmed is true (OQ-87, OQ-S59c-04).
  emergency_number: { value: "112", confirmed: false },
  entries: [
    {
      id: "headache_all",
      pathway_key: "headache",
      category: "*",
      triggers: [
        "the headache comes on suddenly and is very strong",
        "you have new weakness, numbness or confusion",
        "you lose some of your vision",
        "you have a fever and a stiff neck",
        "the headache follows a knock to the head",
      ],
    },
    {
      id: "chest_pain_all",
      pathway_key: "chest_pain",
      category: "*",
      triggers: [
        "the pain comes with breathlessness, sweating, or pain in your arm or jaw",
        "the pain starts suddenly and is very strong",
        "you faint",
      ],
    },
    {
      id: "breathlessness_all",
      pathway_key: "breathlessness",
      category: "*",
      triggers: [
        "the breathlessness comes on suddenly and is severe even at rest",
        "you cannot finish a sentence",
        "you have chest pain with it",
        "one leg swells up",
      ],
    },
  ],
};
