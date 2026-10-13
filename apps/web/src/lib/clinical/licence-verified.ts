import { z } from "zod";

/**
 * "Licence verified on <date>" (CMO answer Q17). The only registration fact a patient-facing screen may show about a clinician is a
 * date, and only when public.clinician_licence_verified_on() holds a stored verification record for them and their licence on file is
 * in date. The folio (MDCN) number is never selected, never passed and never shown here: the database function does not return it.
 */
const rowSchema = z.looseObject({ staff_id: z.string(), profile_id: z.string().nullable(), verified_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** The verification date for each id given (a clinical_staff id or a profile id). An id with no stored record is simply absent. */
export async function fetchLicenceVerifiedOn(client: object, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(ids.filter((i) => z.uuid().safeParse(i).success))];
  if (wanted.length === 0) return out;
  const { data, error } = await (client as RpcClient).rpc("clinician_licence_verified_on", { p_ids: wanted });
  if (error) return out; // a failed lookup shows no badge; it can never invent one
  const parsed = z.array(rowSchema).safeParse(data);
  if (!parsed.success) return out;
  for (const r of parsed.data) {
    out.set(r.staff_id, r.verified_on);
    if (r.profile_id) out.set(r.profile_id, r.verified_on);
  }
  return out;
}

/** "12 Oct 2026", in Lagos time (the date is a calendar date, so it is formatted at noon UTC to avoid a day shift). */
export function formatLicenceVerifiedDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}
