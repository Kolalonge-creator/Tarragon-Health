"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  createEventSchema,
  ECG_BUCKET,
  ECG_EXT,
  ecgInterpretSchema,
  employerVisitRequestSchema,
  measurementsFormSchema,
  parseBpReading,
  testingDayErrorText,
  urinalysisItemsFromForm,
  validateEcgFile,
} from "./model";

export type TestingActionState = { error?: string; message?: string } | undefined;

const uuid = z.string().uuid();
const STAFF_PATH = "/admin/settings/testing-days";

function oops(message: string | undefined): { error: string } {
  return { error: testingDayErrorText(message) };
}

// --- Scheduling (testing_days.manage) ----------------------------------------------------------------------------------------

export async function createTestingEvent(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const parsed = createEventSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_testing_event", {
    p_kind: d.kind,
    p_event_date: d.eventDate,
    p_starts_at: d.startsAt || null,
    p_ends_at: d.endsAt || null,
    p_venue_name: d.venueName,
    p_address: d.address,
    p_city: d.city,
    p_lga: d.lga || null,
    p_state: d.state || null,
    p_capacity: d.capacity,
    p_lab_provider: d.labProviderId || null,
    p_notes: d.notes || undefined,
    p_employer_org: d.employerOrgId || undefined,
    p_headcount: d.headcount,
  });
  if (error) return oops(error.message);
  revalidatePath(STAFF_PATH);
  return { message: "Testing event created." };
}

export async function approveVenue(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const id = uuid.safeParse(formData.get("eventId"));
  if (!id.success) return { error: "That event could not be found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_testing_event_venue", { p_event: id.data });
  if (error) return oops(error.message);
  revalidatePath(STAFF_PATH);
  return { message: "Venue approved." };
}

const updateSchema = z.object({
  eventId: uuid,
  labProviderId: uuid.optional().or(z.literal("")),
  capacity: z.coerce.number().int().min(1).max(500),
  startsAt: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  endsAt: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  venueName: z.string().trim().max(120).optional(),
});
export async function updateTestingEvent(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const parsed = updateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_testing_event", {
    p_event: d.eventId,
    p_lab_provider: d.labProviderId || null,
    p_capacity: d.capacity,
    p_starts_at: d.startsAt || null,
    p_ends_at: d.endsAt || null,
    p_venue_name: d.venueName ?? "",
  });
  if (error) {
    return { error: error.message === "capacity_below_seats_taken" ? "Capacity cannot be lower than the places already taken." : testingDayErrorText(error.message) };
  }
  revalidatePath(STAFF_PATH);
  return { message: "Saved." };
}

const statusSchema = z.object({ eventId: uuid, status: z.enum(["scheduled", "open", "closed", "completed", "cancelled"]) });
export async function setEventStatus(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const parsed = statusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Please choose a status." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_testing_event_status", { p_event: parsed.data.eventId, p_status: parsed.data.status });
  if (error) {
    const known: Record<string, string> = {
      testing_event_needs_lab_and_venue_approval: "Approve the venue and choose a laboratory before opening.",
      testing_event_lab_not_active: "That laboratory is not active yet.",
      testing_event_bad_transition: "That change is not allowed from the current status.",
    };
    return { error: known[error.message] ?? testingDayErrorText(error.message) };
  }
  revalidatePath(STAFF_PATH);
  return { message: "Status updated." };
}

const teamSchema = z.object({
  eventId: uuid,
  lead: uuid.optional().or(z.literal("")),
  stationA: uuid.optional().or(z.literal("")),
  stationB: uuid.optional().or(z.literal("")),
  stationC: uuid.optional().or(z.literal("")),
});
export async function saveTeam(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const parsed = teamSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Please check the team." };
  const t = parsed.data;
  const team = [
    ["lead", t.lead],
    ["A", t.stationA],
    ["B", t.stationB],
    ["C", t.stationC],
  ]
    .filter(([, id]) => id)
    .map(([station, id]) => ({ profile_id: id, station }));
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_testing_event_team", { p_event: t.eventId, p_team: team as unknown as Json });
  if (error) return oops(error.message);
  revalidatePath(STAFF_PATH);
  return { message: "Team saved." };
}

const attendeesSchema = z.object({ eventId: uuid, rosterIds: z.string().min(1) });
/** Staff add roster employees (one id per line) to an employer visit. Reports counts by reason, never names. */
export async function addVisitAttendees(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const parsed = attendeesSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Please paste at least one roster id." };
  const ids = parsed.data.rosterIds.split(/[\s,]+/).filter(Boolean);
  if (!ids.every((i) => uuid.safeParse(i).success)) return { error: "One of those ids is not valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_employer_visit_attendees", { p_event: parsed.data.eventId, p_roster_ids: ids });
  if (error) return oops(error.message);
  const r = (data ?? {}) as Record<string, number>;
  revalidatePath(STAFF_PATH);
  return {
    message: `Added ${r.added ?? 0}. Skipped: ${r.no_account ?? 0} with no account yet, ${r.not_member ?? 0} not a Member, ${r.already_listed ?? 0} already listed, ${r.full ?? 0} over capacity.`,
  };
}

// --- Stations (testing_days.run) ---------------------------------------------------------------------------------------------

const bookingSchema = z.object({ bookingId: uuid, eventId: uuid });

const STATION_ERRORS: Record<string, string> = {
  not_the_day_of_the_event: "Check-in only works on the day of the event.",
  membership_required: "This person does not have an active Membership.",
  annual_check_already_started: "This person already has an annual check in progress.",
  booking_not_confirmed: "This booking is not confirmed.",
  booking_not_checked_in: "Check this person in at station A first.",
  poc_measurements_already_recorded: "Measurements were already recorded for this person.",
  poc_result_already_recorded: "That result was already recorded for this person.",
  ecg_already_recorded: "An ECG was already recorded for this person.",
  bp_reading_out_of_range: "A blood pressure reading is out of range. Please re-enter it.",
  poc_value_not_recognised: "A reading is not on the strip scale. Please re-enter it.",
  poc_value_out_of_bounds: "A value is out of range. Please re-enter it.",
  poc_analyte_not_in_panel: "That test is not part of the point-of-care check.",
};
function stationError(message: string | undefined): { error: string } {
  return { error: STATION_ERRORS[message ?? ""] ?? testingDayErrorText(message) };
}

export async function checkInBooking(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const parsed = bookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "That booking could not be found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_in_testing_booking", { p_booking: parsed.data.bookingId });
  if (error) return stationError(error.message);
  revalidatePath(`/admin/testing-days/${parsed.data.eventId}`);
  const num = (data as { specimen_number?: string } | null)?.specimen_number;
  return { message: num ? `Checked in. Label the tube ${num}.` : "Checked in." };
}

export async function recordBloodDraw(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const parsed = bookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "That booking could not be found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_testing_blood_draw", { p_booking: parsed.data.bookingId });
  if (error) return stationError(error.message);
  revalidatePath(`/admin/testing-days/${parsed.data.eventId}`);
  return { message: "Blood draw recorded." };
}

export async function recordMeasurements(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const eventId = uuid.safeParse(formData.get("eventId"));
  const parsed = measurementsFormSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success || !eventId.success) return { error: parsed.success ? "Missing event." : (parsed.error.issues[0]?.message ?? "Please check the readings.") };
  const m = parsed.data;
  const bp: { systolic: number; diastolic: number }[] = [];
  for (const raw of [m.bp1, m.bp2, m.bp3]) {
    const r = parseBpReading(raw);
    if (r === "invalid") return { error: "Blood pressure should look like 120/80." };
    if (r) bp.push(r);
  }
  const data = {
    height_cm: m.heightCm,
    weight_kg: m.weightKg,
    pulse_bpm: m.pulseBpm,
    spo2_pct: m.spo2Pct,
    glucose_mmol_l: m.glucoseMmolL,
    glucose_context: m.glucoseContext,
    bp_readings: bp,
    equipment: { bp: m.bpDevice || null, glucose: m.glucoseDevice || null },
  };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_poc_measurements", { p_booking: m.bookingId, p_data: data as unknown as Json });
  if (error) return stationError(error.message);
  revalidatePath(`/admin/testing-days/${eventId.data}`);
  return { message: "Measurements saved." };
}

export async function recordUrinalysis(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const parsed = bookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "That booking could not be found." };
  const items = urinalysisItemsFromForm(formData);
  if (items.length === 0) return { error: "Enter at least one strip reading." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_poc_urinalysis", { p_booking: parsed.data.bookingId, p_items: items as unknown as Json });
  if (error) return stationError(error.message);
  revalidatePath(`/admin/testing-days/${parsed.data.eventId}`);
  return { message: "Urine test saved. A doctor will review it before it is shown to the member." };
}

const hba1cSchema = z.object({ bookingId: uuid, eventId: uuid, value: z.coerce.number().min(2).max(20) });
export async function recordHba1c(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const parsed = hba1cSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Enter the HbA1c as a percentage, for example 5.4." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_poc_hba1c", { p_booking: parsed.data.bookingId, p_value: parsed.data.value });
  if (error) return stationError(error.message);
  revalidatePath(`/admin/testing-days/${parsed.data.eventId}`);
  return { message: "HbA1c saved. A doctor will review it before it is shown to the member." };
}

/**
 * Attach the ECG trace. The file goes to the private bucket first only after the caller has proved they may run a station
 * (the roster read refuses anyone else), and it is removed again if the database refuses the registration. The trace is never
 * read by software: it creates a task for a doctor.
 */
export async function recordEcg(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const parsed = bookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "That booking could not be found." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Please choose the ECG file." };
  const bad = validateEcgFile(file);
  if (bad) return { error: bad };

  const supabase = await createClient();
  const gate = await supabase.rpc("testing_event_roster", { p_event: parsed.data.eventId });
  if (gate.error) return oops(gate.error.message);

  const path = `${parsed.data.bookingId}/${randomUUID()}.${ECG_EXT[file.type] ?? "bin"}`;
  const store = createServiceRoleClient().storage.from(ECG_BUCKET);
  const { error: upError } = await store.upload(path, file, { contentType: file.type, upsert: false });
  if (upError) return { error: "The file could not be stored. Please try again." };

  const { error } = await supabase.rpc("record_poc_ecg", {
    p_booking: parsed.data.bookingId,
    p_file_path: path,
    p_mime_type: file.type,
    p_size: file.size,
    p_device_label: String(formData.get("device") ?? "") || undefined,
    p_machine_statement: String(formData.get("machineStatement") ?? "") || undefined,
  });
  if (error) {
    await store.remove([path]);
    return stationError(error.message);
  }
  revalidatePath(`/admin/testing-days/${parsed.data.eventId}`);
  return { message: "ECG saved. A doctor will read it." };
}

// --- Doctors ------------------------------------------------------------------------------------------------------------------

export async function interpretEcg(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const parsed = ecgInterpretSchema.safeParse({
    recordingId: formData.get("recordingId"),
    interpretationClass: formData.get("interpretationClass"),
    interpretation: formData.get("interpretation"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("interpret_poc_ecg", {
    p_recording: parsed.data.recordingId,
    p_class: parsed.data.interpretationClass,
    p_interpretation: parsed.data.interpretation,
  });
  if (error) return { error: error.message === "ecg_interpretation_required" ? "Please write the interpretation." : "You cannot read this ECG." };
  revalidatePath("/clinician/poc-results");
  return { message: "Interpretation saved and shared with the member." };
}

export async function releasePocResult(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const id = uuid.safeParse(formData.get("resultId"));
  if (!id.success) return { error: "That result could not be found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("release_poc_result", { p_result: id.data, p_note: String(formData.get("note") ?? "") || undefined });
  if (error) return { error: "You cannot release this result." };
  revalidatePath("/clinician/poc-results");
  return { message: "Released to the member." };
}

export async function withholdPocResult(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const id = uuid.safeParse(formData.get("resultId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id.success) return { error: "That result could not be found." };
  if (reason.length < 3) return { error: "Please give a reason." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withhold_poc_result", { p_result: id.data, p_reason: reason });
  if (error) return { error: "You cannot withhold this result." };
  revalidatePath("/clinician/poc-results");
  return { message: "Withheld." };
}

/** Signed link to an ECG trace for a tied clinician. The database function is the gate and writes the audit row. */
export async function getEcgTraceUrl(recordingId: string): Promise<{ url?: string; error?: string }> {
  if (!uuid.safeParse(recordingId).success) return { error: "Not found." };
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("poc_ecg_file_path", { p_recording: recordingId });
  if (error || !path) return { error: "Not found." };
  const signed = await createServiceRoleClient().storage.from(ECG_BUCKET).createSignedUrl(path, 60);
  return signed.data?.signedUrl ? { url: signed.data.signedUrl } : { error: "Not found." };
}

// --- Employer ------------------------------------------------------------------------------------------------------------------

export async function requestEmployerVisit(_prev: TestingActionState, formData: FormData): Promise<TestingActionState> {
  const parsed = employerVisitRequestSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_employer_visit", {
    p_event_date: d.eventDate,
    p_address: d.address,
    p_city: d.city,
    p_lga: d.lga || null,
    p_headcount: d.headcount,
    p_notes: d.notes || undefined,
  });
  if (error) return oops(error.message);
  revalidatePath("/dashboard/corporate/visits");
  return { message: "Request sent. Our team will confirm the date and the team with you." };
}
