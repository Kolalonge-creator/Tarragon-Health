import { z } from "zod";

/** A row of `public.protocols` (S24), read for the CMO's review screen. */
export const protocolRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  version: z.number().int(),
  status: z.enum(["draft", "approved", "retired"]),
  approved_by: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  note: z.string().nullable(),
  definition: z.unknown(),
});
export type ProtocolRow = z.infer<typeof protocolRowSchema>;

export const PROTOCOL_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

export function statusLabel(status: ProtocolRow["status"]): string {
  return status === "draft" ? "Draft, not approved" : status === "approved" ? "Approved" : "Retired";
}

/** The approver's name only when a real name is on record. A missing approver never becomes an invented one. */
export function approverLabel(status: ProtocolRow["status"], approvedBy: string | null, name: string | null | undefined): string | null {
  if (status === "draft" || approvedBy === null) return null;
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed.length > 0 ? trimmed : "Approver name not on record";
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export interface Field {
  name: string;
  value: string;
}
export interface DefinitionSummary {
  params: Field[];
  steps: { heading: string; fields: Field[] }[];
}

function words(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Renders any JSON value as text, never "undefined" or "[object Object]". */
function show(value: unknown): string {
  if (value === null) return "none";
  if (value === undefined) return "not set";
  if (typeof value === "string") return value.length > 0 ? value : "empty";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.map(show).join("; ");
  if (isObj(value)) {
    const parts = Object.entries(value).map(([k, v]) => `${words(k)}: ${show(v)}`);
    return parts.length === 0 ? "none" : parts.join(", ");
  }
  return "not shown";
}

function toFields(o: Obj, skip: readonly string[] = []): Field[] {
  return Object.entries(o)
    .filter(([k]) => !skip.includes(k))
    .map(([k, v]) => ({ name: words(k), value: show(v) }));
}

/** Generic, read-only summary of a stored definition. Returns null if it is not the shape of params plus a list of steps. */
export function summariseDefinition(definition: unknown): DefinitionSummary | null {
  if (!isObj(definition) || !isObj(definition.params) || !Array.isArray(definition.steps)) return null;
  const steps = definition.steps.map((s, i) => {
    if (!isObj(s)) return { heading: `Step ${i + 1}`, fields: [{ name: "Content", value: show(s) }] };
    const heading = typeof s.label === "string" && s.label.trim() ? s.label.trim() : typeof s.id === "string" && s.id.trim() ? s.id.trim() : `Step ${i + 1}`;
    return { heading, fields: toFields(s, ["label"]) };
  });
  return { params: toFields(definition.params), steps };
}

/** True when the Approve button may be offered for this row. */
export function canOfferApprove(status: ProtocolRow["status"]): boolean {
  return status === "draft";
}

export type ParsedDefinition = { ok: true; definition: Record<string, unknown> } | { ok: false; errors: string[] };

/** Reads the pasted text as a JSON object. Nothing is filled in for the author. */
export function parseDefinitionText(text: string): ParsedDefinition {
  if (text.trim().length === 0) return { ok: false, errors: ["Paste a definition first. The box is empty."] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["That text is not valid JSON. Check for a missing bracket, quote or comma."] };
  }
  if (!isObj(raw)) return { ok: false, errors: ["The definition must be a JSON object with params and steps."] };
  return { ok: true, definition: raw };
}

/**
 * The database stamps code, version and status onto a saved draft (`save_protocol_draft`), so the check does the same
 * before validating. This only adds those three bookkeeping fields; it never adds or changes params or steps.
 */
export function withBookkeeping(definition: Record<string, unknown>, code: string): Record<string, unknown> {
  return { ...definition, code, version: 1, status: "draft" };
}

export interface CheckState {
  kind: "idle" | "valid" | "invalid" | "saved" | "error";
  messages: string[];
}
export const INITIAL_CHECK_STATE: CheckState = { kind: "idle", messages: [] };
