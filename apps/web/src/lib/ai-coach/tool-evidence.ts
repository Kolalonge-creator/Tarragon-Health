import type { CoachSource } from "@tarragon/shared";

/**
 * S51 (7.2, 7.9): what a tool call actually grounded. Read from the tool's own JSON result, never from the model's words, so a source
 * shown to the patient exists because a row was really read. A lookup that returned nothing grounds nothing.
 */
const RECORD_TOOLS = new Set(["getVitals", "getMedications", "getAllergies", "getAppointments", "getConditions", "getRecentLabResults"]);

export const RECORD_SOURCE: CoachSource = { kind: "record", title: "Your Tarragon record" };

export interface ToolEvidence {
  grounded: boolean;
  source?: CoachSource;
}

const SOURCE_KINDS = new Set(["reviewed_content", "record", "explanation", "protocol_limits"]);

function hasRows(payload: Record<string, unknown>): boolean {
  return Object.values(payload).some((v) => Array.isArray(v) && v.length > 0);
}

export function evidenceFromTool(toolName: string, output: unknown): ToolEvidence {
  if (typeof output !== "string") return { grounded: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return { grounded: false };
  }
  if (!parsed || typeof parsed !== "object" || "error" in (parsed as object)) return { grounded: false };
  const payload = parsed as Record<string, unknown>;

  if (RECORD_TOOLS.has(toolName)) return hasRows(payload) ? { grounded: true, source: RECORD_SOURCE } : { grounded: false };

  const raw = payload._source as Record<string, unknown> | undefined;
  if (!raw || payload.found === false) return { grounded: false };
  if (toolName === "getCachedExplanations" && !hasRows(payload)) return { grounded: false };
  if (typeof raw.kind !== "string" || !SOURCE_KINDS.has(raw.kind) || typeof raw.title !== "string") return { grounded: false };
  const source: CoachSource = {
    kind: raw.kind as CoachSource["kind"],
    title: raw.title,
    ...(typeof raw.owner === "string" ? { owner: raw.owner } : {}),
    ...(typeof raw.version === "number" ? { version: raw.version } : {}),
    ...(typeof raw.reviewDue === "string" ? { reviewDue: raw.reviewDue.slice(0, 10) } : {}),
  };
  return { grounded: true, source };
}
