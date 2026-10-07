/**
 * The deterministic red-flag screen for the AI assistant (S51, spec 7.8, INV-01, INV-06). It runs BEFORE any model call, so an
 * emergency message gets the fixed emergency guidance with no model in the path.
 *
 * ONE RULE SOURCE. The base is the same list the written-question screen and its database function use
 * (`WRITTEN_QUESTION_DANGER_PHRASES`, drift-tested against `private.screen_care_message_for_emergency`). The assistant adds to it and
 * never subtracts: `ASSISTANT_EXTRA_DANGER_PHRASES` are the wordings real patients use in a chat that the shorter written-question
 * list does not name (everything the assistant's old private regex list caught is folded in here, see the legacy regression test), and
 * `ASSISTANT_DANGER_PAIRS` are two words that together mean an emergency wherever they sit in the message ("my arm is numb").
 *
 * WORDS. A phrase or a pair word must START at a word boundary (a trailing `*` makes it a stem; a pair word is also closed at the end), so "arm" never matches
 * "pharmacy" or "warm", "numb" never matches "numbers" and "fitting" never matches "benefitting". A blood pressure patient who writes
 * "my numbers on my left arm" must not be told to go to hospital.
 *
 * The extras are PROPOSED wording, clinician-reviewed before go-live. Over-triggering is the accepted failure; under-triggering is not.
 * Adding a phrase here does not change the written-question list or its database function; the wider list for that path is a
 * separate, signed change (recorded in docs/OPEN-QUESTIONS.md).
 */
import { WRITTEN_QUESTION_DANGER_PHRASES } from "./written-question-screen";

const PRONOUNS = ["my", "his", "her", "their"] as const;
const END_VERBS = ["end", "ends", "ending", "ended"] as const;

export const ASSISTANT_EXTRA_DANGER_PHRASES: readonly string[] = [
  // chest
  "tight chest", "chest tight", "tightness in my chest", "tight in my chest", "pressure in my chest", "chest pressure", "crushing chest", "pain in my chest",
  // breathing
  "shortness of breath", "short of breath", "hard to breathe", "trouble breathing", "can not breathe", "cant breathe", "cannot breath", "can't breath", "gasping",
  // self-harm and suicide
  "suicid*", "wants to die", "wanted to die", "kill himself", "kill herself", "kill themselves",
  "don't want to live", "do not want to live", "cutting myself", "hurting myself", "harming myself", "hurt myself", "harm myself", "selfharm", "better off dead", "no reason to live", "end it all", "dont want to live", "take my own life", "taking my own life", "take his own life", "take her own life",
  ...END_VERBS.flatMap((v) => PRONOUNS.map((p) => `${v} ${p} life`)),
  // psychosis
  "hearing voices", "hear voices", "heard voices", "seeing things that aren't there", "seeing things that are not there",
  "see things that aren't there", "see things that are not there", "saw things that aren't there",
  "thoughts are not my own", "thoughts not my own", "thought is not my own", "thoughts aren't my own",
  // bleeding
  "bleeding a lot", "heavy bleeding",
  // stroke
  "face droop*", "droopy face", "slurring", "speech is slurred", "speech slurred", "sudden numbness", "numb arm", "arm numb", "numbness in my arm",
  "numbness in my face", "weak on one side", "weakness on one side", "weakness in one side",
  // loss of consciousness and seizure
  "fainted", "fainting", "blacked out", "black out", "not responding", "seizing", "having a fit", "convuls*", "seizures",
  // overdose
  "too many tablets", "too many pills", "too many of my tablets", "too many of my pills",
  // a dosing mistake already made is an urgent report, never a dose-change request ("can I double my dose" is a different sentence)
  "took double", "taken double", "took too much", "taken too much", "took extra tablet", "took extra pill", "took extra dose", "took an extra tablet",
  "took an extra pill", "took an extra dose", "took the wrong", "took twice", "taken twice", "wont stop bleeding",
  "overdosed", "accidentally took", "swallowed the wrong",
];

/** Each side is a list of alternatives; one word from each side anywhere in the message is an emergency. Whole words (`*` is a stem). */
export const ASSISTANT_DANGER_PAIRS: readonly (readonly [readonly string[], readonly string[]])[] = [
  [["arm", "arms"], ["numb", "numbness", "numbed"]],
  [["face"], ["numb", "numbness", "numbed"]],
  [["one side"], ["weak", "weakness", "numb", "numbness"]],
  [["chest"], ["crushing", "squeezing", "squeezed", "tight", "tightness"]],
  [["speech"], ["slurred", "slurring", "slur"]],
  [["face"], ["droop*", "droopy"]],
];

/**
 * The phrases above that are self-harm or suicide wording (they get their own copy and an on-call page, INV-05). Kept next to the lists so a
 * phrase added there cannot be forgotten here: `isSelfHarmScreen` reads the phrases that FIRED, never a second list of its own.
 */
const SELF_HARM_PHRASES: ReadonlySet<string> = new Set([
  "suicide", "suicidal", "suicid", "kill myself", "kill himself", "kill herself", "kill themselves", "end my life", "want to die", "wants to die",
  "wanted to die", "self harm", "self-harm", "selfharm", "don't want to live", "do not want to live", "cutting myself", "hurting myself",
  "harming myself", "hurt myself", "harm myself", "better off dead", "no reason to live", "end it all", "dont want to live", "take my own life", "taking my own life", "take his own life", "take her own life",
  ...END_VERBS.flatMap((v) => PRONOUNS.map((p) => `${v} ${p} life`)),
]);

export interface AssistantDangerScreen {
  readonly redFlag: boolean;
  readonly matched: readonly string[];
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[‘’ʼ]/g, "'");
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Word matcher. The START is always a word boundary ("arm" never matches "pharmacy"). A trailing `*` makes the entry a stem. A phrase is
 * also open at the END so an inflection still fires ("chest pains", "strokes", "wont stop bleeding" variants); a pair word is closed at
 * the end ("numb" never matches "numbers"), because a pair is two common words that only mean something together.
 */
function wordRegex(entry: string, closedAtEnd = false): RegExp {
  const stem = entry.endsWith("*");
  const body = escapeRegex(stem ? entry.slice(0, -1) : entry).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![a-z0-9])${body}${!stem && closedAtEnd ? "(?![a-z0-9])" : ""}`);
}

const PHRASE_ENTRIES = [...WRITTEN_QUESTION_DANGER_PHRASES, ...ASSISTANT_EXTRA_DANGER_PHRASES];
const PHRASE_REGEX: readonly (readonly [string, RegExp])[] = PHRASE_ENTRIES.map((p) => [p, wordRegex(p)]);
const PAIR_REGEX: readonly (readonly [string, RegExp, RegExp])[] = ASSISTANT_DANGER_PAIRS.map(([a, b]) => [
  `${a[0]} + ${b[0]}`,
  new RegExp(a.map((x) => wordRegex(x, true).source).join("|")),
  new RegExp(b.map((x) => wordRegex(x, true).source).join("|")),
]);

export function isSelfHarmScreen(screen: AssistantDangerScreen): boolean {
  return screen.matched.some((m) => SELF_HARM_PHRASES.has(m));
}

export function screenAssistantMessage(text: string): AssistantDangerScreen {
  const haystack = normalise(text);
  const phrases = PHRASE_REGEX.filter(([, re]) => re.test(haystack)).map(([p]) => p.replace(/\*$/, ""));
  const pairs = PAIR_REGEX.filter(([, a, b]) => a.test(haystack) && b.test(haystack)).map(([label]) => label);
  const matched = [...new Set([...phrases, ...pairs])];
  return { redFlag: matched.length > 0, matched };
}
