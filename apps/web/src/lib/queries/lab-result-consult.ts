import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export const labResultConsultKeys = {
  price: ["lab-result-consult-price"] as const,
};

/**
 * The self-arranged lab-result consultation fee a patient would pay — org
 * override if one exists, else the platform default (₦10,000 at launch).
 * Mirrors useVideoVisitPrice's shape (consult-slots.ts) exactly: read-only,
 * shown before payment so the "pay to upload" prompt can quote a real
 * number instead of a vague "there's a fee."
 */
export function useLabResultConsultPrice() {
  return useQuery({
    queryKey: labResultConsultKeys.price,
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
        .from("lab_result_consult_prices")
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
