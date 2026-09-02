import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { evaluateEvent, persistAndApply } from "./dispatcher";

const CLAIM_BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;

export interface WorkerRunSummary {
  claimed: number;
  processed: number;
  failed: number;
}

/**
 * Drains the clinical_rule_events queue (§32.6/§32.7): claims a batch of
 * pending events, evaluates every candidate rule for each, and persists the
 * result. Meant to be called by a Vercel Cron route (api/cron/clinical-
 * rules, same shape as the other cron routes under apps/web/src/app/api/
 * cron/) rather than run inline in a request — event emission (the DB
 * triggers in part 4) is synchronous and cheap; evaluation (DB reads for
 * context, possible action writes) is not, and doing it inline on whatever
 * request happened to insert a vital reading would slow down that request
 * for a reason unrelated to it.
 *
 * A single event's failure is caught and recorded on that event row
 * (status='failed', error_detail, attempts incremented) rather than
 * aborting the whole batch -- one malformed rule or a transient DB error
 * must not stop every OTHER patient's events from being evaluated.
 */
export async function runClinicalRulesWorker(
  supabase: SupabaseClient<Database>
): Promise<WorkerRunSummary> {
  // Two steps rather than one chained update().order().limit(): PostgREST
  // does not guarantee ORDER BY + LIMIT semantics on a mutation the same
  // way it does on a SELECT, so the claim is select-ids-in-order first,
  // then update-by-id -- an explicit, unambiguous claim rather than relying
  // on that behaviour.
  const { data: candidates, error: selectError } = await supabase
    .from("clinical_rule_events")
    .select("id")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("occurred_at", { ascending: true })
    .limit(CLAIM_BATCH_SIZE);
  if (selectError) throw selectError;

  const candidateIds = (candidates ?? []).map((row) => row.id);
  if (candidateIds.length === 0) {
    return { claimed: 0, processed: 0, failed: 0 };
  }

  const { data: claimed, error: claimError } = await supabase
    .from("clinical_rule_events")
    .update({ status: "processing" })
    .in("id", candidateIds)
    .select("*");

  if (claimError) throw claimError;

  const events = claimed ?? [];
  let processed = 0;
  let failed = 0;

  for (const event of events) {
    try {
      const results = await evaluateEvent(supabase, event);
      await persistAndApply(supabase, event, results);
      await supabase
        .from("clinical_rule_events")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("id", event.id);
      processed += 1;
    } catch (err) {
      failed += 1;
      await supabase
        .from("clinical_rule_events")
        .update({
          status: "failed",
          attempts: event.attempts + 1,
          error_detail: err instanceof Error ? err.message : String(err),
        })
        .eq("id", event.id);
    }
  }

  return { claimed: events.length, processed, failed };
}
