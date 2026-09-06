import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { EvaluationContext, ParsedClinicalRule } from "./types";

/**
 * §32.10 cooldown / suppression / deduplication / episode grouping.
 *
 * Implemented here: COOLDOWN (a rule that fired recently for this patient
 * stays quiet for `cooldown_hours`) and EPISODE CAP (at most
 * `max_per_episode` actions for one clinical episode, e.g. one hypertensive
 * run, before the engine stops repeating itself). MANUAL suppression is a
 * clinician action (public.suppress_clinical_rule_for_patient, part 3) read
 * by the same lookup here. Deduplication is folded into the suppression
 * key's composition (dedup_key_fields) rather than being a fourth separate
 * mechanism — two evaluations that hash to the same key ARE the same
 * "thing", cooldown-suppressing the second is deduplication.
 *
 * What this does NOT attempt: cross-rule deduplication (two different
 * rules producing what a clinician would see as the same alert) — that is
 * §32.9 conflict resolution's job (conflict.ts), a different mechanism for
 * a different problem.
 */

/** Stable identity for "this rule, this patient, these dedup fields' current values". */
export function buildSuppressionKey(
  rule: ParsedClinicalRule,
  patientId: string,
  context: EvaluationContext
): string {
  const fields = rule.suppression.dedup_key_fields ?? [];
  const parts = fields.map((field) => `${field}=${String(context[field] ?? "null")}`);
  return [rule.rule_key, patientId, ...parts].join("|");
}

/** Groups repeated triggers of one clinical episode (e.g. one hypertensive run). */
export function buildEpisodeKey(
  rule: ParsedClinicalRule,
  patientId: string,
  context: EvaluationContext
): string | null {
  const fields = rule.suppression.episode_key_fields;
  if (!fields || fields.length === 0) return null;
  const parts = fields.map((field) => `${field}=${String(context[field] ?? "null")}`);
  return [rule.rule_key, patientId, ...parts].join("|");
}

export interface ActiveSuppression {
  mechanism: "cooldown" | "deduplication" | "episode_cap" | "manual";
  reason: string;
}

/**
 * Checks every live suppression for this rule+patient: a clinician's manual
 * suppression, an active cooldown, or (via episodeKey) an episode that has
 * already hit its cap. Returns the first one found — callers don't need to
 * know which table row backed it, only that the action should be withheld
 * and why.
 */
export async function findActiveSuppression(
  supabase: SupabaseClient<Database>,
  rule: ParsedClinicalRule,
  patientId: string,
  suppressionKey: string,
  episodeKey: string | null
): Promise<ActiveSuppression | null> {
  const keys = [suppressionKey, ...(episodeKey ? [episodeKey] : [])];

  const { data, error } = await supabase
    .from("clinical_rule_suppressions")
    .select("mechanism, reason, suppressed_until, hit_count")
    .eq("rule_key", rule.rule_key)
    .eq("patient_id", patientId)
    .in("suppression_key", keys)
    .gt("suppressed_until", new Date().toISOString());

  if (error) throw error;
  if (!data || data.length === 0) return null;

  // An episode_cap row exists from the FIRST fire onward (it is how the hit
  // count is tracked at all), but it only actually suppresses once
  // hit_count has reached the configured cap -- otherwise every rule with
  // episode grouping configured would silently suppress its own second
  // fire regardless of max_per_episode.
  const maxPerEpisode = rule.suppression.max_per_episode;
  const active = data.filter(
    (row) => row.mechanism !== "episode_cap" || (maxPerEpisode !== undefined && row.hit_count >= maxPerEpisode)
  );
  if (active.length === 0) return null;

  // Manual suppression always wins the explanation shown, even if a
  // cooldown is also live — a clinician's explicit decision is the more
  // informative reason to surface.
  const manual = active.find((row) => row.mechanism === "manual");
  const row = manual ?? active[0];
  return { mechanism: row.mechanism as ActiveSuppression["mechanism"], reason: row.reason };
}

/**
 * Called after a rule's actions are emitted (or would have been, in
 * shadow), to start/refresh its cooldown and increment the episode
 * counter. No-ops when the rule configures neither cooldown_hours nor
 * episode grouping — most rules fire every time their conditions are met,
 * which is the correct default.
 */
export async function recordSuppressionAfterFire(
  supabase: SupabaseClient<Database>,
  organisationId: string,
  rule: ParsedClinicalRule,
  patientId: string,
  suppressionKey: string,
  episodeKey: string | null
): Promise<void> {
  const { cooldown_hours, max_per_episode } = rule.suppression;

  if (cooldown_hours && cooldown_hours > 0) {
    const until = new Date(Date.now() + cooldown_hours * 60 * 60 * 1000).toISOString();
    await upsertSuppression(supabase, {
      organisation_id: organisationId,
      rule_key: rule.rule_key,
      patient_id: patientId,
      suppression_key: suppressionKey,
      episode_key: episodeKey,
      mechanism: "cooldown",
      suppressed_until: until,
      reason: `Cooldown: ${rule.name} fired for this patient; quiet for ${cooldown_hours}h per its governed suppression config.`,
    });
  }

  if (episodeKey && max_per_episode && max_per_episode > 0) {
    // A long window (30 days) stands in for "while the episode is still
    // open" — there is no separate episode-close signal yet, so the cap
    // naturally expires rather than blocking forever.
    const until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await upsertSuppression(
      supabase,
      {
        organisation_id: organisationId,
        rule_key: rule.rule_key,
        patient_id: patientId,
        suppression_key: episodeKey,
        episode_key: episodeKey,
        mechanism: "episode_cap",
        suppressed_until: until,
        reason: `Episode cap: ${rule.name} allows at most ${max_per_episode} action(s) per episode.`,
      },
      max_per_episode
    );
  }
}

async function upsertSuppression(
  supabase: SupabaseClient<Database>,
  row: {
    organisation_id: string;
    rule_key: string;
    patient_id: string;
    suppression_key: string;
    episode_key: string | null;
    mechanism: "cooldown" | "episode_cap";
    suppressed_until: string;
    reason: string;
  },
  capAt?: number
): Promise<void> {
  const { data: existing } = await supabase
    .from("clinical_rule_suppressions")
    .select("id, hit_count")
    .eq("rule_key", row.rule_key)
    .eq("suppression_key", row.suppression_key)
    .maybeSingle();

  const nextHitCount = (existing?.hit_count ?? 0) + 1;
  // Once an episode cap is reached, stop pushing suppressed_until forward —
  // the row's presence with hit_count >= cap is itself what
  // findActiveSuppression's window (suppressed_until in the future) keys
  // off, so it should keep blocking for its full 30-day window rather than
  // being silently refreshed by every subsequent match.
  if (row.mechanism === "episode_cap" && capAt !== undefined && (existing?.hit_count ?? 0) >= capAt) {
    return;
  }

  await supabase.from("clinical_rule_suppressions").upsert(
    {
      organisation_id: row.organisation_id,
      rule_key: row.rule_key,
      patient_id: row.patient_id,
      suppression_key: row.suppression_key,
      episode_key: row.episode_key,
      mechanism: row.mechanism,
      suppressed_until: row.suppressed_until,
      reason: row.reason,
      hit_count: nextHitCount,
    },
    { onConflict: "rule_key,suppression_key" }
  );
}
