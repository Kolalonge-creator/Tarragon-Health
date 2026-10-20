import { z } from "zod";
import { Constants } from "@tarragon/shared";

/** Pure rules for the partner endpoint admin screen (S10y). No database, no React. Mirrors the database checks so a bad form fails early with a plain sentence; the database still enforces them. */

const ID_KEY = /^[a-z][a-z0-9_]*(_id|_ids)$/;
/** Names that identify a person. The database refuses these too (set_partner_event_mapping). */
export const PERSON_ID_KEYS = ["patient_id", "profile_id", "user_id", "member_id", "person_id", "clinician_id", "staff_id", "caregiver_id"] as const;

/** "lab_result_id, order_id" to ["lab_result_id", "order_id"]; null when any key is not allowed. Duplicates are dropped; at most 20 keys. */
export function parseIdKeys(raw: string): string[] | null {
  const keys = [...new Set(raw.split(/[\s,]+/).map((k) => k.trim()).filter(Boolean))];
  if (keys.length > 20) return null;
  if (keys.some((k) => !ID_KEY.test(k) || (PERSON_ID_KEYS as readonly string[]).includes(k))) return null;
  return keys;
}

const checked = z.literal("on");
const BUS_EVENT = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/).max(120);

export const rotateSchema = z.object({
  endpoint_id: z.string().uuid(),
  grace_hours: z.coerce.number().int().min(1).max(168),
  confirm: checked,
});

export const reenableSchema = z.object({
  endpoint_id: z.string().uuid(),
  reason: z.string().trim().min(10).max(300),
});

export const mappingSchema = z.object({
  bus_event_type: BUS_EVENT,
  integration_event_type: z.enum(Constants.public.Enums.integration_event_type),
  id_keys: z
    .string()
    .max(600)
    .transform((v, ctx) => {
      const keys = parseIdKeys(v);
      if (keys === null) {
        ctx.addIssue({ code: "custom", message: "id keys" });
        return z.NEVER;
      }
      return keys;
    }),
  confirm: checked,
});

export const removeMappingSchema = z.object({
  bus_event_type: BUS_EVENT,
  confirm: checked,
});

export type PartnerMessageKey =
  | "busops.partners.error.not_admin"
  | "busops.partners.error.invalid"
  | "busops.partners.error.failed"
  | "busops.partners.rotate.in_grace"
  | "busops.partners.enable.done"
  | "busops.partners.mappings.saved"
  | "busops.partners.mappings.removed";

/** What an action hands back to its form. `secret` is set only by a successful rotation, once. */
export interface PartnerActionState {
  status: "idle" | "ok" | "error";
  message?: PartnerMessageKey;
  endpointId?: string;
  secret?: string;
  graceEndsAt?: string | null;
}

export const IDLE: PartnerActionState = { status: "idle" };
