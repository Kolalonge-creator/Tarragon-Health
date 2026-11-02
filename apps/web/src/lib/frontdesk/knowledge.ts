import type { SupabaseClient } from "@supabase/supabase-js";
import { fdSelect } from "./raw-db";

/**
 * The only facts the assistant may state (F2): approved, active fd_knowledge entries, with the four live placeholders filled from the SAME
 * configuration the pricing page reads, so a price in a reply is always today's price and never a typed one. If nothing is approved the prompt
 * says so and the assistant hands off rather than guessing.
 */
export interface KnowledgeEntry {
  readonly topic: string;
  readonly content: string;
}

export interface LiveFacts {
  readonly membershipPrice: string;
  readonly paidProductName: string;
  readonly refundDays: string;
  readonly launchDate: string;
}

export function resolveKnowledge(content: string, facts: LiveFacts): string {
  return content
    .replace(/\{\{membership_price\}\}/g, facts.membershipPrice)
    .replace(/\{\{paid_product_name\}\}/g, facts.paidProductName)
    .replace(/\{\{refund_days\}\}/g, facts.refundDays)
    .replace(/\{\{launch_date\}\}/g, facts.launchDate);
}

interface KnowledgeRow {
  topic: string;
  content: string;
  active: boolean;
  approved_at: string | null;
}

/** Approved and active entries only; an unapproved draft can never reach the model, whatever the query returns. */
export async function loadKnowledge(supabase: SupabaseClient, facts: LiveFacts): Promise<{ entries: KnowledgeEntry[]; ok: boolean }> {
  const res = await fdSelect<KnowledgeRow>(supabase, "fd_knowledge", "topic, content, active, approved_at", "topic");
  if (res.error) return { entries: [], ok: false };
  const entries = res.rows
    .filter((r) => r.active === true && r.approved_at !== null)
    .map((r) => ({ topic: r.topic, content: resolveKnowledge(r.content, facts) }));
  return { entries, ok: true };
}

export function knowledgeText(entries: readonly KnowledgeEntry[]): string {
  return entries.map((e) => `## ${e.topic.replace(/_/g, " ")}\n${e.content}`).join("\n\n");
}
