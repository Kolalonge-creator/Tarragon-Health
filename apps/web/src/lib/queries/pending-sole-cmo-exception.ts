import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export const SOLE_CMO_EXCEPTION_COMPETENCY = "on_call";

export type PendingSoleCmoException = {
  /** The organisation has exactly one active Chief Medical Officer and no exception is in force, so the rota cannot include them yet. */
  waiting: boolean;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Rows<T> = PromiseLike<{ data: T[] | null; error: unknown }>;
type Loose = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string | boolean): {
        eq(column: string, value: string | boolean): { eq(column: string, value: string | boolean): Rows<{ id: string; is_test?: boolean; expires_at?: string; revoked_at?: string | null }> };
        is(column: string, value: null): Rows<{ id: string; expires_at: string }>;
      };
    };
  };
};

/**
 * Whether the sole-CMO on-call exception still awaits the Chief Medical Officer's signature. Only shown while the organisation has exactly one
 * active Chief Medical Officer of the same kind (real or test) as the person reading, and no unrevoked, unexpired exception exists. Same rule
 * as the other hub sources: it never throws, and a failed read says so.
 */
export async function readPendingSoleCmoException(supabase: SupabaseClient<Database>, now: Date = new Date()): Promise<PendingSoleCmoException> {
  try {
    const loose = supabase as unknown as Loose;
    const cmos = await loose.from("clinical_staff").select("id, is_test").eq("doctor_tier", "chief_medical_officer").eq("active", true).eq("status", "active");
    if (cmos.error || !cmos.data) return { waiting: false, failed: true };
    const real = cmos.data.filter((r) => !r.is_test).length;
    const test = cmos.data.length - real;
    // A real organisation counts real CMOs; a test one counts test CMOs. Whichever kind is present alone decides.
    const sole = real > 0 ? real === 1 : test === 1;
    if (!sole) return { waiting: false, failed: false };
    const ex = await loose.from("sole_cmo_exceptions").select("id, expires_at").eq("competency_code", SOLE_CMO_EXCEPTION_COMPETENCY).is("revoked_at", null);
    if (ex.error || !ex.data) return { waiting: false, failed: true };
    const inForce = ex.data.some((r) => new Date(r.expires_at).getTime() > now.getTime());
    return { waiting: !inForce, failed: false };
  } catch {
    return { waiting: false, failed: true };
  }
}
