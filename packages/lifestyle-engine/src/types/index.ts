/**
 * @tarragon/lifestyle-engine — core domain types + zod schemas.
 *
 * These types are the condition-agnostic vocabulary of the Lifestyle Programme
 * Engine (LPE). Conditions (HTN / diabetes / obesity) are expressed as
 * configuration via `ConditionAdapter` (see ./adapters) — there is no
 * procedural per-condition logic anywhere in `core/` or `safety/`.
 *
 * Spec: guideline/LIFESTYLE_ENGINE_SPEC.md · Build plan: docs/LIFESTYLE_ENGINE_BUILD_PLAN.md
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Conditions & modules
// ---------------------------------------------------------------------------

/** The lifestyle scaffolding shared by every pathway (spec §2). */
export const MODULES = ["diet", "activity", "behaviour", "sleep", "stress"] as const;
export type Module = (typeof MODULES)[number];

/** Conditions with an adapter today. Adding a 4th = one new adapter (spec §5). */
export const CONDITION_KEYS = ["htn", "diabetes", "obesity"] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];

// ---------------------------------------------------------------------------
// Measurements — the source of truth (spec §4.3 / §8)
// ---------------------------------------------------------------------------

/** Shared measurement types across pathways (spec §4.3). */
export const MEASUREMENT_TYPES = [
  "bp",
  "glucose",
  "weight",
  "waist",
  "bmi_derived",
  "activity_minutes",
  "steps",
  "strength_session",
  "food_log",
  "mood",
  "sleep",
  "ketones",
  "insulin_dose",
  "med_adherence",
  "foot_check",
  "symptom",
  "side_effect",
] as const;
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];

/**
 * How a measurement entered the system.
 *
 * NON-NEGOTIABLE: `whatsapp` is intentionally NOT a member. Inbound WhatsApp is
 * parsed for intent only and is never promoted to an authoritative measurement
 * (spec §4.3 rule, §10.4; CLAUDE.md WhatsApp business rule). Enforced in code
 * and covered by tests.
 */
export const MEASUREMENT_SOURCES = ["app", "web", "coordinator", "device"] as const;
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

export const measurementContextSchema = z
  .object({
    tag: z
      .enum(["fasting", "pre_meal", "post_meal", "bedtime", "random"])
      .optional(),
    meal: z.string().optional(),
  })
  .catchall(z.unknown());
export type MeasurementContext = z.infer<typeof measurementContextSchema>;

/** Ingestion payload (spec §8.1). Validated before persistence. */
export const measurementInputSchema = z
  .object({
    type: z.enum(MEASUREMENT_TYPES),
    valueNum: z.number().finite().optional(),
    valueJson: z.record(z.string(), z.unknown()).optional(),
    unit: z.string().min(1),
    context: measurementContextSchema.optional(),
    takenAt: z.string().datetime(),
    source: z.enum(MEASUREMENT_SOURCES),
  })
  .refine((m) => m.valueNum !== undefined || m.valueJson !== undefined, {
    message: "measurement must carry valueNum or valueJson",
  });
export type MeasurementInput = z.infer<typeof measurementInputSchema>;

/** A persisted measurement (adds identity + safety linkage). */
export interface Measurement extends MeasurementInput {
  id: string;
  patientId: string;
  organisationId: string;
  enrollmentId: string | null;
  validated: boolean;
  flagged: boolean;
  redFlagEventId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Safety (spec §9) — types only here; the evaluator lives in ./safety (Phase 2)
// ---------------------------------------------------------------------------

export const SEVERITIES = ["amber", "red", "emergency"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Unified escalation levels across pathways (spec §9.2). */
export const ESCALATION_LEVELS = [1, 2, 3, 4] as const;
export type EscalationLevel = (typeof ESCALATION_LEVELS)[number];

export const RED_FLAG_ACTIONS = [
  "supportive_reply",
  "same_day_review",
  "auto_pause_weightloss",
  "page_oncall",
  "refer",
] as const;
export type RedFlagAction = (typeof RED_FLAG_ACTIONS)[number];

/** Input handed to a red-flag rule predicate. */
export interface SafetyInput {
  measurement: MeasurementInput;
  /** Recent history for trend/rate rules (most-recent-first, optional). */
  recent?: MeasurementInput[];
}

/** Minimal patient context a rule may branch on (never PII beyond need). */
export interface PatientContext {
  isPregnant: boolean;
  hasEatingDisorderHistory: boolean;
  /** Adapter thresholds may vary for high-risk patients. */
  highRisk: boolean;
}

/**
 * A red-flag rule (spec §9.1). Supplied by the adapter as data (a predicate is
 * still "config" — it carries no orchestration). The evaluator (Phase 2) runs
 * these; it never contains condition-specific thresholds itself.
 */
export interface RedFlagRule {
  key: string;
  module?: Module;
  severity: Severity;
  level: EscalationLevel;
  action: RedFlagAction;
  /** Pure predicate: true ⇒ this flag fires. No side effects. */
  when: (input: SafetyInput, patient: PatientContext) => boolean;
  /** Patient-facing safety-net copy (never a clinical verdict). */
  safetyNetMessageKey: string;
}

// ---------------------------------------------------------------------------
// Programme lifecycle (spec §6)
// ---------------------------------------------------------------------------

export const ENROLLMENT_STATUSES = [
  "draft",
  "active",
  "paused",
  "maintenance",
  "disengaged",
  "completed",
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const PHASE_KINDS = [
  "foundation",
  "build",
  "strengthen",
  "maintenance",
  "continuous",
] as const;
export type PhaseKind = (typeof PHASE_KINDS)[number];

// ---------------------------------------------------------------------------
// Adapter configuration shapes (spec §5)
// ---------------------------------------------------------------------------

export interface ModuleConfig {
  enabled: boolean;
  /** Relative emphasis 0–1 used for content ranking + nudge weighting. */
  weight: number;
}

/** Condition target set — free-form per condition, kept as readable config. */
export interface TargetSet {
  headline: string;
  detail?: Record<string, string>;
}

/** What to log & how often, by phase (spec §5, mirrors each pathway §8/§10). */
export interface MonitoringItem {
  type: MeasurementType;
  /** Human-readable cadence, e.g. "daily", "weekly", "3x/week". */
  cadence: string;
  /** Phase keys this item applies to; empty ⇒ all phases. */
  phases: string[];
}
export type MonitoringSchedule = MonitoringItem[];

export interface WhatsAppCadenceConfig {
  /** Per-phase reminder/nudge frequency, keyed by phase key. */
  byPhase: Record<string, { remindersPerWeek: number; nudgesPerWeek: number }>;
}

export interface AdapterGuardrails {
  autoPauseOnEdFlag: boolean;
  noNumericTargetsIfEd: boolean;
}

/**
 * A ConditionAdapter is PURE CONFIGURATION (spec §5). It supplies targets,
 * cadence, active modules, monitoring schedule, red-flag rules, content pack,
 * and copy-tone constraints. It contains no procedural logic — the engine core
 * consumes it uniformly.
 */
export interface ConditionAdapter {
  key: ConditionKey;
  /** care_plan_condition value this maps onto in the DB. */
  carePlanCondition: "hypertension" | "diabetes" | "obesity";
  modules: Partial<Record<Module, ModuleConfig>>;
  targets: TargetSet;
  monitoring: MonitoringSchedule;
  redFlags: RedFlagRule[];
  cadence: WhatsAppCadenceConfig;
  contentPackId: string;
  guardrails: AdapterGuardrails;
}
