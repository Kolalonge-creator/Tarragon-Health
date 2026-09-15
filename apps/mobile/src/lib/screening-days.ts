import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";

export type ScreeningDay = Tables<"screening_days">;
export type ScreeningDaySlot = Tables<"screening_day_slots">;
export type PanelBundleOption = Pick<Tables<"panel_bundles">, "id" | "code" | "name" | "price_kobo">;

/** Mirrors apps/web/src/lib/queries/screening-days.ts's useScreeningDays. */
export async function loadScreeningDays(): Promise<QueryResult<ScreeningDay[]>> {
  const { data, error } = await supabase
    .from("screening_days")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

export async function loadScreeningDaySlots(screeningDayId: string): Promise<QueryResult<ScreeningDaySlot[]>> {
  const { data, error } = await supabase
    .from("screening_day_slots")
    .select("*")
    .eq("screening_day_id", screeningDayId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

/** The catalogue a screening day can be booked against — same self-bookable list any patient books individually, never a separate price list. */
export async function loadSelfBookablePanelBundles(): Promise<QueryResult<PanelBundleOption[]>> {
  const { data, error } = await supabase
    .from("panel_bundles")
    .select("id, code, name, price_kobo")
    .eq("is_active", true)
    .eq("self_bookable", true)
    .order("price_kobo", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

/**
 * "Bring your church, market association, cooperative, or SME office and get
 * a discounted rate" — mirrors apps/web/.../screening-days/actions.ts's
 * requestScreeningDay. Anyone authenticated can request one; staff confirm
 * the discounted price before anyone pays.
 */
export async function requestScreeningDay(input: {
  hostName: string;
  contactPhone: string;
  location: string;
  eventDate: string;
  panelBundleId: string;
  slotsRequested: number;
  notes: string;
}): Promise<QueryResult<null>> {
  if (!input.hostName.trim()) return { ok: false, error: "Who is this screening day for?" };
  if (!input.location.trim()) return { ok: false, error: "Where will this happen?" };
  if (!input.eventDate) return { ok: false, error: "When is it happening?" };
  if (!input.panelBundleId) return { ok: false, error: "Choose which check you'd like people to have." };
  if (!Number.isFinite(input.slotsRequested) || input.slotsRequested <= 0) {
    return { ok: false, error: "How many people are coming?" };
  }

  const { error } = await supabase.rpc("request_screening_day", {
    p_host_name: input.hostName,
    p_contact_phone: input.contactPhone,
    p_location: input.location,
    p_event_date: input.eventDate,
    p_panel_bundle_id: input.panelBundleId,
    p_slots_requested: input.slotsRequested,
    p_notes: input.notes || undefined,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Registers one attendee ahead of time or on the day — name and phone only, they don't need an account yet. */
export async function addScreeningDaySlot(input: {
  screeningDayId: string;
  fullName: string;
  phone: string;
}): Promise<QueryResult<null>> {
  if (!input.fullName.trim()) return { ok: false, error: "Their name?" };
  const { error } = await supabase.rpc("add_screening_day_slot", {
    p_screening_day_id: input.screeningDayId,
    p_full_name: input.fullName,
    p_phone: input.phone || undefined,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
