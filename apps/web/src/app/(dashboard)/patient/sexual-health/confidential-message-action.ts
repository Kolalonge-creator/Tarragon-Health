"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type StartConfidentialSrhThreadResult = { threadId: string } | { error: string };

const inputSchema = z.object({
  subject: z.string().trim().min(3, "Add a short subject").max(150),
  body: z.string().trim().min(1, "Write a message").max(4000),
});

/**
 * Opens a confidential care-team thread from inside the Sexual & Reproductive
 * Health hub. Every SRH-related thread the app opens is expected to pass
 * confidential = true (spec §47.12/§47.13 — see migration
 * 20260902211500's header): a thread here must stay invisible to a
 * sponsor/supporter even when the patient has granted them clinical_access
 * for everything else, which is exactly what the confidential flag on
 * care_message_threads narrows.
 *
 * No p_patient_id is passed — the caller is always starting their own
 * thread, same as MessagesFlow's own "New message" composer
 * (lib/queries/care-messages.ts's useStartThread) — so start_care_thread
 * resolves the patient/org from auth.uid() itself. This mirrors that same
 * RPC call shape as a Server Action instead of a client-side react-query
 * mutation, since the brief for this entry point calls for a plain
 * (subject, body) => result function rather than a hook.
 */
export async function startConfidentialSrhThread(
  subject: string,
  body: string
): Promise<StartConfidentialSrhThreadResult> {
  const parsed = inputSchema.safeParse({ subject, body });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please fill in a subject and a message" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: threadId, error } = await supabase.rpc("start_care_thread", {
    p_subject: parsed.data.subject,
    p_body: parsed.data.body,
    p_confidential: true,
  });
  if (error) return { error: error.message };

  return { threadId: threadId as string };
}
