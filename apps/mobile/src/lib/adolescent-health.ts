import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

/**
 * Native equivalent of apps/web/.../patient/adolescent-health/page.tsx's
 * data reads (last check-in + transition plan) and sharing-card.tsx's
 * sexual/reproductive-health confidentiality waivers. Reads/writes here are
 * plain RLS-gated client calls, same as web's cookie-session reads --
 * unlike the check-in submission itself (postAdolescentHealthScreen in
 * api.ts), nothing here needs a service-role route: patient_id = auth.uid()
 * is what the RLS policies already require.
 */

export interface LastAdolescentScreen {
  createdAt: string;
  reviewedAt: string | null;
}

export async function loadLastAdolescentScreen(): Promise<QueryResult<LastAdolescentScreen | null>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data, error } = await supabase
    .from("adolescent_psychosocial_screens")
    .select("created_at, reviewed_at")
    .eq("patient_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ? { createdAt: data.created_at, reviewedAt: data.reviewed_at } : null };
}

export const TRANSITION_STAGE_LABEL: Record<string, string> = {
  transition_assessment: "Transition assessment",
  independent_account_prep: "Independent account preparation",
  health_literacy: "Health literacy",
  medication_independence: "Medication independence",
  adult_care_handoff: "Adult care",
};
export const TRANSITION_STAGES = Object.keys(TRANSITION_STAGE_LABEL);

export interface AdolescentTransitionPlan {
  currentStage: string;
  targetTransitionAge: number;
}

export async function loadAdolescentTransitionPlan(): Promise<QueryResult<AdolescentTransitionPlan | null>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data, error } = await supabase
    .from("adolescent_transition_plans")
    .select("current_stage, target_transition_age")
    .eq("patient_id", user.id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: data ? { currentStage: data.current_stage, targetTransitionAge: data.target_transition_age } : null,
  };
}

export interface SexualHealthGrantee {
  profileId: string;
  fullName: string | null;
  waiverId: string | null;
}

export async function loadSexualHealthSharing(): Promise<QueryResult<SexualHealthGrantee[]>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const [{ data: grantees, error: granteesError }, { data: waivers, error: waiversError }] = await Promise.all([
    supabase
      .from("profile_access")
      .select("grantee:profiles!profile_access_grantee_user_id_fkey(id, full_name)")
      .eq("profile_id", user.id),
    supabase
      .from("adolescent_confidentiality_waivers")
      .select("id, grantee_user_id")
      .eq("patient_id", user.id)
      .eq("domain", "sexual_reproductive_health")
      .is("revoked_at", null),
  ]);
  if (granteesError) return { ok: false, error: granteesError.message };
  if (waiversError) return { ok: false, error: waiversError.message };

  const waiverByGrantee = new Map((waivers ?? []).map((w) => [w.grantee_user_id, w]));
  const result: SexualHealthGrantee[] = (grantees ?? []).flatMap((row) => {
    if (!row.grantee) return [];
    return [
      {
        profileId: row.grantee.id,
        fullName: row.grantee.full_name,
        waiverId: waiverByGrantee.get(row.grantee.id)?.id ?? null,
      },
    ];
  });
  return { ok: true, data: result };
}

export async function grantSexualHealthSharing(granteeUserId: string): Promise<{ error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const { error } = await supabase.from("adolescent_confidentiality_waivers").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    grantee_user_id: granteeUserId,
    domain: "sexual_reproductive_health",
  });
  return error ? { error: error.message } : {};
}

export async function revokeSexualHealthSharing(waiverId: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("adolescent_confidentiality_waivers")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", waiverId);
  return error ? { error: error.message } : {};
}
