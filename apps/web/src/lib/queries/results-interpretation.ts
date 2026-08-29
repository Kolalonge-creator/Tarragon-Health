import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/** Mirrors useVideoVisitPrice (consult-slots.ts) — org override wins over the
 * platform default, same rule private.pin_results_interpretation_amount applies. */
export function useResultsInterpretationPrice() {
  return useQuery({
    queryKey: ["results-interpretation", "price"],
    queryFn: async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: profile } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", user.id)
        .single();
      const { data, error } = await supabase
        .from("results_interpretation_prices")
        .select("organisation_id, amount_minor, currency, is_enabled")
        .eq("is_enabled", true);
      if (error) throw error;
      const rows = data ?? [];
      const override = rows.find(
        (r) => r.organisation_id !== null && r.organisation_id === profile?.organisation_id,
      );
      return override ?? rows.find((r) => r.organisation_id === null) ?? null;
    },
  });
}
