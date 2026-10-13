import { z } from "zod";

/**
 * Shared pieces for testing days, employer visits and point-of-care results (migration
 * 20261013004659_testing_days_employer_visits_point_of_care.sql). No server-only imports, so the actions, the screens, the
 * mobile app's copy of the same rules and the tests read one definition.
 */

export const ECG_BUCKET = "poc-ecg";
export const ECG_FILE_ACCEPT = "application/pdf,image/png,image/jpeg,application/xml,text/xml";
export const ECG_MAX_BYTES = 20 * 1024 * 1024;
const ECG_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "application/xml", "text/xml"]);
export const ECG_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/xml": "xml",
  "text/xml": "xml",
};

export function validateEcgFile(file: { type: string; size: number }): string | null {
  if (!ECG_MIME.has(file.type)) return "Please choose a PDF, PNG, JPG or XML trace.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > ECG_MAX_BYTES) return "That file is larger than 20 MB.";
  return null;
}

// --- What the database functions return ------------------------------------------------------------------------------------

export const testingDaySchema = z.object({
  id: z.string().uuid(),
  event_date: z.string(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  venue_name: z.string(),
  address: z.string(),
  city: z.string(),
  lga: z.string().nullable(),
  state: z.string().nullable(),
  seats_left: z.number().int().min(0),
  full: z.boolean(),
  my_booking_id: z.string().uuid().nullable(),
  my_state: z.string().nullable(),
});
export type TestingDay = z.infer<typeof testingDaySchema>;
export const testingDayListSchema = z.array(testingDaySchema);

export const BOOKING_STATES = ["confirmed", "waitlisted", "cancelled", "checked_in", "no_show"] as const;
export const myBookingSchema = z.object({
  booking_id: z.string().uuid(),
  state: z.enum(BOOKING_STATES),
  kind: z.enum(["public_day", "employer_visit"]),
  event_id: z.string().uuid(),
  event_date: z.string(),
  starts_at: z.string().nullable(),
  venue_name: z.string(),
  address: z.string(),
  city: z.string(),
  event_status: z.string(),
  waitlist_position: z.number().int().nullable(),
});
export type MyBooking = z.infer<typeof myBookingSchema>;
export const myBookingListSchema = z.array(myBookingSchema);

const flagSchema = z.enum(["normal", "abnormal", "low", "high", "critical"]);
export const pocItemSchema = z.object({
  analyte_code: z.string(),
  value_numeric: z.number().nullable(),
  value_text: z.string().nullable(),
  unit: z.string(),
  flag: flagSchema,
});
export const myPocResultsSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().uuid(),
      kind: z.enum(["urinalysis", "hba1c"]),
      released_at: z.string().nullable(),
      items: z.array(pocItemSchema).nullable(),
    }),
  ),
  ecgs: z.array(
    z.object({
      id: z.string().uuid(),
      interpreted_at: z.string().nullable(),
      interpretation_class: z.enum(["normal", "abnormal", "urgent"]).nullable(),
      interpretation: z.string().nullable(),
    }),
  ),
});
export type MyPocResults = z.infer<typeof myPocResultsSchema>;

export const employerVisitSummarySchema = z.array(
  z.object({
    id: z.string().uuid(),
    status: z.string(),
    event_date: z.string(),
    city: z.string(),
    address: z.string(),
    headcount_requested: z.number().nullable(),
    registered: z.number().nullable(),
    checked_in: z.number().nullable(),
    suppressed: z.boolean(),
  }),
);
export type EmployerVisitSummary = z.infer<typeof employerVisitSummarySchema>[number];

export const staffEventSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["public_day", "employer_visit"]),
  status: z.enum(["requested", "scheduled", "open", "closed", "completed", "cancelled"]),
  event_date: z.string(),
  venue_name: z.string(),
  address: z.string(),
  city: z.string(),
  lga: z.string().nullable(),
  state: z.string().nullable(),
  capacity: z.number().int(),
  lab_provider_id: z.string().uuid().nullable(),
  employer_org_id: z.string().uuid().nullable(),
  headcount_requested: z.number().nullable(),
  venue_approved: z.boolean(),
  seats_taken: z.number().int(),
  waitlisted: z.number().int(),
});
export type StaffEvent = z.infer<typeof staffEventSchema>;
export const staffEventListSchema = z.array(staffEventSchema);

export const rosterRowSchema = z.object({
  booking_id: z.string().uuid(),
  state: z.enum(BOOKING_STATES),
  patient_id: z.string().uuid(),
  full_name: z.string().nullable(),
  specimen_number: z.string().nullable(),
  blood_drawn: z.boolean(),
  measurements: z.boolean(),
  urinalysis: z.boolean(),
  hba1c: z.boolean(),
  ecg: z.boolean(),
});
export type RosterRow = z.infer<typeof rosterRowSchema>;
export const rosterSchema = z.array(rosterRowSchema);

export const pocQueueSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().uuid(),
      patient_id: z.string().uuid(),
      full_name: z.string().nullable(),
      kind: z.enum(["urinalysis", "hba1c"]),
      entered_at: z.string(),
      items: z.array(pocItemSchema).nullable(),
    }),
  ),
  ecgs: z.array(
    z.object({
      id: z.string().uuid(),
      patient_id: z.string().uuid(),
      full_name: z.string().nullable(),
      recorded_at: z.string(),
      device_label: z.string().nullable(),
      machine_statement: z.string().nullable(),
      mime_type: z.string(),
    }),
  ),
});
export type PocQueue = z.infer<typeof pocQueueSchema>;

// --- Labels (plain words, no clinical terms in anything a notice or a list row could carry) -------------------------------

export const BOOKING_STATE_LABEL: Record<(typeof BOOKING_STATES)[number], string> = {
  confirmed: "Your place is held",
  waitlisted: "On the waiting list",
  cancelled: "Cancelled",
  checked_in: "Checked in",
  no_show: "Missed",
};

export function seatsLabel(day: Pick<TestingDay, "seats_left" | "full">): string {
  if (day.full) return "Full: join the waiting list";
  return day.seats_left === 1 ? "1 place left" : `${day.seats_left} places left`;
}

const DB_ERROR_TEXT: Record<string, string> = {
  membership_required: "Testing days are part of Membership.",
  testing_day_not_available: "That day is no longer available.",
  already_booked_use_reschedule: "You already hold a place. Use Change day to move it.",
  new_day_full_keep_current: "That day is full, so we kept your current place.",
  booking_not_found: "We could not find that booking.",
  booking_not_cancellable: "That booking can no longer be changed.",
  same_day: "That is the day you already hold.",
  visit_needs_a_week_notice: "Please choose a date at least a week from today.",
  "not authorised": "You do not have access to do that.",
};

/** The database raises short codes; this turns one into a sentence, and never passes an unknown message through raw. */
export function testingDayErrorText(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  return DB_ERROR_TEXT[m] ?? "Something went wrong. Please try again.";
}

// --- Station B entry --------------------------------------------------------------------------------------------------------

/** The 10-parameter dipstick scale. Mirrors poc_panel_versions poc_urinalysis v1 (a test pins the two together). */
export const URINALYSIS_FIELDS = [
  { code: "glucose", label: "Glucose", kind: "ordinal", options: ["negative", "trace", "1+", "2+", "3+", "4+"] },
  { code: "bilirubin", label: "Bilirubin", kind: "ordinal", options: ["negative", "1+", "2+", "3+"] },
  { code: "ketones", label: "Ketones", kind: "ordinal", options: ["negative", "trace", "1+", "2+", "3+"] },
  { code: "specific_gravity", label: "Specific gravity", kind: "numeric", options: [] },
  { code: "blood", label: "Blood", kind: "ordinal", options: ["negative", "trace", "1+", "2+", "3+"] },
  { code: "ph", label: "pH", kind: "numeric", options: [] },
  { code: "protein", label: "Protein", kind: "ordinal", options: ["negative", "trace", "1+", "2+", "3+", "4+"] },
  { code: "urobilinogen", label: "Urobilinogen", kind: "ordinal", options: ["normal", "1+", "2+", "3+", "4+"] },
  { code: "nitrite", label: "Nitrite", kind: "ordinal", options: ["negative", "positive"] },
  { code: "leukocytes", label: "Leukocytes", kind: "ordinal", options: ["negative", "trace", "1+", "2+", "3+"] },
] as const;

export type PocUrinalysisItem = { analyte_code: string; value_numeric?: number; value_text?: string };

/** Form fields named u_<code> become the item list the database classifies. A blank field is simply not sent; no flag is ever sent. */
export function urinalysisItemsFromForm(form: Pick<FormData, "get">): PocUrinalysisItem[] {
  const items: PocUrinalysisItem[] = [];
  for (const f of URINALYSIS_FIELDS) {
    const raw = String(form.get(`u_${f.code}`) ?? "").trim();
    if (raw === "") continue;
    if (f.kind === "numeric") {
      const n = Number(raw);
      if (Number.isFinite(n)) items.push({ analyte_code: f.code, value_numeric: n });
    } else {
      items.push({ analyte_code: f.code, value_text: raw });
    }
  }
  return items;
}

const optionalNumber = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number().finite().min(min).max(max).optional());

export const measurementsFormSchema = z.object({
  bookingId: z.string().uuid(),
  heightCm: optionalNumber(50, 250),
  weightKg: optionalNumber(2, 400),
  pulseBpm: optionalNumber(20, 300),
  spo2Pct: optionalNumber(50, 100),
  glucoseMmolL: optionalNumber(0.5, 60),
  glucoseContext: z.enum(["fasting", "random", "post_meal", "pre_meal", "bedtime", "night"]).default("random"),
  bp1: z.string().optional(),
  bp2: z.string().optional(),
  bp3: z.string().optional(),
  bpDevice: z.string().max(80).optional(),
  glucoseDevice: z.string().max(80).optional(),
});

/** "120/80" -> {systolic, diastolic}; anything else is a plain error so the reading is never guessed. */
export function parseBpReading(text: string | undefined): { systolic: number; diastolic: number } | null | "invalid" {
  const t = (text ?? "").trim();
  if (t === "") return null;
  const m = /^(\d{2,3})\s*\/\s*(\d{2,3})$/.exec(t);
  if (!m) return "invalid";
  const systolic = Number(m[1]);
  const diastolic = Number(m[2]);
  if (systolic < 50 || systolic > 300 || diastolic < 20 || diastolic > 200 || diastolic >= systolic) return "invalid";
  return { systolic, diastolic };
}

export const ecgInterpretSchema = z.object({
  recordingId: z.string().uuid(),
  interpretationClass: z.enum(["normal", "abnormal", "urgent"]),
  interpretation: z.string().trim().min(3, "Please write the interpretation.").max(2000),
});

export const createEventSchema = z.object({
  kind: z.enum(["public_day", "employer_visit"]),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startsAt: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  endsAt: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  venueName: z.string().trim().min(2).max(120),
  address: z.string().trim().min(3).max(240),
  city: z.string().trim().min(2).max(80),
  lga: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  capacity: z.coerce.number().int().min(1).max(500),
  labProviderId: z.string().uuid().optional().or(z.literal("")),
  employerOrgId: z.string().uuid().optional().or(z.literal("")),
  headcount: z.coerce.number().int().min(1).max(5000).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const employerVisitRequestSchema = z.object({
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  address: z.string().trim().min(3).max(240),
  city: z.string().trim().min(2).max(80),
  lga: z.string().trim().max(80).optional(),
  headcount: z.coerce.number().int().min(1).max(500),
  notes: z.string().trim().max(500).optional(),
});
