import { z } from "zod";
import { toCsv, type CsvRow } from "@/lib/analytics/to-csv";

/**
 * The staff consultations log (founder/CMO ask, 2026-11-03): every call in the organisation, read through
 * public.consultations_log, which returns rows to an admin or the Chief Medical Officer only. Shared by /admin/consultations,
 * /clinician/consultations-log and the CSV download so the filters, the row shape and the file are the same everywhere.
 */

export const CONSULTATION_STATUSES = [
  "scheduled",
  "waiting",
  "in_progress",
  "completed",
  "no_show_patient",
  "no_show_clinician",
  "cancelled",
  "failed",
] as const;

export const CONSULTATION_STATUS_LABEL: Record<(typeof CONSULTATION_STATUSES)[number], string> = {
  scheduled: "Booked",
  waiting: "Someone is waiting",
  in_progress: "In progress",
  completed: "Completed",
  no_show_patient: "Patient did not come",
  no_show_clinician: "Doctor did not come",
  cancelled: "Cancelled",
  failed: "Failed",
};

export function statusLabel(status: string): string {
  return (CONSULTATION_STATUS_LABEL as Record<string, string>)[status] ?? status;
}

const MEDIA_LABEL: Record<string, string> = { video: "Video", audio_only: "Audio only", phone: "Phone" };
export function mediaLabel(mode: string | null): string {
  return mode ? (MEDIA_LABEL[mode] ?? mode) : "";
}

const plainDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()));

const filterInput = z.object({
  from: plainDate.optional(),
  to: plainDate.optional(),
  doctor: z.string().uuid().optional(),
  status: z.enum(CONSULTATION_STATUSES).optional(),
  tests: z.literal("1").optional(),
});

export interface ConsultationsLogFilters {
  from?: string;
  to?: string;
  doctor?: string;
  status?: (typeof CONSULTATION_STATUSES)[number];
  includeTests: boolean;
}

type RawParams = Record<string, string | string[] | undefined>;

/**
 * Reads the filters from a query string or form. A value that does not parse is dropped rather than failing the page, so a
 * hand-edited link still shows the log, only less filtered.
 */
export function parseConsultationsLogFilters(params: RawParams): ConsultationsLogFilters {
  const pick = (k: keyof z.infer<typeof filterInput>) => {
    const v = params[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s !== "string" || s === "") return undefined;
    const one = filterInput.shape[k].safeParse(s);
    return one.success ? (one.data as string) : undefined;
  };
  return {
    from: pick("from"),
    to: pick("to"),
    doctor: pick("doctor"),
    status: pick("status") as ConsultationsLogFilters["status"],
    includeTests: pick("tests") === "1",
  };
}

/** The same filters as a query string, for the CSV link and the "include tests" toggle. */
export function filtersToQuery(f: ConsultationsLogFilters): string {
  const q = new URLSearchParams();
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (f.doctor) q.set("doctor", f.doctor);
  if (f.status) q.set("status", f.status);
  if (f.includeTests) q.set("tests", "1");
  return q.toString();
}

export function filtersToRpcArgs(f: ConsultationsLogFilters) {
  return {
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_clinician_id: f.doctor ?? null,
    p_status: f.status ?? null,
    p_include_tests: f.includeTests,
  };
}

const num = z.union([z.number(), z.string().transform(Number)]).nullable();

export const consultationsLogRow = z.object({
  encounter_id: z.string().uuid(),
  call_date: z.string(),
  scheduled_at: z.string().nullable(),
  patient_id: z.string().uuid(),
  patient_name: z.string().nullable(),
  clinician_id: z.string().uuid().nullable(),
  clinician_name: z.string().nullable(),
  status: z.string(),
  media_mode: z.string().nullable(),
  doctor_started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  doctor_minutes: num,
  connected_minutes: num,
  zoom_legs: z.number().int(),
  zoom_open_legs: z.number().int(),
  patient_joins: z.number().int(),
  clinician_joins: z.number().int(),
  is_test: z.boolean(),
});
export type ConsultationsLogRow = z.infer<typeof consultationsLogRow>;

/** Null when the response is not the expected shape, so the page can say so instead of showing an empty log. */
export function parseConsultationsLog(data: unknown): ConsultationsLogRow[] | null {
  const parsed = z.array(consultationsLogRow).safeParse(data ?? []);
  return parsed.success ? parsed.data : null;
}

export interface ConsultationsLogTotals {
  calls: number;
  doctorMinutes: number;
  connectedMinutes: number;
}

export function totalsOf(rows: readonly ConsultationsLogRow[]): ConsultationsLogTotals {
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    calls: rows.length,
    doctorMinutes: round1(rows.reduce((s, r) => s + (r.doctor_minutes ?? 0), 0)),
    connectedMinutes: round1(rows.reduce((s, r) => s + (r.connected_minutes ?? 0), 0)),
  };
}

/** A time in Lagos as HH:MM, or empty. */
export function lagosTime(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** A cell a spreadsheet would read as a formula gets a leading apostrophe (names are typed by patients). */
function safeCell(v: string | null): string | null {
  return v !== null && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export const CSV_COLUMNS = [
  "date",
  "scheduled_time_lagos",
  "patient_name",
  "patient_id",
  "doctor_name",
  "doctor_id",
  "status",
  "media_mode",
  "doctor_joined_lagos",
  "finished_lagos",
  "doctor_minutes",
  "connected_minutes",
  "zoom_legs",
  "zoom_open_legs",
  "patient_joins",
  "doctor_joins",
  "is_test",
  "encounter_id",
] as const;

export function consultationsLogCsv(rows: readonly ConsultationsLogRow[]): string {
  const out: CsvRow[] = rows.map((r) => ({
    date: r.call_date,
    scheduled_time_lagos: lagosTime(r.scheduled_at),
    patient_name: safeCell(r.patient_name),
    patient_id: r.patient_id,
    doctor_name: safeCell(r.clinician_name),
    doctor_id: r.clinician_id,
    status: r.status,
    media_mode: r.media_mode,
    doctor_joined_lagos: lagosTime(r.doctor_started_at),
    finished_lagos: lagosTime(r.finished_at),
    doctor_minutes: r.doctor_minutes,
    connected_minutes: r.connected_minutes,
    zoom_legs: r.zoom_legs,
    zoom_open_legs: r.zoom_open_legs,
    patient_joins: r.patient_joins,
    doctor_joins: r.clinician_joins,
    is_test: r.is_test,
    encounter_id: r.encounter_id,
  }));
  return toCsv(out, [...CSV_COLUMNS]);
}
