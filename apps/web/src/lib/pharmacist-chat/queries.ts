import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { loose } from "@/lib/clinician/loose-client";
import {
  chatPharmaciesSchema,
  patientMessagesSchema,
  patientThreadsSchema,
  pharmacistMessagesSchema,
  pharmacistThreadsSchema,
  sendResultSchema,
} from "./model";

/**
 * S54 8.12 hooks. Every answer is parsed; an error or a malformed answer THROWS, so a screen shows "could not load" and never an
 * empty conversation. Messages are fetched only when a thread is opened (a pharmacist's open is audited by the database).
 */
async function rpc<S extends z.ZodTypeAny>(fn: string, args: Record<string, unknown>, schema: S): Promise<z.infer<S>> {
  const { data, error } = await loose(createClient()).rpc(fn, args);
  if (error) throw new Error(error.message);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error("unexpected response");
  return parsed.data;
}

export function useChatPharmacies() {
  return useQuery({ queryKey: ["chat-pharmacies"], retry: false, staleTime: 5 * 60_000, queryFn: () => rpc("patient_chat_pharmacies", {}, chatPharmaciesSchema) });
}
export function usePatientChatThreads() {
  return useQuery({ queryKey: ["patient-chat-threads"], retry: false, queryFn: () => rpc("patient_pharmacist_chat_threads", {}, patientThreadsSchema) });
}
export function usePatientChatMessages(threadId: string | null) {
  return useQuery({
    queryKey: ["patient-chat-messages", threadId],
    enabled: !!threadId,
    retry: false,
    refetchInterval: 20_000,
    queryFn: () => rpc("patient_pharmacist_chat_messages", { p_thread: threadId }, patientMessagesSchema),
  });
}
export function useStartPharmacistChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { partnerId: string; medicationId?: string | null; topic: string; body: string }) =>
      rpc("patient_start_pharmacist_chat", { p_partner: i.partnerId, p_medication: i.medicationId ?? null, p_topic: i.topic, p_body: i.body }, sendResultSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["patient-chat-threads"] }),
  });
}
export function useSendPharmacistChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { threadId: string; body: string }) => rpc("patient_send_pharmacist_chat", { p_thread: i.threadId, p_body: i.body }, sendResultSchema),
    onSuccess: (_d, i) => {
      qc.invalidateQueries({ queryKey: ["patient-chat-messages", i.threadId] });
      qc.invalidateQueries({ queryKey: ["patient-chat-threads"] });
    },
  });
}

// ---- the pharmacy's side ----
export function usePharmacistChatThreads() {
  return useQuery({ queryKey: ["pharmacist-chat-threads"], retry: false, refetchOnWindowFocus: false, queryFn: () => rpc("pharmacist_chat_threads", {}, pharmacistThreadsSchema) });
}
export function usePharmacistChatMessages(threadId: string | null) {
  return useQuery({
    queryKey: ["pharmacist-chat-messages", threadId],
    enabled: !!threadId,
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    queryFn: () => rpc("pharmacist_chat_read", { p_thread: threadId }, pharmacistMessagesSchema),
  });
}
function usePharmacistAction(fn: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { threadId: string; body?: string }) => {
      const args: Record<string, unknown> = { p_thread: i.threadId };
      if (i.body !== undefined) args.p_body = i.body;
      const { error } = await loose(createClient()).rpc(fn, args);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, i) => {
      qc.invalidateQueries({ queryKey: ["pharmacist-chat-messages", i.threadId] });
      qc.invalidateQueries({ queryKey: ["pharmacist-chat-threads"] });
    },
  });
}
export const usePharmacistChatReply = () => usePharmacistAction("pharmacist_chat_reply");
export const usePharmacistChatEscalate = () => usePharmacistAction("pharmacist_chat_escalate");
export const usePharmacistChatClose = () => usePharmacistAction("pharmacist_chat_close");
