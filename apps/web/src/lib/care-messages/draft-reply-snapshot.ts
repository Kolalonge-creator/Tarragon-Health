import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * The minimized, structured data a reply draft is grounded in -- the recent
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

  const { data: messages } = await supabase
    .from("care_messages")
    .select("author_role, body, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_HISTORY_LIMIT);

  return {
    threadSubject: thread.subject,
    messages: (messages ?? [])
      .slice()
      .reverse()
      .map((m) => ({ authorRole: m.author_role, body: m.body, createdAt: m.created_at })),
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
