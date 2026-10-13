import { z } from "zod";

/**
 * S36h: shapes and rules for a partner pharmacy's "Flag a problem" on a prescription sent to it. Pure: no I/O.
 * The database is the protection (own pharmacy only, state sent only, reason length, append only); the form checks give a clear message first.
 */
export const FLAG_KINDS = ["out_of_stock", "query_to_prescriber", "other"] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];
// Mirrors the CHECK on prescription_pharmacy_flags.reason (10 to 500 characters after trimming).
export const REASON_MIN = 10;
export const REASON_MAX = 500;

export const NOTICES = ["flagged", "flag_failed", "flag_reason", "flag_not_open"] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: unknown): Notice | null => ((NOTICES as readonly unknown[]).includes(v) ? (v as Notice) : null);

export const flagFormSchema = z.object({
  prescription: z.string().uuid(),
  kind: z.enum(FLAG_KINDS),
  reason: z.string().transform((s) => s.trim()).pipe(z.string().min(REASON_MIN).max(REASON_MAX)),
});

const itemSchema = z.record(z.string(), z.unknown());

export const pharmacyPrescriptionRowSchema = z.object({
  prescription_id: z.string().uuid(),
  state: z.enum(["sent", "dispensed"]),
  sent_at: z.string().nullable(),
  dispensed_at: z.string().nullable(),
  patient_name: z.string().nullable(),
  patient_number: z.string().nullable(),
  items: z.array(itemSchema),
  open_flags: z.number(),
  location_name: z.string().nullable(),
  code_locked: z.boolean(),
});
export type PharmacyPrescriptionRow = z.infer<typeof pharmacyPrescriptionRowSchema>;
export const pharmacyPrescriptionRowsSchema = z.array(pharmacyPrescriptionRowSchema);

export const prescriberFlagRowSchema = z.object({
  flag_id: z.string().uuid(),
  prescription_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  patient_name: z.string().nullable(),
  pharmacy_name: z.string().nullable(),
  kind: z.enum(FLAG_KINDS),
  reason: z.string(),
  items: z.array(itemSchema),
  created_at: z.string(),
});
export type PrescriberFlagRow = z.infer<typeof prescriberFlagRowSchema>;
export const prescriberFlagRowsSchema = z.array(prescriberFlagRowSchema);

/** A short, readable line for one prescription item. The item shape is the prescriber's; show the common keys, never guess at others. */
export function itemLine(item: Record<string, unknown>): string {
  const pick = (k: string) => (typeof item[k] === "string" ? (item[k] as string).trim() : "");
  const name = pick("drug") || pick("name") || pick("medication");
  const rest = [pick("dose"), pick("frequency"), pick("quantity")].filter(Boolean).join(", ");
  return [name, rest].filter(Boolean).join(" - ") || "Item";
}

export const kindKey = (k: FlagKind) => `pharmflag.kind.${k}` as const;
