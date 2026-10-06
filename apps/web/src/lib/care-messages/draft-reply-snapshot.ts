import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { z } from "zod";

/**
 * The minimised, structured data a reply draft is grounded in -- the recent
 * messages in the thread, already visible to the staff member on the same
 * page. Stored verbatim as care_message_draft_replies.input_snapshot, so it
 * doubles as the audit record of what the model actually saw (same
 * discipline as lib/case-briefs/snapshot.ts's CaseSnapshot).
 */
export interface DraftReplySnapshot {
  threadSubject: string;
  /** Oldest first (reading order), most recent MESSAGE_HISTORY_LIMIT only. */
  messages: {
    authorRole: "patient" | "care_team" | "sponsor";
    body: string;
    createdAt: string;
  }[];
}

const MESSAGE_HISTORY_LIMIT = 10;

const rpcMessagesSchema = z.array(
  z.object({
    author_role: z.enum(["patient", "care_team", "sponsor"]),
    body: z.string(),
    created_at: z.string(),
  })
);

/**
 * Best-effort snapshot -- never throws. A failed query just returns null;
 * the draft generator degrades further from there (see generate-draft-
 * reply.ts), same "best-effort grounding" discipline as case-briefs'
 * buildCaseSnapshot.
 */
export async function buildDraftReplySnapshot(
  supabase: SupabaseClient<Database>,
  threadId: string
): Promise<DraftReplySnapshot | null> {
  const { data: thread } = await supabase
    .from("care_message_threads")
    .select("subject")
    .eq("id", threadId)
    .maybeSingle();

  if (!thread) return null;

  // Staff cannot select care_messages rows directly; the audited open returns them (oldest first) and writes
  // the audit row. Best-effort: any failure leaves the draft ungrounded rather than throwing.
  const { data: opened, error } = await supabase.rpc("open_care_thread_audited", { p_thread: threadId });
  if (error) return null;
  const parsed = rpcMessagesSchema.safeParse(opened ?? []);
  if (!parsed.success) return null;

  return {
    threadSubject: thread.subject,
    messages: parsed.data.slice(-MESSAGE_HISTORY_LIMIT).map((m) => ({
      authorRole: m.author_role,
      body: m.body,
      createdAt: m.created_at,
    })),
  };
}

/**
 * Renders a snapshot into the plain-text block the model sees. Pure and
 * deterministic so it's unit-testable without a live Supabase client or a
 * Claude call -- see draft-reply-snapshot.test.ts.
 */
export function formatDraftReplySnapshotForPrompt(snapshot: DraftReplySnapshot): string {
  const lines: string[] = [];

  lines.push(`Thread subject: ${snapshot.threadSubject}`);

  if (snapshot.messages.length === 0) {
    lines.push("No messages in this thread yet.");
    return lines.join("\n");
  }

  lines.push("Recent messages, oldest first:");
  for (const message of snapshot.messages) {
    const speaker =
      message.authorRole === "patient"
        ? "Patient"
        : message.authorRole === "sponsor"
          ? "Supporter"
          : "Care team";
    lines.push(`${speaker}: ${message.body}`);
  }

  return lines.join("\n");
}
