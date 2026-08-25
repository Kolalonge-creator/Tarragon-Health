import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables, Enums } from "@tarragon/shared";

export type OutreachTask = Tables<"care_outreach_tasks">;
export type OutreachStatus = Enums<"outreach_task_status">;
export type OutreachTriggerType = Enums<"outreach_trigger_type">;

export type OutreachTaskWithPatient = OutreachTask & {
  patient: { full_name: string | null; patient_number: string | null; phone: string | null } | null;
};

export type OutreachContact = Tables<"care_outreach_contacts">;
export type OutreachContactChannel = Enums<"outreach_contact_channel">;

export type OutreachContactWithPatient = OutreachContact & {
  patient: { full_name: string | null; patient_number: string | null; phone: string | null } | null;
};

const TASK_SELECT =
  "*, patient:profiles!care_outreach_tasks_patient_id_fkey(full_name, patient_number, phone)";

const CONTACT_SELECT =
  "*, patient:profiles!care_outreach_contacts_patient_id_fkey(full_name, patient_number, phone)";

export const outreachKeys = {
  org: ["care-outreach", "org"] as const,
};

export const outreachContactKeys = {
  patient: (patientId: string) => ["care-outreach", "contacts", "patient", patientId] as const,
  recent: ["care-outreach", "contacts", "recent"] as const,
};

/**
 * The proactive-outreach worklist — every live task the nightly
 * private.queue_care_outreach() engine surfaced from risk scores + care gaps.
 * RLS (private.is_org_staff) scopes to the org; patients never see this table.
 */
export function useOutreachTasks() {
  return useQuery({
    queryKey: outreachKeys.org,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_outreach_tasks")
        .select(TASK_SELECT)
        .in("status", ["open", "in_progress", "contacted"])
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as OutreachTaskWithPatient[];
    },
  });
}

/**
 * Move a task through its logistics states. resolved_by/resolved_at are
 * stamped server-side by private.stamp_outreach_resolution — never sent from
 * here (client values are overwritten by the trigger anyway).
 */
export function useUpdateOutreachTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskId,
      status,
      outcomeNote,
      claim,
    }: {
      taskId: string;
      status?: OutreachStatus;
      outcomeNote?: string | null;
      claim?: boolean;
    }) => {
      const supabase = createClient();
      const update: {
        status?: OutreachStatus;
        outcome_note?: string | null;
        assigned_to?: string;
      } = {};
      if (status) update.status = status;
      if (outcomeNote !== undefined) update.outcome_note = outcomeNote;
      if (claim) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) update.assigned_to = user.id;
      }
      const { error } = await supabase
        .from("care_outreach_tasks")
        .update(update)
        .eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: outreachKeys.org });
    },
  });
}

/**
 * A single patient's outreach contact log — every call/WhatsApp attempt a
 * coordinator has logged, newest first. This is a log, not a chat: there is
 * no live send and no inbound-reply capture (see the care_outreach_contacts
 * migration for why — two-way patient<->care-team conversation stays in-app
 * only, never WhatsApp).
 */
export function useOutreachContacts(patientId: string | null) {
  return useQuery({
    queryKey: outreachContactKeys.patient(patientId ?? ""),
    enabled: !!patientId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_outreach_contacts")
        .select(CONTACT_SELECT)
        .eq("patient_id", patientId as string)
        .order("contacted_at", { ascending: false });
      if (error) throw error;
      return data as OutreachContactWithPatient[];
    },
  });
}

/** Most recent contact log entries across the org, for the Overview snapshot. */
export function useRecentOutreachContacts(limit = 5) {
  return useQuery({
    queryKey: outreachContactKeys.recent,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_outreach_contacts")
        .select(CONTACT_SELECT)
        .order("contacted_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as OutreachContactWithPatient[];
    },
  });
}

/**
 * Append a new contact log entry. contacted_by is stamped server-side by
 * private.stamp_outreach_contact_author — never sent from here.
 */
export function useLogOutreachContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      taskId,
      channel,
      note,
    }: {
      patientId: string;
      taskId?: string | null;
      channel: OutreachContactChannel;
      note: string;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", patientId)
        .single();
      if (profileError) throw profileError;
      if (!profile?.organisation_id) {
        throw new Error("This patient has no organisation on file");
      }

      // private.stamp_outreach_contact_author overwrites contacted_by to the
      // caller's own auth.uid() server-side regardless of what's sent here —
      // sent anyway so the row satisfies the NOT NULL constraint pre-trigger.
      const { error } = await supabase.from("care_outreach_contacts").insert({
        patient_id: patientId,
        organisation_id: profile.organisation_id,
        contacted_by: user.id,
        task_id: taskId ?? null,
        channel,
        note,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: outreachContactKeys.patient(variables.patientId) });
      queryClient.invalidateQueries({ queryKey: outreachContactKeys.recent });
    },
  });
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Outreach tasks resolved in the last 7 days — Overview snapshot only. */
export function useResolvedOutreachCountThisWeek() {
  return useQuery({
    queryKey: ["care-outreach", "resolved-this-week"],
    queryFn: async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
      const { count, error } = await supabase
        .from("care_outreach_tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", "resolved")
        .gte("resolved_at", since);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/** Contact log entries added in the last 7 days — Overview snapshot only. */
export function useOutreachContactCountThisWeek() {
  return useQuery({
    queryKey: ["care-outreach", "contacts-this-week"],
    queryFn: async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
      const { count, error } = await supabase
        .from("care_outreach_contacts")
        .select("id", { count: "exact", head: true })
        .gte("contacted_at", since);
      if (error) throw error;
      return count ?? 0;
    },
  });
}
