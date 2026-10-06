/**
 * Titration proposals (S24, spec 6.3). Types only. Every drug, dose, threshold and step lives in a
 * ProtocolDefinition supplied by the CMO as data; the evaluator in titration.ts holds none of them (INV-01).
 */

export type ProtocolStatus = "draft" | "approved" | "retired";

export type TitrationStopCode =
  | "pregnancy_or_unknown"
  | "open_red_triage"
  | "open_amber_triage"
  | "too_few_readings"
  | "unreliable_readings"
  | "low_adherence"
  | "adherence_unknown"
  | "change_inside_review_window"
  | "side_effects_reported"
  | "readings_stale"
  | "already_at_target"
  | "no_matching_step"
  | "protocol_not_approved_for_real_patient"
  | "final_step_reached";

export interface ProtocolMedicineRef {
  drugName: string;
  dose: string;
  /** When present the patient's frequency must match too. */
  frequency?: string;
}

export interface ProtocolItem {
  drugName: string;
  dose: string;
  frequency: string;
  route?: string;
  durationDays: number;
  quantity: string;
  repeatsAllowed?: number;
  indication?: string;
  instructions?: string;
}

export interface ProtocolProposal {
  action: "start" | "change";
  /** For a change: the drugName (one of the step's `requires`) of the current medicine being changed. */
  changes?: string;
  item: ProtocolItem;
}

export interface ProtocolStep {
  id: string;
  label?: string;
  /** Medicines the patient must currently take for this step to apply. Empty: applies only to a patient on no clinician-issued medicine. */
  requires: ProtocolMedicineRef[];
  /** The next step to propose; null marks the final step of the table. */
  propose: ProtocolProposal | null;
  rationale?: string;
}

export interface ProtocolParams {
  minReadings: number;
  windowDays: number;
  minAdherencePercent: number;
  reviewWindowDays: number;
  staleAfterDays: number;
  requireValidated: boolean;
  validation: { systolicMin: number; systolicMax: number; diastolicMin: number; diastolicMax: number };
}

export interface ProtocolDefinition {
  code: string;
  version: number;
  status: ProtocolStatus;
  /** True only on the test fixture: the CMO supplies the real table. */
  placeholder?: boolean;
  params: ProtocolParams;
  steps: ProtocolStep[];
}

export type ProtocolValidation = { ok: true; definition: ProtocolDefinition } | { ok: false; errors: string[] };

export interface TitrationReading {
  systolic: number;
  diastolic: number;
  takenAt: string;
  validated: boolean;
}

export interface TitrationMedication {
  id: string;
  drugName: string;
  dose: string;
  frequency: string;
  startedAt: string;
  clinicianIssued: boolean;
}

export interface TitrationInput {
  /** ISO timestamp supplied by the caller: the evaluator has no clock. */
  now: string;
  isTest: boolean;
  patient: { ageYears: number; pregnancy: "yes" | "no" | "unknown" };
  target: { systolic: number; diastolic: number };
  readings: TitrationReading[];
  currentMedications: TitrationMedication[];
  adherencePercent: number | null;
  openTriage: "none" | "amber" | "red";
  sideEffectsReported: boolean;
  lastChangeAt: string | null;
}

export interface TitrationStopReason {
  code: TitrationStopCode;
  detail?: string;
}

/** The exact inputs the proposal was made from (INV-16): stored on the change row so a reviewer can re-run it. */
export interface TitrationInputsSnapshot {
  now: string;
  isTest: boolean;
  protocol: { code: string; version: number; status: ProtocolStatus };
  params: ProtocolParams;
  patient: { ageYears: number; pregnancy: "yes" | "no" | "unknown" };
  target: { systolic: number; diastolic: number };
  readings: TitrationReading[];
  readingCount: number;
  averageSystolic: number;
  averageDiastolic: number;
  currentMedications: TitrationMedication[];
  adherencePercent: number | null;
  openTriage: "none" | "amber" | "red";
  sideEffectsReported: boolean;
  lastChangeAt: string | null;
  stepId: string;
}

export interface TitrationProposalItem {
  drugName: string;
  dose: string;
  frequency: string;
  route?: string;
  durationDays: number;
  quantity: string;
  repeatsAllowed?: number;
  indication?: string;
  instructions?: string;
}

export type TitrationProposal = {
  kind: "proposal";
  stepId: string;
  action: "start" | "change";
  medicationId?: string;
  item: TitrationProposalItem;
  rationale: string;
  inputs: TitrationInputsSnapshot;
};

export type TitrationNoProposal = { kind: "no_proposal"; reasons: TitrationStopReason[] };

export type TitrationResult = TitrationProposal | TitrationNoProposal;

/** Exact arguments of public.propose_care_plan_change for an engine proposal. */
export interface ProposeCareChangeArgs {
  p_patient: string;
  p_kind: "medication";
  p_proposal: {
    action: "start" | "change";
    medication_id?: string;
    item: {
      drug_name: string;
      dose: string;
      frequency: string;
      route?: string;
      duration_days: number;
      quantity: string;
      repeats_allowed?: number;
      indication?: string;
      instructions?: string;
    };
  };
  p_rationale: string;
  p_proposed_by: "engine";
  p_protocol_id: string;
  p_engine_inputs: TitrationInputsSnapshot;
}
