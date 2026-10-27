/**
 * S59c: the words for the assessment experience, built from the pure parts, shared by the web app and the phone so the two cannot drift.
 *
 * The translator is injected (`tr`), so this package keeps no dependency on the string catalogue; each app passes a one-line wrapper over
 * `t()` from `@tarragon/i18n`. Nothing here decides anything clinical: it only turns already-decided facts into sentences. English only (D-14).
 */
import type { AnsweredQuestion, SymptomCapture, TriageCategory } from "../types/index";
import type { CheckbackAction } from "./checkback";
import { BUNDLED_RULE_CONDITIONS, explainResult, outcomeKeyFromSafetyNetKey, type Explanation, type ExplainerFact } from "./explainer";
import { buildSafetyNet, buildSaveCard, type SafetyNet } from "./safety-net";

export type Translate = (key: string, params?: Record<string, string | number>) => string;

const ONSET_KEYS: Record<string, string> = {
  sudden: "symptom.why.fact.onset.sudden",
  gradual: "symptom.why.fact.onset.gradual",
  unknown: "symptom.why.fact.onset.unknown",
};

/** One line of "what you told us". `optionLabel` is the words for a vocabulary key (symptom, trigger or history). */
export function explainerFactText(fact: ExplainerFact, tr: Translate, optionLabel: (key: string) => string): string {
  switch (fact.kind) {
    case "onset":
      return tr(ONSET_KEYS[fact.value] ?? "symptom.why.fact.onset.unknown");
    case "severity":
      return tr("symptom.why.fact.severity", { n: fact.value });
    case "symptom":
    case "trigger":
    case "history":
      return optionLabel(fact.key);
    case "measurement":
      return fact.key === "spo2_pct" ? tr("symptom.why.fact.spo2", { value: `${fact.value}%` }) : tr("symptom.why.fact.measurement", { value: fact.value });
    case "answer":
      return tr("symptom.why.fact.answer", { prompt: fact.prompt, answer: fact.value === "yes" ? tr("symptom.mobile.yes") : fact.value === "no" ? tr("symptom.mobile.no") : optionLabel(fact.value) });
  }
}

/**
 * The lines that complete "Go to a hospital or call for help straight away if ...". The generic lines always come first and are always
 * present; the pathway's own lines (signed config only) follow. `closing` is the plain sentence after the list.
 */
export function safetyNetLines(net: SafetyNet, tr: Translate): { lines: string[]; closing: string[] } {
  const lines = [tr("symptom.net.generic.worse"), tr("symptom.net.generic.wrong"), ...net.specific];
  const closing = [tr("symptom.net.nearest")];
  if (net.emergencyNumber) closing.push(tr("symptom.net.number", { number: net.emergencyNumber }));
  return { lines, closing };
}

export interface ResultCardInput {
  complaintLabel: string | null;
  /** The headline the screen shows (the six-level wording when signed, the category label otherwise). */
  headline: string;
  /** The next-step sentence the screen shows for this category. */
  nextStep: string | null;
  /** Lagos date text, or null. */
  dateLabel: string | null;
  net: SafetyNet;
}

/** The save-this-card text. Built only from what is already on the screen; nothing is stored, sent or logged by building it. */
export function buildResultCard(input: ResultCardInput, tr: Translate): string {
  const { lines, closing } = safetyNetLines(input.net, tr);
  return buildSaveCard({
    title: tr("symptom.card.title"),
    dateLine: input.dateLabel ? tr("symptom.card.date", { date: input.dateLabel }) : null,
    complaint: input.complaintLabel,
    resultLine: input.headline,
    nextStep: input.nextStep,
    safetyHeading: `${tr("symptom.net.title")}:`,
    safetyLines: lines,
    safetyClosing: closing,
    // the one shared label, never a sentence of this file's own
    notADiagnosis: tr("symptom.not_a_diagnosis.short"),
    footer: tr("symptom.card.footer"),
  });
}

export interface ResultExtrasInput {
  category: TriageCategory;
  complaintKey: string;
  complaintLabel: string | null;
  /** The headline and next-step sentence exactly as the screen shows them (the card repeats them, nothing more). */
  headline: string;
  nextStep: string | null;
  /** Already formatted in Africa/Lagos by the caller (this module reads no clock), or null. */
  dateLabel: string | null;
  /** The raw result facts that "Why this result" is derived from: ids and the person's own answers, never typed text. */
  capture: SymptomCapture | null;
  firedRuleKeys: readonly string[];
  safetyNetMessageKey: string;
  tightenedBy: readonly string[];
  questionsAsked: readonly AnsweredQuestion[];
  /** True when the pathway equals the bundled copy (or the result came from the on-device floor), so the bundled rule conditions apply. */
  useBundledConditions: boolean;
}

export interface ResultExtras {
  /** Null unless the explainer is signed and has text for a rule that fired in THIS result. */
  explanation: Explanation | null;
  net: SafetyNet;
  /** The plain-text card. */
  card: string;
}

/**
 * Everything a result screen adds on top of the headline: the explanation, the safety net and the save-this-card text. One function for the web and the
 * phone so they cannot drift. `explainer` and `safetyNet` are the configs IN FORCE (signed and matching the live one), or null.
 */
export function buildResultExtras(input: ResultExtrasInput, configs: { explainer: unknown; safetyNet: unknown }, tr: Translate): ResultExtras {
  const explanation = input.capture
    ? explainResult(
        {
          firedRuleKeys: input.firedRuleKeys,
          outcomeKey: outcomeKeyFromSafetyNetKey(input.safetyNetMessageKey),
          tightenedBy: input.tightenedBy,
          capture: input.capture,
          questionsAsked: input.questionsAsked,
          ruleConditions: input.useBundledConditions ? BUNDLED_RULE_CONDITIONS : undefined,
        },
        configs.explainer,
      )
    : null;
  const net = buildSafetyNet({ pathwayKey: input.complaintKey, category: input.category }, configs.safetyNet);
  const card = buildResultCard(
    { complaintLabel: input.complaintLabel, headline: input.headline, nextStep: input.nextStep, dateLabel: input.dateLabel, net },
    tr,
  );
  return { explanation, net, card };
}

/** The message key for the end of a follow-up. An emergency uses the existing emergency guidance. */
export function checkbackResultKey(action: CheckbackAction, doctorAccess: boolean | null): string {
  switch (action) {
    case "close":
      return "symptom.checkback.result.close";
    case "keep_watching":
      return "symptom.checkback.result.keep_watching";
    case "book":
      return "symptom.checkback.result.book";
    case "escalate":
      return doctorAccess === false ? "symptom.checkback.result.no_doctor" : "symptom.checkback.result.escalate";
    case "emergency":
      return "symptom.emergency.go_now";
  }
}

/** Which category the next-step doors (book, send a summary, message, labs) should be offered for after a follow-up. Never lower than the action implies. */
export function checkbackDoorCategory(action: CheckbackAction): TriageCategory {
  return action === "emergency" ? "emergency" : action === "escalate" ? "urgent" : action === "book" ? "routine" : "self_management";
}
