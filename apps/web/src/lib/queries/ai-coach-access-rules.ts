import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { AiCoachAccessRuleInput } from "@/lib/validation/ai-coach-access-rules";

export type AiCoachAccessRule = Tables<"ai_coach_access_rules"> & {
  patient: { full_name: string | null; phone: string | null } | null;
};

const QUERY_KEY = ["ai-coach-access-rules"];

async function getAdminOrganisationId(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    throw new Error("This admin account has no organisation on file");
  }
  return profile.organisation_id;
}

export function useAiCoachAccessRules() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("ai_coach_access_rules")
        .select("*, patient:profiles!ai_coach_access_rules_patient_id_fkey(full_name, phone)")
        .order("patient_id", { ascending: true, nullsFirst: true });
      if (error) throw error;
      return data as AiCoachAccessRule[];
    },
  });
}

/** Only the fields the caller actually provided — `enabled` and
 * `daily_limit` are independent knobs on the same row (e.g. "just set a
 * cap, don't touch the grant"), so an update must never blindly overwrite
 * one with `undefined`. Note: creating a brand-new row via a cap-only patch
 * still grants access, since `enabled` defaults to `true` at the DB level —
 * setting a cap for someone implies they should have access. */
function buildPatch(input: AiCoachAccessRuleInput) {
  const patch: { enabled?: boolean; daily_limit?: number } = {};
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.daily_limit !== undefined) patch.daily_limit = input.daily_limit;
  return patch;
}

/** Same not-a-blind-upsert reasoning as useUpsertVitalsReminderRule: the two
 * scopes are enforced by partial unique indexes that onConflict can't target
 * directly, so find any existing row for the scope and branch update/insert. */
export function useUpsertAiCoachAccessRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AiCoachAccessRuleInput) => {
      const supabase = createClient();
      const organisation_id = await getAdminOrganisationId();
      const patch = buildPatch(input);

      if (input.scope === "patient") {
        const { data: patient, error: patientError } = await supabase
          .from("profiles")
          .select("id")
          .eq("phone", input.patient_phone)
          .eq("role", "patient")
          .maybeSingle();
        if (patientError) throw patientError;
        if (!patient) throw new Error("No patient found with that phone number");

        const { data: existing } = await supabase
          .from("ai_coach_access_rules")
          .select("id")
          .eq("organisation_id", organisation_id)
          .eq("patient_id", patient.id)
          .maybeSingle();

        const { error } = existing
          ? await supabase.from("ai_coach_access_rules").update(patch).eq("id", existing.id)
          : await supabase.from("ai_coach_access_rules").insert({
              organisation_id,
              patient_id: patient.id,
              ...patch,
            });
        if (error) throw error;
        return;
      }

      const { data: existing } = await supabase
        .from("ai_coach_access_rules")
        .select("id")
        .eq("organisation_id", organisation_id)
        .is("patient_id", null)
        .maybeSingle();

      const { error } = existing
        ? await supabase.from("ai_coach_access_rules").update(patch).eq("id", existing.id)
        : await supabase.from("ai_coach_access_rules").insert({ organisation_id, ...patch });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

export function useDeleteAiCoachAccessRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("ai_coach_access_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
