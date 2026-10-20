import { Constants } from "@tarragon/shared";

/** Pure rules for the partner webhook screens (S10x follow-up). No database, no React. Mirrors the database checks so a bad input is refused with a clear word first. */

export const INTEGRATION_EVENT_TYPES = Constants.public.Enums.integration_event_type;
export type IntegrationEventType = (typeof INTEGRATION_EVENT_TYPES)[number];

const BUS_TYPE = /^[a-z][a-z0-9_.]{0,119}$/;
const ID_KEY = /^[a-z][a-z0-9_]*(_id|_ids)$/;
/** The database refuses these too: a partner never receives a person's id from the bus. */
const PERSON_KEYS = new Set(["patient_id", "profile_id", "user_id", "member_id", "person_id", "clinician_id", "staff_id", "caregiver_id"]);

/** The current time, behind a function so server pages can ask for it without calling the clock during render. */
export const currentMs = (): number => Date.now();

export function isBusEventType(v: unknown): v is string {
  return typeof v === "string" && BUS_TYPE.test(v);
}

export function isIntegrationEventType(v: unknown): v is IntegrationEventType {
  return typeof v === "string" && (INTEGRATION_EVENT_TYPES as readonly string[]).includes(v);
}

export type IdKeysResult = { ok: true; keys: string[] } | { ok: false; reason: "format" | "person" | "too_many" };

/** Reads "a_id, b_ids" (commas, spaces or new lines). Empty is allowed: the mapping then sends the event, its type and time and no ids. */
export function parseIdKeys(raw: unknown): IdKeysResult {
  const text = typeof raw === "string" ? raw : "";
  const keys = [...new Set(text.split(/[\s,]+/).map((k) => k.trim()).filter(Boolean))];
  if (keys.length > 20) return { ok: false, reason: "too_many" };
  if (keys.some((k) => PERSON_KEYS.has(k))) return { ok: false, reason: "person" };
  if (keys.some((k) => !ID_KEY.test(k))) return { ok: false, reason: "format" };
  return { ok: true, keys };
}

export type EndpointState = "active" | "auto_disabled" | "off";

/** Re-enable is offered only for an endpoint the platform switched off by itself; a hand-made switch-off stays with the integrations page. */
export function endpointState(e: { is_active: boolean; auto_disabled_at: string | null }): EndpointState {
  if (e.is_active) return "active";
  return e.auto_disabled_at ? "auto_disabled" : "off";
}

export const PARTNER_RESULTS = ["rotated", "reenabled", "mapped", "unmapped", "failed", "window_open", "invalid"] as const;
export type PartnerResult = (typeof PARTNER_RESULTS)[number];

export function parseResult(v: unknown): PartnerResult | null {
  return typeof v === "string" && (PARTNER_RESULTS as readonly string[]).includes(v) ? (v as PartnerResult) : null;
}
