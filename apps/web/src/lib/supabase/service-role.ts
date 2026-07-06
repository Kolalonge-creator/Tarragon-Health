import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Service-role Supabase client — bypasses RLS entirely. Server-only: never
 * import this from a Client Component or anything bundled to the browser
 * (SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix, so Next.js will
 * refuse to inline it client-side, but don't rely on that as the only
 * guard).
 *
 * Use only for writes where trusting the caller's own RLS-scoped session
 * would let a patient forge a value the app computes on their behalf (e.g.
 * prevention_risk_scores.tier, screening_schedules.due_date/status) — never
 * for a patient's own raw input (vitals_readings, risk_assessment_responses,
 * etc.), which stays on the patient's RLS-scoped session so RLS keeps doing
 * its job there.
 */
export function createServiceRoleClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
