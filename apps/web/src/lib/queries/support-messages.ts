import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type SupportMessage = Tables<"support_messages"> & {
  patient: { full_name: string | null } | null;
  sender: { full_name: string | null } | null;
};

/**
 * One row per patient with at least one message — the support-inbox thread
 * list. Grouped client-side (support_messages has no thread/conversation
 * table of its own) since the org's message volume is small at pilot scale.
 */
export function useSupportThreads() {
  return useQuery({
    queryKey: ["support-messages", "threads"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("support_messages")
        .select("id, patient_id, direction, body, status, created_at, patient:profiles!support_messages_patient_id_fkey(full_name)")
        .not("patient_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const byPatient = new Map<string, (typeof data)[number]>();
      for (const row of data) {
        if (!row.patient_id) continue;
        if (!byPatient.has(row.patient_id)) byPatient.set(row.patient_id, row);
      }
      return [...byPatient.values()];
    },
  });
}

export function useSupportMessages(patientId: string) {
  return useQuery({
    queryKey: ["support-messages", "thread", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("support_messages")
        .select(
          "*, patient:profiles!support_messages_patient_id_fkey(full_name), sender:profiles!support_messages_sender_id_fkey(full_name)"
        )
        .eq("patient_id", patientId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as SupportMessage[];
    },
    enabled: !!patientId,
  });
}

/**
 * Sends an outbound WhatsApp reply via the send-support-reply Edge
 * Function — the only path that can write an outbound support_messages row
 * (RLS grants authenticated no insert on this table; the function does it
 * under the service-role key after verifying the caller is org staff). The
 * function signs the message with the caller's real clinical_staff name,
 * not this client — never trust a client-supplied signature.
 */
export function useSendSupportReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ patientId, message }: { patientId: string; message: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        stored: boolean;
        error?: string;
      }>("send-support-reply", { body: { patientId, message } });
      if (error) throw error;
      if (!data?.stored) throw new Error(data?.error ?? "Could not save the reply");
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["support-messages", "thread", variables.patientId] });
      queryClient.invalidateQueries({ queryKey: ["support-messages", "threads"] });
    },
  });
}
