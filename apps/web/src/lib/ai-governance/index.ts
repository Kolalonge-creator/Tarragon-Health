/**
 * AI Governance, Safety & Model Management — the runtime half of Module 40.
 * The governed records themselves live in the database (migrations
 * 20260829094312 through 20260829101507); this package is what the running
 * code uses to honour them.
 */
export { AI_SYSTEMS, failsClosedWhenGovernanceUnavailable } from "./system-codes";
export type { AiSystemKey, AiSystemCode } from "./system-codes";
export type { AiGovernanceClient } from "./registry";
export {
  decideAiGovernance,
  governedSystemPrompt,
  blockingGuardrailCodes,
  __clearAiGovernanceCache,
} from "./registry";
export { recordAiInteraction, recordAiHumanOverride, reportAiSafetyIncident } from "./audit";
export type {
  RecordAiInteractionParams,
  ReportAiIncidentParams,
} from "./audit";
export { runGovernedAi } from "./run-governed";
export type {
  RunGovernedAiParams,
  RunGovernedAiResult,
  GovernedRunOutcome,
  GovernedRunContext,
  AiFallbackReason,
} from "./run-governed";
export {
  AI_INCIDENT_CATEGORIES,
  AI_OUTPUT_FLAGS,
  AI_RISK_CLASSES,
  AI_AUTONOMY_LEVELS,
} from "./types";
export type {
  AiGovernanceDecision,
  AiRuntimeConfig,
  AiGuardrail,
  AiGovernedPrompt,
  AiKnowledgeSource,
  AiIncidentCategory,
  AiOutputFlag,
  AiRiskClass,
  AiAutonomyLevel,
  AiSafetyClassification,
  AiInteractionStatus,
  AiBlockReason,
} from "./types";
