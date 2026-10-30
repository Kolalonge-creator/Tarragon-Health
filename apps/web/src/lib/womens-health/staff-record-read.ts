import { z } from "zod";

/**
 * Reads the clinician Women's Health record (pregnancy, antenatal visits, postnatal profile, breast symptom reports, fertility requests) through
 * the audited database function (OQ-555, INV-10 and INV-12). The clinician types no reason (OQ-558); the database writes a fixed phrase and one audit
 * row for every opening and every refusal.
 *
 * Each outcome is its own case. A refusal and a failed read are NEVER returned as an empty record, because a clinician who reads "nothing recorded"
 * for a read that was refused or that failed (for example a pregnancy not shown) makes a wrong decision.
 */

/** The slice of the Supabase client this needs, so a test can pass a fake. */
export interface WomensHealthRpcClient {
  rpc(fn: "read_womens_health_record_audited", args: { p_patient: string }): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

const replySchema = z.object({
  status: z.enum(["ok", "denied"]),
  pregnancy: z
    .object({
      is_pregnant: z.boolean().nullable(),
      estimated_due_date: z.string().nullable(),
      last_menstrual_period_date: z.string().nullable(),
      high_risk: z.boolean().nullable(),
      high_risk_notes: z.string().nullable(),
    })
    .nullable(),
  antenatal_visits: z.array(
    z.object({
      id: z.string(),
      visit_number: z.number(),
      gestational_week_at_visit: z.number().nullable(),
      status: z.string(),
      findings: z.string().nullable(),
    }),
  ),
  postnatal_profiles: z.array(
    z.object({ id: z.string(), delivery_date: z.string(), delivery_mode: z.string().nullable(), complications: z.string().nullable() }),
  ),
  breast_reports: z.array(
    z.object({ id: z.string(), created_at: z.string(), symptom_types: z.array(z.string()), laterality: z.string().nullable() }),
  ),
  fertility_requests: z.array(
    z.object({
      id: z.string(),
      created_at: z.string(),
      trying_duration_months: z.number().nullable(),
      concern_notes: z.string().nullable(),
      status: z.string(),
    }),
  ),
});

export type WomensHealthRecord = Omit<z.infer<typeof replySchema>, "status">;

export type WomensHealthRecordOutcome = { kind: "ok"; record: WomensHealthRecord } | { kind: "denied" } | { kind: "error" };

/** True when there is nothing to show in any of the five sections (only meaningful for an "ok" read). */
export function womensHealthRecordIsEmpty(r: WomensHealthRecord): boolean {
  return (
    !r.pregnancy?.is_pregnant &&
    r.antenatal_visits.length === 0 &&
    r.postnatal_profiles.length === 0 &&
    r.breast_reports.length === 0 &&
    r.fertility_requests.length === 0
  );
}

export async function loadWomensHealthRecord(client: WomensHealthRpcClient, patientId: string): Promise<WomensHealthRecordOutcome> {
  const { data, error } = await client.rpc("read_womens_health_record_audited", { p_patient: patientId });
  if (error) return { kind: "error" };
  const parsed = replySchema.safeParse(data);
  if (!parsed.success) return { kind: "error" };
  if (parsed.data.status === "denied") return { kind: "denied" };
  const d = parsed.data;
  return {
    kind: "ok",
    record: {
      pregnancy: d.pregnancy,
      antenatal_visits: d.antenatal_visits,
      postnatal_profiles: d.postnatal_profiles,
      breast_reports: d.breast_reports,
      fertility_requests: d.fertility_requests,
    },
  };
}
