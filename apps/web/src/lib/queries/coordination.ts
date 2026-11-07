import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { fetchTestPatientIds } from "@/lib/queries/real-patients";
import {
  activitySchema,
  rosterRowSchema,
  TAKE_OVER_TABLE,
  workItemSchema,
  type ActivityEvent,
  type RosterRow,
  type WorkItem,
  type WorkSource,
} from "@/lib/care-coordinator/work-items";

/**
 * CC-4: the coordination workspace's reads. The two views and the roster function are not in the generated database types (they
 * would be spliced in by hand), so they are read through a minimal structural type and every answer is parsed with Zod. Every hook
 * throws on an error, so a failed read is shown as a failure, never as an empty board.
 *
 * INV-13: a test account's work is never real work, so test patients are dropped here, as useOutreachTasks does.
 */
type Res = PromiseLike<{ data: unknown; error: { message: string } | null }>;
interface Q extends Res {
  order: (column: string, options: { ascending: boolean }) => Q;
  limit: (n: number) => Q;
  eq: (column: string, value: string) => Q;
}
interface Loose {
  from: (table: string) => { select: (columns: string) => Q };
  rpc: (fn: string, args?: Record<string, unknown>) => Res;
}
const loose = (c: unknown) => c as Loose;

export const coordinationKeys = {
  all: ["coordination"] as const,
  items: ["coordination", "items"] as const,
  activity: ["coordination", "activity"] as const,
  roster: (scope: "mine" | "all") => ["coordination", "roster", scope] as const,
  appointments: ["coordination", "appointments"] as const,
  patient: (id: string) => ["coordination", "patient", id] as const,
};

const REFRESH_MS = 60_000;

async function testPatients(): Promise<Set<string>> {
  return new Set(await fetchTestPatientIds(createClient()));
}

/** Up to 1000 open items, oldest first. More than that is not a worklist, it is an incident, and the page says so. */
export const WORK_ITEM_LIMIT = 1000;

export function useCoordinationWorkItems() {
  return useQuery({
    queryKey: coordinationKeys.items,
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<WorkItem[]> => {
      const [tests, res] = await Promise.all([
        testPatients(),
        loose(createClient()).from("coordination_work_items").select("*").order("created_at", { ascending: true }).limit(WORK_ITEM_LIMIT),
      ]);
      if (res.error) throw new Error(res.error.message);
      return z.array(workItemSchema).parse(res.data).filter((i) => !tests.has(i.patient_id));
    },
  });
}

export function useCoordinationActivity(limit = 20) {
  return useQuery({
    queryKey: [...coordinationKeys.activity, limit],
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<ActivityEvent[]> => {
      const [tests, res] = await Promise.all([
        testPatients(),
        loose(createClient()).from("coordination_recent_activity").select("*").order("occurred_at", { ascending: false }).limit(limit * 2),
      ]);
      if (res.error) throw new Error(res.error.message);
      return z.array(activitySchema).parse(res.data).filter((e) => !tests.has(e.patient_id)).slice(0, limit);
    },
  });
}

export function useCoordinationRoster(scope: "mine" | "all") {
  return useQuery({
    queryKey: coordinationKeys.roster(scope),
    queryFn: async (): Promise<RosterRow[]> => {
      const [tests, res] = await Promise.all([testPatients(), loose(createClient()).rpc("coordination_patient_roster", { p_scope: scope })]);
      if (res.error) throw new Error(res.error.message);
      return z.array(rosterRowSchema).parse(res.data).filter((r) => !tests.has(r.patient_id));
    },
  });
}

const apptSchema = z.object({
  id: z.string().min(1),
  patient_id: z.string().min(1),
  scheduled_for: z.string(),
  status: z.string(),
  appointment_type: z.string(),
  booked_via: z.string().nullable(),
  payment_status: z.string().nullable(),
  patient: z.object({ full_name: z.string().nullable() }).nullable(),
  clinician: z.object({ full_name: z.string().nullable() }).nullable(),
});
export type CoordinationAppointment = z.infer<typeof apptSchema>;

const UPCOMING = ["held", "booked", "confirmed", "scheduled", "checked_in", "in_progress"];
const NEEDS_ACTION = ["no_show", "provider_cancelled", "failed"];

/**
 * The next 7 days of appointments in the caller's organisation, and those from the last 7 days that need a follow-up call (missed,
 * cancelled by the clinician, or failed). The same appointments table the doctor and patient dashboards read.
 */
export function useCoordinationAppointments() {
  return useQuery({
    queryKey: coordinationKeys.appointments,
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<{ upcoming: CoordinationAppointment[]; needsFollowUp: CoordinationAppointment[] }> => {
      const supabase = createClient();
      const now = Date.now();
      const select =
        "id, patient_id, scheduled_for, status, appointment_type, booked_via, payment_status, patient:profiles!appointments_patient_id_fkey(full_name), clinician:profiles!appointments_clinician_id_fkey(full_name)";
      const [tests, upcoming, missed] = await Promise.all([
        testPatients(),
        supabase
          .from("appointments")
          .select(select)
          .in("status", UPCOMING as never)
          .gte("scheduled_for", new Date(now).toISOString())
          .lte("scheduled_for", new Date(now + 7 * 86_400_000).toISOString())
          .order("scheduled_for", { ascending: true })
          .limit(100),
        supabase
          .from("appointments")
          .select(select)
          .in("status", NEEDS_ACTION as never)
          .gte("scheduled_for", new Date(now - 7 * 86_400_000).toISOString())
          .lte("scheduled_for", new Date(now).toISOString())
          .order("scheduled_for", { ascending: false })
          .limit(50),
      ]);
      if (upcoming.error) throw upcoming.error;
      if (missed.error) throw missed.error;
      const keep = (rows: unknown) => z.array(apptSchema).parse(rows).filter((a) => !tests.has(a.patient_id));
      return { upcoming: keep(upcoming.data), needsFollowUp: keep(missed.data) };
    },
  });
}

const contactSchema = z.object({ id: z.string().min(1), channel: z.string(), note: z.string().nullable(), contacted_at: z.string() });
const careTeamSchema = z.object({
  clinician: z.object({ full_name: z.string().nullable() }).nullable(),
  coordinator: z.object({ full_name: z.string().nullable() }).nullable(),
});
const patientSchema = z.object({ full_name: z.string().nullable(), patient_number: z.string().nullable() });

export type PatientContext = {
  patient: z.infer<typeof patientSchema> | null;
  careTeam: z.infer<typeof careTeamSchema> | null;
  nextAppointments: CoordinationAppointment[];
  contacts: z.infer<typeof contactSchema>[];
};

/**
 * The side panel: name, number, care team, next appointments and the last few contacts. Nothing clinical: no diagnosis, no value,
 * no note (the coordinator sees the minimum needed to coordinate). The full record is one link away and its opening is audited there.
 */
export function usePatientContext(patientId: string | null) {
  return useQuery({
    queryKey: coordinationKeys.patient(patientId ?? "none"),
    enabled: patientId !== null,
    queryFn: async (): Promise<PatientContext> => {
      const supabase = createClient();
      const id = patientId as string;
      const [patient, team, appts, contacts] = await Promise.all([
        supabase.from("profiles").select("full_name, patient_number").eq("id", id).maybeSingle(),
        supabase
          .from("care_team_assignment")
          .select(
            "clinician:profiles!care_team_assignment_clinician_id_fkey(full_name), coordinator:profiles!care_team_assignment_care_coordinator_id_fkey(full_name)",
          )
          .eq("patient_id", id)
          .maybeSingle(),
        supabase
          .from("appointments")
          .select(
            "id, patient_id, scheduled_for, status, appointment_type, booked_via, payment_status, patient:profiles!appointments_patient_id_fkey(full_name), clinician:profiles!appointments_clinician_id_fkey(full_name)",
          )
          .eq("patient_id", id)
          .in("status", UPCOMING as never)
          .gte("scheduled_for", new Date().toISOString())
          .order("scheduled_for", { ascending: true })
          .limit(3),
        supabase
          .from("care_outreach_contacts")
          .select("id, channel, note, contacted_at")
          .eq("patient_id", id)
          .order("contacted_at", { ascending: false })
          .limit(5),
      ]);
      for (const r of [patient, team, appts, contacts]) if (r.error) throw r.error;
      return {
        patient: patient.data ? patientSchema.parse(patient.data) : null,
        careTeam: team.data ? careTeamSchema.parse(team.data) : null,
        nextAppointments: z.array(apptSchema).parse(appts.data ?? []),
        contacts: z.array(contactSchema).parse(contacts.data ?? []),
      };
    },
  });
}

/**
 * Take an item onto your own list. Clears the system's auto-assigned mark (the database does that), so the handover sweep leaves it
 * with you. RLS decides whether you may: org staff only. A queue task is never taken this way; it has its own claim rules.
 */
export function useTakeOverWorkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ source, itemId, me }: { source: Exclude<WorkSource, "queue">; itemId: string; me: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from(TAKE_OVER_TABLE[source] as "care_outreach_tasks")
        .update({ assigned_to: me })
        .eq("id", itemId)
        .select("id");
      if (error) throw error;
      // RLS can turn an update into a silent no-op; report it instead of pretending it worked.
      if (!data || data.length === 0) throw new Error("That item could not be taken: it may have been closed or you may not have access.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: coordinationKeys.all }),
  });
}
