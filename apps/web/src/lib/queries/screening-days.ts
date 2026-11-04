import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ScreeningDay = Tables<"screening_days">;
export type ScreeningDaySlot = Tables<"screening_day_slots">;
export type OutreachEnrolment = Tables<"outreach_enrolments">;

/**
 * What a screening day is (OD-01, 2026-11-03): the original discounted test bundle with vouchers, a free community check
 * (vitals + a lab form), or a paid outreach place (the same plus one results consultation).
 */
export type ScreeningDayKind = "bundle" | "outreach_free" | "outreach_paid";
export type OutreachKind = Exclude<ScreeningDayKind, "bundle">;

export function screeningDayKind(day: Pick<ScreeningDay, "kind">): ScreeningDayKind {
  return day.kind === "outreach_free" || day.kind === "outreach_paid" ? day.kind : "bundle";
}

export function isOutreachDay(day: Pick<ScreeningDay, "kind">): boolean {
  return screeningDayKind(day) !== "bundle";
}

/** A free outreach day takes attendees with no payment; every other kind waits until the group has paid in full. */
export function screeningDayReadyForAttendees(day: Pick<ScreeningDay, "kind" | "total_kobo" | "amount_paid_kobo">): boolean {
  if (screeningDayKind(day) === "outreach_free") return true;
  return (day.total_kobo ?? 0) > 0 && day.amount_paid_kobo >= (day.total_kobo ?? 0);
}

export const SCREENING_DAYS_QUERY_KEY = "screening-days";
const SCREENING_DAY_SLOTS_QUERY_KEY = "screening-day-slots";
const SELF_BOOKABLE_BUNDLES_QUERY_KEY = "self-bookable-panel-bundles";
const OUTREACH_ENROLMENTS_QUERY_KEY = "outreach-enrolments";
const MY_OUTREACH_ENROLMENTS_QUERY_KEY = "my-outreach-enrolments";
const OUTREACH_PRICE_QUERY_KEY = "outreach-day-price";

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
        // indicative_price_kobo is what a LABORATORY charges; price_kobo
        // stopped being a Tarragon price on 2026-09-10 and must not be
        // rendered as one.
        .select("id, code, name, price_kobo, indicative_price_kobo")
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

/** Staff-only: the active per-head price of a paid outreach place (outreach_day_prices, versioned). */
export function useActiveOutreachPrice() {
  return useQuery({
    queryKey: [OUTREACH_PRICE_QUERY_KEY],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("outreach_day_prices")
        .select("version, price_per_head_kobo")
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** Staff-only: creates a free community check or a paid outreach check. */
export function useCreateOutreachDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      kind: OutreachKind;
      hostName: string;
      contactPhone: string;
      location: string;
      eventDate: string;
      slotsRequested: number;
      notes?: string;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("create_outreach_day", {
        p_kind: args.kind,
        p_host_name: args.hostName,
        p_contact_phone: args.contactPhone,
        p_location: args.location,
        p_event_date: args.eventDate,
        p_slots_requested: args.slotsRequested,
        p_notes: args.notes,
      });
      if (error) throw error;
      return data as { ok: true; screening_day_id: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SCREENING_DAYS_QUERY_KEY] });
    },
  });
}

/** Staff-only: who has been enrolled at one outreach day, and whether their vitals are in. */
export function useOutreachEnrolments(screeningDayId: string | undefined) {
  return useQuery({
    queryKey: [OUTREACH_ENROLMENTS_QUERY_KEY, screeningDayId],
    enabled: !!screeningDayId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("outreach_enrolments")
        .select("slot_id, kind, lab_order_id, consult_purchase_id, vitals_recorded_at")
        .eq("screening_day_id", screeningDayId as string);
      if (error) throw error;
      return data;
    },
  });
}

/**
 * The signed-in patient's own outreach checks. RLS (outreach_enrolments_select) admits only the patient and org staff, so
 * the employer who paid never reads this (I9).
 */
export function useMyOutreachEnrolments() {
  return useQuery({
    queryKey: [MY_OUTREACH_ENROLMENTS_QUERY_KEY],
    queryFn: async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("outreach_enrolments")
        .select("slot_id, kind, lab_order_id, consult_purchase_id, enrolled_at, consult:service_purchases(status, redeemed_at, expires_at)")
        .eq("patient_id", user.id)
        .order("enrolled_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

/** Staff-only: links a registered attendee to their own Tarragon account; makes their lab form and (paid) consultation credit. */
export function useEnrolOutreachAttendee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { slotId: string; patientId: string; screeningDayId: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("enrol_outreach_attendee", {
        p_slot_id: args.slotId,
        p_patient_id: args.patientId,
      });
      if (error) throw error;
      return data as { ok: true; lab_order_id: string; lab_order_reused: boolean; consult_purchase_id: string | null };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [SCREENING_DAY_SLOTS_QUERY_KEY, variables.screeningDayId] });
      queryClient.invalidateQueries({ queryKey: [OUTREACH_ENROLMENTS_QUERY_KEY, variables.screeningDayId] });
    },
  });
}

export type OutreachVitals = {
  bp_readings: { systolic: number; diastolic: number }[];
  glucose_mmol_l?: number;
  glucose_context?: "fasting" | "random";
  weight_kg?: number;
  pulse_bpm?: number;
  spo2_pct?: number;
};

/** Staff-only: records an enrolled attendee's readings into their own vitals record (red-flag rules apply as usual). */
export function useRecordOutreachVitals() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { slotId: string; screeningDayId: string; vitals: OutreachVitals }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("record_outreach_vitals", {
        p_slot_id: args.slotId,
        p_data: args.vitals,
      });
      if (error) throw error;
      return data as { vitals_rows: number };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [OUTREACH_ENROLMENTS_QUERY_KEY, variables.screeningDayId] });
    },
  });
}
