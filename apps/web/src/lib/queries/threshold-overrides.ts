import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/** The new personal-threshold tables and functions are not in the generated types yet (the file is spliced, not regenerated, per CLAUDE.md), so reads go through this narrow shape. */
type Rows<T> = PromiseLike<{ data: T[] | null; error: unknown }>;
type Rpc<T> = PromiseLike<{ data: T | null; error: unknown }>;
type Loose = {
  from(table: string): { select(columns: string): { eq(column: string, value: string): { in(column: string, values: string[]): { order(column: string, o: { ascending: boolean }): Rows<PatientOverrideRow> } } } };
  rpc(fn: string, args?: Record<string, unknown>): Rpc<unknown>;
};

export type PatientOverrideRow = {
  id: string;
  domain: "bp" | "glucose";
  params: Record<string, unknown>;
  reason: string;
  status: "draft" | "active";
  valid_days: number;
  expires_at: string | null;
  review_due_at: string | null;
};

/** The draft and active personal thresholds on one patient (RLS: only a doctor tied to the patient sees any). Never throws; `failed` says a read failed. */
export async function readPatientOverrides(supabase: SupabaseClient<Database>, patientId: string): Promise<{ rows: PatientOverrideRow[]; failed: boolean }> {
  try {
    const { data, error } = await (supabase as unknown as Loose)
      .from("patient_threshold_overrides")
      .select("id, domain, params, reason, status, valid_days, expires_at, review_due_at")
      .eq("patient_id", patientId)
      .in("status", ["draft", "active"])
      .order("created_at", { ascending: false });
    if (error || !data) return { rows: [], failed: true };
    return { rows: data, failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

export type ThresholdHubState = { policyWaiting: boolean; policyVersion: number | null; policyId: string | null; policyActive: boolean; active: number; reviewsOverdue: number; failed: boolean };

/** What the CMO sign-off hub needs: is the policy waiting for a signature, and how many overrides are live / overdue for review. Never throws. */
export async function readThresholdHubState(supabase: SupabaseClient<Database>): Promise<ThresholdHubState> {
  const failed: ThresholdHubState = { policyWaiting: false, policyVersion: null, policyId: null, policyActive: false, active: 0, reviewsOverdue: 0, failed: true };
  try {
    const { data, error } = await (supabase as unknown as Loose).rpc("threshold_override_oversight_counts");
    if (error || !data || typeof data !== "object") return failed;
    const d = data as { policyActive?: boolean; policyVersionWaiting?: number | null; policyIdWaiting?: string | null; active?: number; reviewsOverdue?: number };
    return {
      policyWaiting: d.policyActive !== true && typeof d.policyVersionWaiting === "number",
      policyVersion: typeof d.policyVersionWaiting === "number" ? d.policyVersionWaiting : null,
      policyId: typeof d.policyIdWaiting === "string" ? d.policyIdWaiting : null,
      policyActive: d.policyActive === true,
      active: Number(d.active ?? 0),
      reviewsOverdue: Number(d.reviewsOverdue ?? 0),
      failed: false,
    };
  } catch {
    return failed;
  }
}

export type OversightRow = {
  id: string; patientId: string; domain: "bp" | "glucose"; params: Record<string, unknown>; reason: string; status: string; proposedBy: string | null; signedBy: string | null;
  signedAt: string | null; expiresAt: string | null; reviewDueAt: string | null; lastReviewedAt: string | null; endedAt: string | null; endReason: string | null;
  reviewOverdue: boolean; isTest: boolean; appliedCount: number;
};

/** The CMO's roster (audited by the database). Never throws. */
export async function readOversightRoster(supabase: SupabaseClient<Database>): Promise<{ rows: OversightRow[]; failed: boolean }> {
  try {
    const { data, error } = await (supabase as unknown as Loose).rpc("list_threshold_overrides_for_oversight");
    if (error || !Array.isArray(data)) return { rows: [], failed: true };
    return { rows: data as OversightRow[], failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

/** Whether the patient should see the "your care team set personal targets" note. A bare yes or no, never a number. A failed read shows nothing. */
export async function readMyThresholdNotice(supabase: SupabaseClient<Database>): Promise<boolean> {
  try {
    const { data, error } = await (supabase as unknown as Loose).rpc("my_threshold_override_notice");
    return !error && data === true;
  } catch {
    return false;
  }
}
