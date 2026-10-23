/**
 * S59c: "Why this result". A plain-words explanation of which signed rule(s) fired and which of the person's OWN answers triggered them,
 * generated deterministically from the result, never from a model (INV-01).
 *
 * WHERE THE WORDS COME FROM. Only from the explainer config (`symptom.result_explainer`): one reason text per rule id, per question-tree
 * outcome and per tightening entry, each carrying the same draft / signed-off envelope as every S59 config. There is NO fallback text. If
 * the config is not in force, or has no entry for a rule that fired, that rule produces nothing, and when nothing is produced the screen
 * shows no "Why this result" section at all. Nothing is invented to fill a gap.
 *
 * WHAT IT CAN NEVER BE. Not a ranking of causes and not a diagnosis. The output type has no field for either: it is a list of reasons
 * (one per fired rule, in the order the rules fired) with the person's own answers beside each, and a list of "tell your care team sooner
 * if" lines taken from the entries that fired. It never changes a category (it receives the result, it does not return one).
 *
 * DERIVED ONLY FROM FIRED RULES. `explainResult` looks entries up by the ids of the rules that fired in THIS result. An entry for a rule
 * that did not fire is never read, so adding entries to the config cannot change any explanation (a property test pins this).
 */
import { z } from "zod";
import { SEED_PATHWAYS } from "../protocols/index";
import type { AnsweredQuestion, RedFlagCondition, SymptomCapture } from "../types/index";
import { envelopeShape, parseInForce } from "./ux-config";

export const explainerEntrySchema = z
  .object({
    /** `rule:<red flag rule key>`, `outcome:<safety net message key of a question-tree outcome>` or `tightening:<entry id>`. */
    id: z.string().regex(/^(rule|outcome|tightening):[a-z0-9_.]+$/),
    /** One or two plain sentences saying why this rule applied. No cause, no diagnosis. */
    reason: z.string().min(10).max(400),
    /** Optional lines for "tell your care team sooner if". */
    tell_us_sooner_if: z.array(z.string().min(5).max(200)).max(6).optional(),
  })
  .strict();

export const explainerConfigSchema = z
  .object({
    ...envelopeShape,
    entries: z.array(explainerEntrySchema).min(1).max(300),
  })
  .strict()
  .refine((c) => new Set(c.entries.map((e) => e.id)).size === c.entries.length, { message: "duplicate explainer entry id" });
export type ExplainerConfig = z.infer<typeof explainerConfigSchema>;

/** The history answer that is a reproductive-health fact: never repeated back into text that can be copied or shown on a shared phone. */
const NEVER_REPEATED = new Set(["pregnant"]);

export type ExplainerFact =
  | { kind: "onset"; value: string }
  | { kind: "severity"; value: number }
  | { kind: "symptom" | "trigger" | "history"; key: string }
  | { kind: "measurement"; key: string; value: number }
  | { kind: "answer"; key: string; prompt: string; value: string };

export interface ExplainerItem {
  id: string;
  reason: string;
  /** The person's own answers that matter to this rule. */
  youTold: ExplainerFact[];
}

export interface Explanation {
  items: ExplainerItem[];
  tellUsSooner: string[];
}

export interface ExplainInput {
  /** Keys of the red-flag rules that fired in this result (the engine records every one, not just the first). */
  firedRuleKeys: readonly string[];
  /** The safety net message key of a question-tree outcome ("headache.self_mild"), or null for a red-flag result. */
  outcomeKey: string | null;
  /** Ids of the risk, context or dependant entries that raised the category. */
  tightenedBy: readonly string[];
  capture: SymptomCapture;
  questionsAsked: readonly AnsweredQuestion[];
  /** The conditions of the fired rules, when the pathway is known on this device (it adds the "you told us" lines). */
  ruleConditions?: Readonly<Record<string, RedFlagCondition>>;
}

function factsForRule(condition: RedFlagCondition | undefined, capture: SymptomCapture): ExplainerFact[] {
  if (!condition) return [];
  const facts: ExplainerFact[] = [];
  if (condition.onset !== undefined && capture.onset === condition.onset) facts.push({ kind: "onset", value: capture.onset });
  if (condition.minSeverity !== undefined && capture.severity >= condition.minSeverity) facts.push({ kind: "severity", value: capture.severity });
  for (const s of [...(condition.anyAssociatedSymptom ?? []), ...(condition.allAssociatedSymptoms ?? [])]) {
    if (capture.associatedSymptoms.includes(s) && !NEVER_REPEATED.has(s)) facts.push({ kind: "symptom", key: s });
  }
  for (const s of condition.anyTrigger ?? []) if (capture.triggers.includes(s) && !NEVER_REPEATED.has(s)) facts.push({ kind: "trigger", key: s });
  for (const s of condition.anyHistory ?? []) if (capture.relevantHistory.includes(s) && !NEVER_REPEATED.has(s)) facts.push({ kind: "history", key: s });
  for (const m of [condition.measurementBelow, condition.measurementAtLeast]) {
    const v = m ? capture.measurements[m.key] : undefined;
    if (m && typeof v === "number") facts.push({ kind: "measurement", key: m.key, value: v });
  }
  return facts;
}

/** The conditions of the bundled signed rules, by rule key: lets the explanation show the person's own answers beside a reason. Only valid for a pathway that equals the bundled copy. */
export const BUNDLED_RULE_CONDITIONS: Readonly<Record<string, RedFlagCondition>> = Object.freeze(
  Object.fromEntries(SEED_PATHWAYS.flatMap((p) => p.redFlagScreen.map((r) => [r.key, r.rule] as const))),
);

/** A question-tree outcome key such as "headache.self_mild"; a red-flag, fallback or degraded key is not one and gets no outcome explanation. */
export function outcomeKeyFromSafetyNetKey(safetyNetMessageKey: string): string | null {
  return safetyNetMessageKey && !/^(redflag|generic|degraded|describe)\./.test(safetyNetMessageKey) ? safetyNetMessageKey : null;
}

function dedupe<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** The explanation for a result, or null when the config is not in force or nothing that fired has an entry. */
export function explainResult(input: ExplainInput, rawConfig: unknown): Explanation | null {
  const config = parseInForce(explainerConfigSchema, rawConfig);
  if (!config) return null;
  const byId = new Map(config.entries.map((e) => [e.id, e]));
  const items: ExplainerItem[] = [];
  const sooner: string[] = [];

  const add = (id: string, youTold: ExplainerFact[]) => {
    const entry = byId.get(id);
    if (!entry) return;
    items.push({ id, reason: entry.reason, youTold });
    sooner.push(...(entry.tell_us_sooner_if ?? []));
  };

  for (const key of dedupe([...input.firedRuleKeys])) {
    add(`rule:${key}`, factsForRule(input.ruleConditions?.[key], input.capture));
  }
  if (input.outcomeKey) {
    add(
      `outcome:${input.outcomeKey}`,
      input.questionsAsked.map((q) => ({ kind: "answer" as const, key: q.questionKey, prompt: q.prompt, value: typeof q.answer === "boolean" ? (q.answer ? "yes" : "no") : String(q.answer) })),
    );
  }
  for (const id of dedupe([...input.tightenedBy])) add(`tightening:${id}`, []);

  if (items.length === 0) return null;
  return { items, tellUsSooner: dedupe(sooner) };
}
