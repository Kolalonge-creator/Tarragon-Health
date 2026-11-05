import type { AiRuntimeConfig } from "./types";

/**
 * Which model a governed AI call site should ask for.
 *
 * The approved model for every AI system already lives in configuration:
 * `ai_system_versions.model_identifier`, surfaced as
 * `ai_runtime_config().expected_model_identifier` (the newest approved, not
 * retired version). Call sites used to ignore it and send a model id written
 * into the code, so moving a system to a new model meant a code release, and
 * approving a new version in the governance console changed nothing.
 *
 * Now the approved version wins. The in-code constant stays as the fallback
 * for the cases where no approved version can be read: governance is down and
 * the system fails open, nothing has been approved yet, or the call site has
 * no config in scope.
 *
 * The vendor guard: every call site that uses this talks to one vendor's API
 * (Anthropic, through the LangChain client or a direct HTTP call). An approved
 * identifier from a different vendor (`voyage-…`, `tarragon-ml-service-…`)
 * would be sent to the wrong API and fail on every call, so an identifier
 * that does not share the fallback's vendor prefix is ignored and the
 * fallback is used.
 */
export function governedModelId(
  config: Pick<AiRuntimeConfig, "expected_model_identifier"> | null | undefined,
  fallbackModelId: string
): string {
  const approved = config?.expected_model_identifier?.trim();
  if (!approved) return fallbackModelId;
  return vendorPrefix(approved) === vendorPrefix(fallbackModelId) ? approved : fallbackModelId;
}

function vendorPrefix(modelId: string): string {
  const dash = modelId.indexOf("-");
  return (dash === -1 ? modelId : modelId.slice(0, dash)).toLowerCase();
}
