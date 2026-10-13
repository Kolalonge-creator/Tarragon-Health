import { z } from "zod";

/**
 * S36a: the admin patient lookup (OQ-04). Search returns minimal identity only; opening a record needs a typed reason.
 * Both answers come from SECURITY DEFINER functions that re-check the admin role, so these schemas only describe the shape
 * and the helpers below only decide what to show.
 */
export const REASON_MIN = 10;
export const REASON_MAX = 500;
export const QUERY_MIN = 3;
export const QUERY_MAX = 80;

export const searchRowSchema = z.object({
  patient_id: z.string().uuid(),
  full_name: z.string().nullable(),
  patient_number: z.string().nullable(),
  phone_masked: z.string().nullable(),
  birth_year: z.number().int().nullable(),
  is_active: z.boolean(),
  is_test: z.boolean(),
});
export type SearchRow = z.infer<typeof searchRowSchema>;
export const searchRowsSchema = z.array(searchRowSchema);

export const purchaseSchema = z.object({
  label: z.string(),
  amount_kobo: z.number().int(),
  status: z.string(),
  purchased_at: z.string().nullable(),
});

export const recordSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  date_of_birth: z.string().nullable(),
  sex: z.string().nullable(),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  patient_number: z.string().nullable(),
  organisation_name: z.string().nullable(),
  is_active: z.boolean(),
  is_test: z.boolean(),
  created_at: z.string(),
  last_active_at: z.string().nullable(),
  purchases: z.array(purchaseSchema),
});
export type PatientRecord = z.infer<typeof recordSchema>;

export type SearchResult =
  | { ok: true; rows: SearchRow[] }
  | { ok: false; error: "query" | "denied" | "failed" };

export type OpenResult =
  | { ok: true; record: PatientRecord }
  | { ok: false; error: "reason" | "not_found" | "denied" | "failed" };

export const queryOk = (q: string): boolean => {
  const n = q.trim().length;
  return n >= QUERY_MIN && n <= QUERY_MAX;
};

export const reasonOk = (r: string): boolean => {
  const n = r.trim().length;
  return n >= REASON_MIN && n <= REASON_MAX;
};

/** Money that actually changed hands: pending, cancelled and refunded purchases stay in the list but not in the total. */
const PAID = new Set(["active", "completed", "expired"]);
export function paidTotalKobo(purchases: PatientRecord["purchases"]): number {
  return purchases.filter((p) => PAID.has(p.status)).reduce((sum, p) => sum + p.amount_kobo, 0);
}

/** Map a database error code to the one notice a person should see. Unknown codes are never shown as written. */
export function mapDbError(code: string | undefined, kind: "search" | "open"): "query" | "reason" | "not_found" | "denied" | "failed" {
  if (code === "42501") return "denied";
  if (code === "22023") return kind === "search" ? "query" : "reason";
  if (code === "P0002") return "not_found";
  return "failed";
}
