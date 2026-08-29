"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { findOrCreateProfileByPhone } from "./find-or-create-by-phone";

export type ScreeningEventActionState = { error?: string; message?: string } | undefined;

async function requireOrgStaff() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "patient" || !profile.organisation_id) {
    throw new Error("Staff access required");
  }
  return profile;
}

const phoneSchema = z.string().regex(/^\+[1-9][0-9]{7,14}$/, "Enter a phone number in E.164 form, e.g. +2348012345678");

const createEventSchema = z.object({
  organiser_phone: phoneSchema,
  organiser_name: z.string().trim().min(2, "Enter the organiser's name"),
  organiser_type: z.enum([
    "church",
    "mosque",
    "market_association",
    "alumni_association",
    "hometown_union",
    "cooperative_society",
    "sme",
    "other",
  ]),
  panel_bundle_id: z.string().uuid("Choose a panel"),
  price_per_person_kobo: z.coerce.number().int().positive(),
  headcount_target: z.coerce.number().int().positive(),
  event_date: z.string().min(1, "Choose a date"),
  location_text: z.string().trim().min(2, "Enter a location"),
  deposit_kobo: z.coerce.number().int().min(0).default(0),
  organiser_incentive_note: z.string().trim().optional(),
  agent_code: z.string().trim().optional(),
});

export async function createScreeningEventAction(
  _prev: ScreeningEventActionState,
  formData: FormData
): Promise<ScreeningEventActionState> {
  const staff = await requireOrgStaff();
  const parsed = createEventSchema.safeParse({
    organiser_phone: formData.get("organiser_phone"),
    organiser_name: formData.get("organiser_name"),
    organiser_type: formData.get("organiser_type"),
    panel_bundle_id: formData.get("panel_bundle_id"),
    price_per_person_kobo: formData.get("price_per_person_kobo"),
    headcount_target: formData.get("headcount_target"),
    event_date: formData.get("event_date"),
    location_text: formData.get("location_text"),
    deposit_kobo: formData.get("deposit_kobo") || 0,
    organiser_incentive_note: formData.get("organiser_incentive_note") || undefined,
    agent_code: formData.get("agent_code") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  if (!staff.organisation_id) return { error: "Your account has no organisation on file" };

  const organiser = await findOrCreateProfileByPhone({
    phone: parsed.data.organiser_phone,
    fullName: parsed.data.organiser_name,
    organisationId: staff.organisation_id,
  });
  if ("error" in organiser) return { error: organiser.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_screening_event", {
    p_organiser_profile_id: organiser.id,
    p_organiser_name: parsed.data.organiser_name,
    p_organiser_phone: parsed.data.organiser_phone,
    p_organiser_type: parsed.data.organiser_type,
    p_panel_bundle_id: parsed.data.panel_bundle_id,
    p_price_per_person_kobo: parsed.data.price_per_person_kobo,
    p_headcount_target: parsed.data.headcount_target,
    p_event_date: parsed.data.event_date,
    p_location_text: parsed.data.location_text,
    p_deposit_kobo: parsed.data.deposit_kobo,
    p_organiser_incentive_note: parsed.data.organiser_incentive_note ?? null,
    p_agent_code: parsed.data.agent_code ?? null,
  });
  if (error) return { error: error.message };
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { error: result.error ?? "Could not create the event" };

  revalidatePath("/admin/screening-events");
  return { message: "Event created — record the deposit once it lands." };
}

async function recordPayment(eventId: string, amountKobo: number, rpc: "admin_record_screening_event_deposit" | "admin_record_screening_event_balance") {
  await requireOrgStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(rpc, { p_event_id: eventId, p_amount_kobo: amountKobo });
  if (error) return { error: error.message };
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin/screening-events");
  return { message: "Recorded." };
}

export async function recordDepositAction(
  _prev: ScreeningEventActionState,
  formData: FormData
): Promise<ScreeningEventActionState> {
  const eventId = formData.get("event_id");
  const amount = Number(formData.get("amount_kobo"));
  if (typeof eventId !== "string" || !eventId || !Number.isFinite(amount) || amount <= 0) {
    return { error: "Invalid amount" };
  }
  return recordPayment(eventId, amount, "admin_record_screening_event_deposit");
}

export async function recordBalanceAction(
  _prev: ScreeningEventActionState,
  formData: FormData
): Promise<ScreeningEventActionState> {
  const eventId = formData.get("event_id");
  const amount = Number(formData.get("amount_kobo"));
  if (typeof eventId !== "string" || !eventId || !Number.isFinite(amount) || amount <= 0) {
    return { error: "Invalid amount" };
  }
  return recordPayment(eventId, amount, "admin_record_screening_event_balance");
}

const registerSchema = z.object({
  phone: phoneSchema,
  full_name: z.string().trim().min(2, "Enter the participant's full name"),
  consent: z.literal("on", { message: "Consent is required to register a participant" }),
});

/** On-site registration: one real, consenting, now-identified participant
 * per submit — the operator screen §8 calls for. */
export async function registerParticipantAction(
  eventId: string,
  _prev: ScreeningEventActionState,
  formData: FormData
): Promise<ScreeningEventActionState> {
  const staff = await requireOrgStaff();
  const parsed = registerSchema.safeParse({
    phone: formData.get("phone"),
    full_name: formData.get("full_name"),
    consent: formData.get("consent"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  if (!staff.organisation_id) return { error: "Your account has no organisation on file" };

  const participant = await findOrCreateProfileByPhone({
    phone: parsed.data.phone,
    fullName: parsed.data.full_name,
    organisationId: staff.organisation_id,
  });
  if ("error" in participant) return { error: participant.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_screening_event_participant", {
    p_event_id: eventId,
    p_participant_id: participant.id,
    p_consent: true,
  });
  if (error) return { error: error.message };
  const result = data as { ok: boolean; error?: string; voucher_number?: string };
  if (!result.ok) return { error: result.error ?? "Could not register this participant" };

  revalidatePath(`/admin/screening-events/${eventId}/register`);
  return { message: `Registered — voucher ${result.voucher_number}.` };
}
