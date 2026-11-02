import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fdSelect } from "@/lib/frontdesk/raw-db";
import { frontDeskSignoff, type FrontDeskSignoff, type KnowledgeRow, type StepRow } from "@/lib/frontdesk/signoff-model";

interface StepDb {
  id: string;
  position: number;
  delay_minutes: number;
  step_key: string;
  subject: string;
  body_text: string;
  status: "draft" | "approved";
  approved_at: string | null;
  fd_sequences: { key: string; name: string; purpose: "service_followup" | "marketing" } | null;
}
interface KnowledgeDb {
  id: string;
  topic: string;
  version: number;
  content: string;
  active: boolean;
  approved_at: string | null;
}

/**
 * Front desk wording waiting for an admin: follow-up email steps and assistant knowledge entries (M1). Shared by the admin home banner and
 * the /admin/sign-off page so the two counts cannot drift. A failed read sets `failed`; the banner then says it could not check, never
 * "nothing waiting".
 */
export async function readPendingFrontDeskSignoff(supabase: SupabaseClient): Promise<FrontDeskSignoff> {
  const [steps, knowledge] = await Promise.all([
    fdSelect<StepDb>(supabase, "fd_sequence_steps", "id, position, delay_minutes, step_key, subject, body_text, status, approved_at, fd_sequences(key, name, purpose)", "position"),
    fdSelect<KnowledgeDb>(supabase, "fd_knowledge", "id, topic, version, content, active, approved_at", "topic"),
  ]);
  const stepRows: StepRow[] = steps.rows.map((r) => ({
    id: r.id,
    sequenceKey: r.fd_sequences?.key ?? "",
    sequenceName: r.fd_sequences?.name ?? "",
    sequencePurpose: r.fd_sequences?.purpose ?? "service_followup",
    position: r.position,
    delayMinutes: r.delay_minutes,
    stepKey: r.step_key,
    subject: r.subject,
    bodyText: r.body_text,
    status: r.status,
    approvedAt: r.approved_at,
  }));
  const knowledgeRows: KnowledgeRow[] = knowledge.rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    version: r.version,
    content: r.content,
    active: r.active,
    approvedAt: r.approved_at,
  }));
  return frontDeskSignoff(stepRows, knowledgeRows, steps.error !== null || knowledge.error !== null);
}
