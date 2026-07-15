import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { CommissionStatus, CommissionType, Tables } from "@tarragon/shared";

export type Commission = Tables<"commissions">;

export type CommissionFilters = {
  type?: CommissionType;
  status?: CommissionStatus;
  from?: string;
  to?: string;
};

const COMMISSIONS_QUERY_KEY = "admin-commissions";

/**
 * Admin-facing commission ledger. RLS (private.is_org_staff) does the
 * scoping — an admin caller's role='admin' short-circuits the org check
 * entirely (see private.is_org_staff()), so this deliberately has no
 * explicit .eq("organisation_id", ...) filter: an admin sees commissions
 * across every organisation, not just their own.
 */
export function useAdminCommissions(filters: CommissionFilters) {
  return useQuery({
    queryKey: [COMMISSIONS_QUERY_KEY, filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase.from("commissions").select("*");
      if (filters.type) query = query.eq("commission_type", filters.type);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.from) query = query.gte("earned_at", filters.from);
      if (filters.to) query = query.lte("earned_at", filters.to);
      const { data, error } = await query.order("earned_at", { ascending: false });
      if (error) throw error;
      return data as Commission[];
    },
  });
}

/** Marks a commission as paid out/received — the one write action this dashboard exposes. */
export function useMarkCommissionPaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (commissionId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("commissions")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", commissionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [COMMISSIONS_QUERY_KEY] });
    },
  });
}
