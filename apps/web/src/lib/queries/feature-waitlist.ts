import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/** The features a patient can ask to hear about. Must match the check constraint on public.feature_waitlist. */
export type WaitlistFeature = "consultations" | "membership" | "directory";

const key = (feature: WaitlistFeature) => ["feature-waitlist", feature] as const;

/** Whether the signed-in patient is on the list. A failed read is an error, never "not on the list". */
export function useOnWaitlist(feature: WaitlistFeature) {
  return useQuery({
    queryKey: key(feature),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("feature_waitlist").select("id").eq("feature_key", feature).maybeSingle();
      if (error) throw error;
      return data !== null;
    },
  });
}

/** Join or leave. Row-level security scopes both to the signed-in patient, so only the feature is sent. */
export function useSetWaitlist(feature: WaitlistFeature) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (join: boolean) => {
      const supabase = createClient();
      if (!join) {
        const { error } = await supabase.from("feature_waitlist").delete().eq("feature_key", feature);
        if (error) throw error;
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("not signed in");
      const { data: profile, error: profileError } = await supabase.from("profiles").select("organisation_id").eq("id", userId).single();
      if (profileError || !profile?.organisation_id) throw profileError ?? new Error("no organisation");
      const { error } = await supabase.from("feature_waitlist").insert({ organisation_id: profile.organisation_id, patient_id: userId, feature_key: feature });
      // Already on the list (a second tab, a double tap) is the state the person asked for.
      if (error && error.code !== "23505") throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(feature) }),
  });
}
