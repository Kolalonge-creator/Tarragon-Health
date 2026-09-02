import "server-only";
import { createMlClientFromEnv, type MlClient } from "@tarragon/shared";
import {
  AI_SYSTEMS,
  decideAiGovernance,
  recordAiInteraction,
  type AiGovernanceClient,
} from "@/lib/ai-governance";

/**
 * `AI-010` — the clinical risk-scoring service, wrapped so the governance kill
 * switch (Module 40.17) and the audit trail (40.11) apply to it.
 *
 * WHY A DECORATOR RATHER THAN A CALL-SITE EDIT. `ml-client.ts` lives in
 * `packages/shared` and has no database access by design — the ML service is
 * stateless and never pulls patient data, so the client cannot check
 * governance for itself. Editing each of the six call sites would have meant
 * six chances to forget one. Instead this wraps the client and every scoring
 * method goes through the same gate.
 *
 * WHY RETURNING NULL IS THE WHOLE FALLBACK. `MlClient` already promises never
 * to throw and to return `null` on any failure, and every caller on the
 * platform already degrades gracefully when it does — rendering the surface
 * without a score, falling back to a local heuristic, or leaving the
 * deterministic clinical thresholds to do their job unaided. A switched-off
 * system therefore looks to callers exactly like a service that is down,
 * which is 40.18 satisfied by a contract that already existed rather than by
 * new branching in six places.
 *
 * `health()` is passed through ungoverned on purpose: it is a liveness probe,
 * not an inference, and an operator checking whether the service is reachable
 * while it is switched off should get a truthful answer.
 */

export interface GovernedMlOptions {
  /**
   * The patient the scores are about, where there is one. Cohort and
   * population analytics have no single subject, so it is optional; the audit
   * row then attributes to the calling account's organisation only.
   */
  readonly subjectProfileId?: string | null;
  /**
   * What the caller is doing, recorded as `input_category`. A short slug, not
   * patient data — e.g. "screening_result_interpretation".
   */
  readonly inputCategory: string;
}

/** Mirrors the version the ML service reports; a drift shows up in
 * ai_vendor_model_observations rather than passing unnoticed (40.19). */
const ML_MODEL_IDENTIFIER = "tarragon-ml-service-0.1.0";

export function createGovernedMlClient(
  supabase: AiGovernanceClient,
  opts: GovernedMlOptions,
): MlClient | null {
  const inner = createMlClientFromEnv();
  // Unconfigured stays unconfigured. Callers already treat a null client as
  // "no ML on this environment", and wrapping nothing would be a lie.
  if (!inner) return null;

  async function governed<T>(method: string, call: () => Promise<T | null>): Promise<T | null> {
    const decision = await decideAiGovernance(supabase, AI_SYSTEMS.clinicalRiskScoring.code);

    if (!decision.allow) {
      await recordAiInteraction(supabase, {
        systemCode: AI_SYSTEMS.clinicalRiskScoring.code,
        modelIdentifier: "none:fallback",
        inputCategory: opts.inputCategory,
        status: "fallback",
        subjectProfileId: opts.subjectProfileId,
        fallbackReason: decision.message,
        resultingAction: `${method}:no_score_returned`,
      });
      return null;
    }

    const startedAt = Date.now();
    const result = await call();

    await recordAiInteraction(supabase, {
      systemCode: AI_SYSTEMS.clinicalRiskScoring.code,
      modelIdentifier: ML_MODEL_IDENTIFIER,
      inputCategory: opts.inputCategory,
      // The client swallows every error into `null`, so a null here is
      // indistinguishable from "the service declined to score this". Recorded
      // as `failed` rather than `completed`, because the caller got nothing
      // either way and a governance dashboard that counted those as successes
      // would hide an outage.
      status: result === null ? "failed" : "completed",
      subjectProfileId: opts.subjectProfileId,
      outputSummary: result === null ? null : `${method} returned a score`,
      latencyMs: Date.now() - startedAt,
      resultingAction: `${method}:${result === null ? "no_score_returned" : "score_for_clinician_review"}`,
      errorMessage: result === null ? "ML service returned no result" : null,
    });

    return result;
  }

  return {
    health: () => inner.health(),
    post: (path, body) => governed(`post ${path}`, () => inner.post(path, body)),
    cvdRisk: (body) => governed("cvdRisk", () => inner.cvdRisk(body)),
    hba1cTrajectory: (body) => governed("hba1cTrajectory", () => inner.hba1cTrajectory(body)),
    bpControl: (body) => governed("bpControl", () => inner.bpControl(body)),
    interpretLabs: (body) => governed("interpretLabs", () => inner.interpretLabs(body)),
    analyseCohort: (body) => governed("analyseCohort", () => inner.analyseCohort(body)),
    batchPredict: (body) => governed("batchPredict", () => inner.batchPredict(body)),
    lifestyleTrends: (body) => governed("lifestyleTrends", () => inner.lifestyleTrends(body)),
    lifestyleEngagement: (body) =>
      governed("lifestyleEngagement", () => inner.lifestyleEngagement(body)),
  };
}
