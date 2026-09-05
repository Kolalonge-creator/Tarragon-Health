/**
 * @tarragon/symptom-triage-engine — core domain types + zod schemas.
 *
 * Spec: this package implements the "Symptom Assessment & Triage Engine"
 * described in the platform brief §37 — it answers "what is the safest
 * appropriate next step?", never "what diagnosis does this person have?"
 * (§37.1, §37.12). It is deliberately condition/pathway-agnostic: every
 * presenting-complaint pathway (headache, chest pain, ...) is expressed as
 * DATA (a `TriageProtocolConfig`) loaded from the DB-governed
 * `triage_protocols` table (mirrors `escalation_slas`/`alert_rules` — a
 * clinical ruleset is config, signed by a Clinical Director, never a
 * hardcoded procedural branch). This package is the pure interpreter over
 * that data; it has no DB access and no I/O.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Triage categories (spec §37.5) — fixed, not extensible per-pathway.
// ---------------------------------------------------------------------------

/**
 * The only four outputs the engine may produce. Ordered most-to-least
 * urgent — callers may rely on this order for "most severe wins".
 */
export const TRIAGE_CATEGORIES = ["emergency", "urgent", "routine", "self_management"] as const;
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

const CATEGORY_RANK: Record<TriageCategory, number> = {
  emergency: 3,
  urgent: 2,
  routine: 1,
  self_management: 0,
};

/** True if `a` is at least as urgent as `b`. */
export function categoryAtLeast(a: TriageCategory, b: TriageCategory): boolean {
  return CATEGORY_RANK[a] >= CATEGORY_RANK[b];
}

/** Most-urgent of two categories — "highest severity wins" (mirrors the LPE safety core rule). */
export function mostUrgentCategory(a: TriageCategory, b: TriageCategory): TriageCategory {
  return CATEGORY_RANK[a] >= CATEGORY_RANK[b] ? a : b;
}

// ---------------------------------------------------------------------------
// Entry points (spec §37.2) — who/what is reporting the symptom.
// ---------------------------------------------------------------------------

export const TRIAGE_ENTRY_POINTS = [
  "patient_app",
  "ai_assistant",
  "clinician",
  "nurse",
  "caregiver",
  "monitoring_system",
] as const;
export type TriageEntryPoint = (typeof TRIAGE_ENTRY_POINTS)[number];

// ---------------------------------------------------------------------------
// Initial symptom capture (spec §37.3) — structured, not free text.
// ---------------------------------------------------------------------------

export const onsetSchema = z.enum(["sudden", "gradual", "unknown"]);
export type Onset = z.infer<typeof onsetSchema>;

/**
 * What the patient (or whoever is reporting) captures before the red-flag
 * screen and question tree run. `associatedSymptoms`/`triggers`/`history`
 * keys are drawn from the active pathway's own vocabulary (see
 * `PresentingComplaintProtocol.knownAssociatedSymptoms` etc.) — the engine
 * does not hardcode a symptom taxonomy.
 */
export const symptomCaptureSchema = z.object({
  presentingComplaintKey: z.string().min(1),
  onset: onsetSchema,
  durationHours: z.number().finite().nonnegative().optional(),
  severity: z.number().int().min(1).max(10),
  frequency: z.string().optional(),
  location: z.string().optional(),
  associatedSymptoms: z.array(z.string()).default([]),
  triggers: z.array(z.string()).default([]),
  relevantHistory: z.array(z.string()).default([]),
  onMedication: z.boolean().optional(),
  /** Optional numeric measurements volunteered alongside the symptom (e.g. temperature_c, spo2_pct). */
  measurements: z.record(z.string(), z.number()).default({}),
});
export type SymptomCapture = z.infer<typeof symptomCaptureSchema>;

/** key -> answer, accumulated as the dynamic questionnaire (§37.6) branches. */
export type QuestionAnswer = boolean | string;
export type AnswerMap = Record<string, QuestionAnswer>;

/** One answered (or asked-but-unanswered, for the audit trail) question — persisted verbatim (§37.10). */
export interface AnsweredQuestion {
  questionKey: string;
  prompt: string;
  answer: QuestionAnswer;
  answeredAt: string; // ISO timestamp
}

// ---------------------------------------------------------------------------
// Red-flag screen (spec §37.4) — runs BEFORE the dynamic questionnaire.
// ---------------------------------------------------------------------------

/**
 * A red flag's firing condition, expressed as DATA rather than a function —
 * this is what actually lives in the `triage_protocols.config` jsonb, so it
 * must be plain, serializable, and incapable of running arbitrary code. All
 * present keys are AND-ed together; `anyX` keys are satisfied by ANY member
 * matching (OR), `allAssociatedSymptoms` requires every member present.
 */
export interface RedFlagCondition {
  onset?: Onset;
  minSeverity?: number;
  anyAssociatedSymptom?: string[];
  allAssociatedSymptoms?: string[];
  anyTrigger?: string[];
  anyHistory?: string[];
  /**
   * Fires when the measurement is AT OR BELOW `value` — inclusive, despite
   * the name. Read it as "measurementAtMost": `{ key: "spo2_pct", value: 92 }`
   * fires on 92, matching private.classify_spo2_level, which classes exactly
   * 92 as RED. If you want strictly below N, write N - 1 (or the next
   * representable step for a non-integer measurement); there is no strict
   * operator in this vocabulary.
   *
   * The name is not fixed for want of a better one. It is the literal key
   * inside `triage_protocols.config`, and the only row in that table is a
   * Clinical-Director-approved version 1 (confirmed live 2026-09-05, one
   * measurementBelow rule: spo2_pct 92). Renaming it would mean rewriting an
   * approved clinical protocol's stored jsonb in a migration and re-running
   * the DB/TS parity guard in protocols/config-schema.test.ts, to change a
   * label rather than a behaviour. So the meaning is documented here instead,
   * where a rule author reads it, and the engine's own comment
   * (engine/index.ts) records why the comparison is inclusive.
   */
  measurementBelow?: { key: string; value: number };
  /** Fires when the measurement is at or above `value`. Inclusive, and named for it. */
  measurementAtLeast?: { key: string; value: number };
}

export interface RedFlagRule {
  /** Stable key, e.g. "headache.thunderclap_onset". Never reused for a different clinical meaning. */
  key: string;
  /** Patient-safe label shown in the audit trail / clinician review, never diagnostic language. */
  label: string;
  category: TriageCategory;
  rule: RedFlagCondition;
}

// ---------------------------------------------------------------------------
// Dynamic questionnaire (spec §37.6/§37.7) — a small branching graph, not a
// fixed 50-question form. Every node is data; the engine just walks it.
// ---------------------------------------------------------------------------

export interface QuestionOption {
  value: string;
  label: string;
  next: string; // node key to go to next
}

export interface BooleanQuestionNode {
  type: "question";
  kind: "boolean";
  key: string;
  prompt: string;
  onYes: string; // next node key
  onNo: string; // next node key
}

export interface ChoiceQuestionNode {
  type: "question";
  kind: "choice";
  key: string;
  prompt: string;
  options: QuestionOption[];
}

export type QuestionNode = BooleanQuestionNode | ChoiceQuestionNode;

export interface OutcomeNode {
  type: "outcome";
  key: string;
  category: TriageCategory;
  /** Patient-facing "safest next step" message key (never a diagnosis) — see §37.8. */
  safetyNetMessageKey: string;
  /** §37.9 — forces a human clinician to look regardless of category (e.g. genuinely ambiguous branches). */
  clinicianReviewRequired: boolean;
  /** Internal rationale for the audit trail / clinician review — not shown to the patient verbatim. */
  rationale: string;
}

export type TriageNode = QuestionNode | OutcomeNode;

// ---------------------------------------------------------------------------
// One presenting-complaint pathway (spec §37.7 example: "Headache").
// ---------------------------------------------------------------------------

export interface PresentingComplaintProtocol {
  key: string;
  label: string;
  /** Vocabulary offered in the initial capture UI for this pathway. */
  knownAssociatedSymptoms: string[];
  knownTriggers: string[];
  knownHistory: string[];
  redFlagScreen: RedFlagRule[];
  /** Node key the walk starts from after the red-flag screen clears. */
  startNodeKey: string;
  nodes: Record<string, TriageNode>;
  /** Fallback outcome if the graph is ever walked into a dead end (should never happen; safety net only). */
  fallbackOutcome: OutcomeNode;
}

// ---------------------------------------------------------------------------
// The governed config document (`triage_protocols.config` jsonb).
// ---------------------------------------------------------------------------

export interface TriageProtocolConfig {
  /** Matches the DB row's `version` — stamped onto every assessment for auditability (§37.10). */
  version: number;
  pathways: PresentingComplaintProtocol[];
}

export function findPathway(
  config: TriageProtocolConfig,
  presentingComplaintKey: string,
): PresentingComplaintProtocol | undefined {
  return config.pathways.find((p) => p.key === presentingComplaintKey);
}

// ---------------------------------------------------------------------------
// Zod schema for the raw jsonb stored in `triage_protocols.config` — the
// load boundary between an untrusted (hand-editable) DB row and the typed
// graph the engine walks. A row that fails this parse must never reach
// `runTriage`; the caller should treat it the same as "no active protocol".
// ---------------------------------------------------------------------------

const redFlagConditionSchema = z
  .object({
    onset: onsetSchema.optional(),
    minSeverity: z.number().int().min(1).max(10).optional(),
    anyAssociatedSymptom: z.array(z.string()).optional(),
    allAssociatedSymptoms: z.array(z.string()).optional(),
    anyTrigger: z.array(z.string()).optional(),
    anyHistory: z.array(z.string()).optional(),
    /** "At most", not "strictly below" — see RedFlagCondition.measurementBelow. */
    measurementBelow: z.object({ key: z.string(), value: z.number() }).optional(),
    measurementAtLeast: z.object({ key: z.string(), value: z.number() }).optional(),
  })
  .strict();

const triageCategorySchema = z.enum(TRIAGE_CATEGORIES);

const redFlagRuleSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  category: triageCategorySchema,
  rule: redFlagConditionSchema,
});

const questionOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  next: z.string().min(1),
});

const questionNodeSchema = z.discriminatedUnion("kind", [
  z.object({
    type: z.literal("question"),
    kind: z.literal("boolean"),
    key: z.string().min(1),
    prompt: z.string().min(1),
    onYes: z.string().min(1),
    onNo: z.string().min(1),
  }),
  z.object({
    type: z.literal("question"),
    kind: z.literal("choice"),
    key: z.string().min(1),
    prompt: z.string().min(1),
    options: z.array(questionOptionSchema).min(1),
  }),
]);

const outcomeNodeSchema = z.object({
  type: z.literal("outcome"),
  key: z.string().min(1),
  category: triageCategorySchema,
  safetyNetMessageKey: z.string().min(1),
  clinicianReviewRequired: z.boolean(),
  rationale: z.string().min(1),
});

const triageNodeSchema = z.discriminatedUnion("type", [questionNodeSchema, outcomeNodeSchema]);

const presentingComplaintProtocolSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  knownAssociatedSymptoms: z.array(z.string()).default([]),
  knownTriggers: z.array(z.string()).default([]),
  knownHistory: z.array(z.string()).default([]),
  redFlagScreen: z.array(redFlagRuleSchema),
  startNodeKey: z.string().min(1),
  nodes: z.record(z.string(), triageNodeSchema),
  fallbackOutcome: outcomeNodeSchema,
});

export const triageProtocolConfigSchema = z.object({
  version: z.number().int().positive(),
  pathways: z.array(presentingComplaintProtocolSchema).min(1),
});

/**
 * Parse + validate a raw `triage_protocols.config` jsonb value. Returns
 * `null` (never throws) on anything malformed — callers treat a null the
 * same as "no active protocol" (fail closed, see the migration comment on
 * private.active_triage_protocol_config()).
 */
export function parseTriageProtocolConfig(raw: unknown): TriageProtocolConfig | null {
  const result = triageProtocolConfigSchema.safeParse(raw);
  return result.success ? (result.data as TriageProtocolConfig) : null;
}
