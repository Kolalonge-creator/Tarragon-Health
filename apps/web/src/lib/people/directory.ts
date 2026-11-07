import { z } from "zod";

/**
 * Read side of /admin/people (HR Phase A, docs/design/HR-WORKFORCE.md). Every read is an admin-only database function or an
 * RLS-scoped table; a refusal is shown as an error, never as an empty page. Clinician credential fields are a read-only copy
 * of clinical_staff (credentialing stays authoritative); nothing here writes them.
 */
export type Loaded<T> = { ok: true; value: T } | { ok: false; message: string };

interface Client {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(cols: string): {
      eq(col: string, value: string): {
        order(col: string, o: { ascending: boolean }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
      order(col: string, o: { ascending: boolean }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
}

export const ENGAGEMENTS = ["employed", "contracted"] as const;
export const WORK_PATTERNS = ["full_time", "part_time", "sessional"] as const;
export const EMPLOYMENT_STATUSES = ["onboarding", "active", "suspended", "left"] as const;
export const CHANGE_KINDS = [
  "appointment",
  "promotion",
  "transfer",
  "manager_change",
  "hours_change",
  "contract_renewal",
  "contract_amendment",
  "suspension",
  "return_to_work",
  "termination",
  "resignation",
  "retirement",
  "correction",
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export const LEAVING_KINDS: readonly ChangeKind[] = ["termination", "resignation", "retirement"];
/** Kinds whose database rule demands a note of at least 10 characters. */
export const NOTE_REQUIRED_KINDS: readonly ChangeKind[] = ["suspension", "termination", "resignation", "retirement"];

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  appointment: "Appointment",
  promotion: "Promotion",
  transfer: "Department transfer",
  manager_change: "Change of line manager",
  hours_change: "Change of hours",
  contract_renewal: "Contract renewal",
  contract_amendment: "Contract amendment",
  suspension: "Suspension",
  return_to_work: "Return to work",
  termination: "Termination",
  resignation: "Resignation",
  retirement: "Retirement",
  correction: "Correction",
};

export const STATUS_LABEL: Record<(typeof EMPLOYMENT_STATUSES)[number], string> = {
  onboarding: "Onboarding",
  active: "Active",
  suspended: "Suspended",
  left: "Left",
};

export const PATTERN_LABEL: Record<(typeof WORK_PATTERNS)[number], string> = {
  full_time: "Full time",
  part_time: "Part time",
  sessional: "Sessional",
};

export const ROLE_LABEL: Record<string, string> = {
  clinician: "Clinician",
  admin: "Admin",
  care_coordinator: "Care coordinator",
  analyst: "Analyst",
  finance: "Finance",
  lab_liaison: "Lab liaison",
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const directoryRowSchema = z.object({
  profile_id: z.string().uuid(),
  full_name: z.string().nullable(),
  staff_number: z.string().nullable(),
  role: z.string(),
  account_active: z.boolean(),
  is_test: z.boolean(),
  is_clinician: z.boolean(),
  doctor_tier: z.string().nullable(),
  clinician_status: z.string().nullable(),
  clinician_employment_type: z.string().nullable(),
  licence_expires_at: z.string().nullable(),
  /** Credentialing's own verdicts (psv_satisfied, clinician_is_eligible, indemnity_required); null for a non-clinician. */
  verification_satisfied: z.boolean().nullable(),
  cleared_to_practise: z.boolean().nullable(),
  indemnity_required: z.boolean().nullable(),
  indemnity_expires_at: z.string().nullable(),
  indemnity_exempt: z.boolean(),
  has_employment_record: z.boolean(),
  job_title: z.string().nullable(),
  department_id: z.string().uuid().nullable(),
  department_name: z.string().nullable(),
  line_manager_id: z.string().uuid().nullable(),
  line_manager_name: z.string().nullable(),
  engagement: z.enum(ENGAGEMENTS).nullable(),
  work_pattern: z.enum(WORK_PATTERNS).nullable(),
  employment_status: z.enum(EMPLOYMENT_STATUSES).nullable(),
  start_date: isoDate.nullable(),
  contract_end_date: isoDate.nullable(),
  contracted_hours_per_week: z.coerce.number().nullable(),
  work_location: z.string().nullable(),
  has_emergency_contact: z.boolean(),
});
export type DirectoryRow = z.infer<typeof directoryRowSchema>;

/** The fields the employment form pre-fills from: the person's record in force, as the database defines it. */
export type CurrentPosition = Pick<
  DirectoryRow,
  | "job_title"
  | "department_id"
  | "line_manager_id"
  | "engagement"
  | "work_pattern"
  | "employment_status"
  | "start_date"
  | "contract_end_date"
  | "contracted_hours_per_week"
  | "work_location"
>;

export const employmentRecordSchema = z.object({
  id: z.string().uuid(),
  change_kind: z.enum(CHANGE_KINDS),
  effective_from: isoDate,
  job_title: z.string(),
  department_id: z.string().uuid().nullable(),
  line_manager_id: z.string().uuid().nullable(),
  engagement: z.enum(ENGAGEMENTS).nullable(),
  work_pattern: z.enum(WORK_PATTERNS),
  employment_status: z.enum(EMPLOYMENT_STATUSES),
  start_date: isoDate,
  contract_end_date: isoDate.nullable(),
  contracted_hours_per_week: z.coerce.number().nullable(),
  work_location: z.string().nullable(),
  note: z.string().nullable(),
  recorded_at: z.string(),
});
export type EmploymentRecord = z.infer<typeof employmentRecordSchema>;

export const departmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  head_profile_id: z.string().uuid().nullable(),
  is_active: z.boolean(),
});
export type Department = z.infer<typeof departmentSchema>;

export const activitySchema = z.object({
  at: z.string(),
  action: z.string(),
  actor_name: z.string(),
  subject_profile_id: z.string().uuid().nullable(),
  subject_name: z.string().nullable(),
});
export type Activity = z.infer<typeof activitySchema>;

export const personalDetailsSchema = z
  .object({
    emergency_contact_name: z.string().nullable(),
    emergency_contact_relationship: z.string().nullable(),
    emergency_contact_phone: z.string().nullable(),
    home_address: z.string().nullable(),
    national_id_number: z.string().nullable(),
    updated_at: z.string(),
  })
  .nullable();
export type PersonalDetails = z.infer<typeof personalDetailsSchema>;

function parsed<T>(schema: z.ZodType<T>, data: unknown, what: string): Loaded<T> {
  const r = schema.safeParse(data);
  return r.success ? { ok: true, value: r.data } : { ok: false, message: `The ${what} came back in an unexpected shape.` };
}

export async function loadDirectory(client: unknown): Promise<Loaded<DirectoryRow[]>> {
  const { data, error } = await (client as Client).rpc("people_directory");
  if (error) return { ok: false, message: "The staff directory could not be loaded." };
  return parsed(z.array(directoryRowSchema), data, "staff directory");
}

export async function loadRecentActivity(client: unknown, limit = 15): Promise<Loaded<Activity[]>> {
  const { data, error } = await (client as Client).rpc("people_recent_activity", { p_limit: limit });
  if (error) return { ok: false, message: "Recent HR activity could not be loaded." };
  return parsed(z.array(activitySchema), data, "recent activity");
}

export async function loadEmploymentHistory(client: unknown, profileId: string): Promise<Loaded<EmploymentRecord[]>> {
  const { data, error } = await (client as Client)
    .from("staff_employment_records")
    .select(
      "id, change_kind, effective_from, job_title, department_id, line_manager_id, engagement, work_pattern, employment_status, start_date, contract_end_date, contracted_hours_per_week, work_location, note, recorded_at"
    )
    .eq("profile_id", profileId)
    .order("effective_from", { ascending: false });
  if (error) return { ok: false, message: "The employment history could not be loaded." };
  return parsed(z.array(employmentRecordSchema), data, "employment history");
}

export async function loadDepartments(client: unknown): Promise<Loaded<Department[]>> {
  const { data, error } = await (client as Client)
    .from("staff_departments")
    .select("id, name, description, head_profile_id, is_active")
    .order("name", { ascending: true });
  if (error) return { ok: false, message: "The departments could not be loaded." };
  return parsed(z.array(departmentSchema), data, "departments");
}

/** Reading someone else's personal details writes an access audit row in the database. */
export async function loadPersonalDetails(client: unknown, profileId: string): Promise<Loaded<PersonalDetails>> {
  const { data, error } = await (client as Client).rpc("staff_personal_details", { p_profile: profileId });
  if (error) return { ok: false, message: "The personal details could not be loaded." };
  return parsed(personalDetailsSchema, data, "personal details");
}

/** Only the last four digits of an ID number are shown until an admin asks for the whole number. */
export function maskNationalId(nin: string | null): string {
  if (!nin) return "Not recorded";
  return `•••••••${nin.slice(-4)}`;
}
