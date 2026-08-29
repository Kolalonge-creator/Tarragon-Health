/**
 * Shape of triage_protocols.config -- a versioned, clinician-approved
 * (approved_by/approved_at, only after is_active flips) decision-tree
 * config per presenting complaint. This module never authors clinical
 * content itself; it only walks whatever the active, signed protocol says.
 *
 * v1 shipped live 2026-08-29 as a DRAFT, UNSIGNED row (is_active: false) --
 * see docs/SYMPTOM_TRIAGE_ENGINE_SPEC.md's scope note and
 * triage_protocols.notes for the full provenance. getActiveProtocol()
 * returns null until a Clinical Director actually signs one; every caller
 * must treat that as a real, handled state (same "no signed protocol in
 * force" discipline as case-briefs' protocol grounding), never a bug.
 */

export type TriageCategory = "emergency" | "urgent" | "routine" | "self_management";

export type QuestionNode =
  | {
      type: "question";
      kind: "boolean";
      key: string;
      prompt: string;
      onYes: string;
      onNo: string;
    }
  | {
      type: "question";
      kind: "choice";
      key: string;
      prompt: string;
      options: { value: string; label: string; next: string }[];
    };

export type OutcomeNode = {
  type: "outcome";
  key: string;
  category: TriageCategory;
  rationale: string;
  safetyNetMessageKey: string;
  clinicianReviewRequired: boolean;
};

export type PathwayNode = QuestionNode | OutcomeNode;

export type RedFlagRule = {
  onset?: "sudden" | "gradual";
  minSeverity?: number;
  anyAssociatedSymptom?: string[];
  allAssociatedSymptoms?: string[];
  anyHistory?: string[];
  anyTrigger?: string[];
  measurementBelow?: { key: string; value: number };
};

export type RedFlagScreenEntry = {
  key: string;
  label: string;
  category: TriageCategory;
  rule: RedFlagRule;
};

export type TriagePathway = {
  key: string;
  label: string;
  startNodeKey: string;
  nodes: Record<string, PathwayNode>;
  redFlagScreen: RedFlagScreenEntry[];
  fallbackOutcome: OutcomeNode;
  knownHistory: string[];
  knownTriggers: string[];
  knownAssociatedSymptoms: string[];
};

export type TriageProtocolConfig = {
  version: number;
  pathways: TriagePathway[];
};

export type ActiveTriageProtocol = {
  id: string;
  version: number;
  config: TriageProtocolConfig;
};

/** What the patient reports before the pathway's own question graph runs --
 * the red-flag screen always evaluates this first, on every pathway, before
 * a single node-graph question is asked. */
export type InitialCapture = {
  severity: number;
  onset: "sudden" | "gradual";
  associatedSymptoms: string[];
  history: string[];
  triggers: string[];
  measurements: Record<string, number>;
  /** Optional free text -- never feeds the disposition logic directly, only
   * checked as an emergency-upgrade-only backstop. See
   * submitSymptomTriageAssessmentAction. */
  note?: string;
};
