import type { TitrationStopCode } from "./titration-types";

/** i18n keys (packages/i18n) for each stop code, so the clinician UI can render `reasons` without a switch. */
export const TITRATION_STOP_KEYS: Record<TitrationStopCode, string> = {
  pregnancy_or_unknown: "titration.stop.pregnancy_or_unknown",
  open_red_triage: "titration.stop.open_red_triage",
  open_amber_triage: "titration.stop.open_amber_triage",
  too_few_readings: "titration.stop.too_few_readings",
  unreliable_readings: "titration.stop.unreliable_readings",
  low_adherence: "titration.stop.low_adherence",
  adherence_unknown: "titration.stop.adherence_unknown",
  change_inside_review_window: "titration.stop.change_inside_review_window",
  side_effects_reported: "titration.stop.side_effects_reported",
  readings_stale: "titration.stop.readings_stale",
  already_at_target: "titration.stop.already_at_target",
  no_matching_step: "titration.stop.no_matching_step",
  protocol_not_approved_for_real_patient: "titration.stop.protocol_not_approved_for_real_patient",
  final_step_reached: "titration.stop.final_step_reached",
};

/** Labels for the proposal card. */
export const TITRATION_LABEL_KEYS = {
  suggestButton: "titration.label.suggest_button",
  proposalTitle: "titration.label.proposal_title",
  noProposalTitle: "titration.label.no_proposal_title",
  noProtocol: "titration.label.no_protocol",
  step: "titration.label.step",
  actionStart: "titration.label.action_start",
  actionChange: "titration.label.action_change",
  drug: "titration.label.drug",
  dose: "titration.label.dose",
  frequency: "titration.label.frequency",
  duration: "titration.label.duration",
  quantity: "titration.label.quantity",
  rationale: "titration.label.rationale",
  inputs: "titration.label.inputs",
  draftNote: "titration.label.draft_note",
} as const;
