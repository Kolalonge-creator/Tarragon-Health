import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ScreeningDay = Tables<"screening_days">;
export type ScreeningDaySlot = Tables<"screening_day_slots">;

const SCREENING_DAYS_QUERY_KEY = "screening-days";
const SCREENING_DAY_SLOTS_QUERY_KEY = "screening-day-slots";
const SELF_BOOKABLE_BUNDLES_QUERY_KEY = "self-bookable-panel-bundles";

/**
 * Every screening day the caller can see: RLS already scopes this to ones
 * they requested, ones they pay for, or (for staff) every one on their org —
 * see the screening_days_select policy in
 * supabase/migrations/20260829003735_group_screening_days.sql. No explicit
 * filter here on purpose, same reasoning as useAdminCommissions.
 */
export function useScreeningDays() {
  return useQuery({
    queryKey: [SCREENING_DAYS_QUERY_KEY],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("screening_days")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ScreeningDay[];
    },
  });
}

export function useScreeningDaySlots(screeningDayId: string | undefined) {
  return useQuery({
    queryKey: [SCREENING_DAY_SLOTS_QUERY_KEY, screeningDayId],
    enabled: !!screeningDayId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("screening_day_slots")
        .select("*")
        .eq("screening_day_id", screeningDayId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as ScreeningDaySlot[];
    },
  });
}

/** The catalogue a screening day can be booked against — the same self-bookable list any patient books from individually, never a separate price list. */
export function useSelfBookablePanelBundles() {
  return useQuery({
    queryKey: [SELF_BOOKABLE_BUNDLES_QUERY_KEY],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("panel_bundles")
        .select("id, code, name, price_kobo")
        .eq("is_active", true)
        .eq("self_bookable", true)
        .order("price_kobo", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useAddScreeningDaySlot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { screeningDayId: string; fullName: string; phone?: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("add_screening_day_slot", {
        p_screening_day_id: args.screeningDayId,
        p_full_name: args.fullName,
        p_phone: args.phone,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [SCREENING_DAY_SLOTS_QUERY_KEY, variables.screeningDayId] });
    },
  });
}

/** Staff-only: confirms a request, freezing the discounted price. */
export function useConfirmScreeningDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      screeningDayId: string;
      slotsConfirmed: number;
      discountPercent: number;
      payerProfileId?: string;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("confirm_screening_day", {
        p_screening_day_id: args.screeningDayId,
        p_slots_confirmed: args.slotsConfirmed,
        p_discount_percent: args.discountPercent,
        p_payer_profile_id: args.payerProfileId,
      });
      if (error) throw error;
      return data as { ok: true; price_per_head_kobo: number; total_kobo: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SCREENING_DAYS_QUERY_KEY] });
    },
  });
}

/** Staff-only: looks up an attendee's own Tarragon account by phone, same-org restriction as find_profile_by_phone. */
export function useFindProfileByPhone() {
  return useMutation({
    mutationFn: async (phone: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("find_profile_by_phone", { lookup_phone: phone }).maybeSingle();
      if (error) throw error;
      return data as { id: string; full_name: string | null } | null;
    },
  });
}

/** Staff-only: issues one attendee their own named, prepaid Care Voucher, funded by the group's bulk payment. */
export function useIssueScreeningDayVoucher() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { slotId: string; beneficiaryProfileId: string; screeningDayId: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("issue_screening_day_voucher", {
        p_slot_id: args.slotId,
        p_beneficiary_profile_id: args.beneficiaryProfileId,
      });
      if (error) throw error;
      return data as { ok: true; voucher_id: string; voucher_number: string };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [SCREENING_DAY_SLOTS_QUERY_KEY, variables.screeningDayId] });
    },
  });
}
