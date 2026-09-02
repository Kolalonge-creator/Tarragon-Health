"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type RecordCdsDecisionState = { error?: string; success?: boolean } | undefined;

/**
 * §38.12 clinician override / §38.14 documented outcome: records what a
 * clinician decided about one Clinical Decision Support recommendation.
 *
 * Attribution (decided_by / decided_by_profile / decided_at) is NEVER taken
 * from this form — private.enforce_cds_decision_attribution derives it
 * server-side from the caller's own active clinical_staff row and refuses a
 * Care Coordinator by name, exactly the forge-proof pattern used everywhere
 * else attribution matters on this platform (medication_reviews.reviewed_by,
 * clinician_alerts.overridden_by).
 *
 * The recommendation itself is never re-derived here — it is a snapshot of
 * exactly what loadCdsView showed the clinician a moment ago, submitted as
 * hidden form fields by CdsRecommendationCard. Re-deriving it from the record
 * a second time on submit would open a window where the record changed
 * between render and submit and the decision would be filed against facts
 * the clinician never actually saw.
 */
const schema = z
  .object({
    recommendationKey: z.string().trim().min(1),
    recommendationFingerprint: z.string().trim().min(1),
    category: z.enum(["chronic_disease_control", "medication_safety", "monitoring", "referral"]),
    priority: z.enum(["high", "medium", "low"]),
    title: z.string().trim().min(1).max(500),
    triggerText: z.string().trim().min(1).max(2000),
    sourceLabel: z.string().trim().min(1).max(500),
    decision: z.enum(["accepted", "actioned", "overridden", "deferred"]),
    overrideReason: z.string().trim().max(2000).optional(),
    outcomeNote: z.string().trim().max(2000).optional(),
    // yyyy-mm-dd from <input type="date">
    suppressUntil: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.decision === "overridden" || data.decision === "deferred") && !data.overrideReason) {
      ctx.addIssue({
        code: "custom",
        path: ["overrideReason"],
        message: "Say why — an override or a deferral needs a reason.",
      });
    }
    if (data.decision === "deferred" && !data.suppressUntil) {
      ctx.addIssue({
        code: "custom",
        path: ["suppressUntil"],
        message: "A deferral needs a date it comes back.",
      });
    }
  });

export async function recordCdsDecision(
  patientId: string,
  organisationId: string,
  _prevState: RecordCdsDecisionState,
  formData: FormData
): Promise<RecordCdsDecisionState> {
  const parsed = schema.safeParse({
    recommendationKey: formData.get("recommendationKey"),
    recommendationFingerprint: formData.get("recommendationFingerprint"),
    category: formData.get("category"),
    priority: formData.get("priority"),
    title: formData.get("title"),
    triggerText: formData.get("triggerText"),
    sourceLabel: formData.get("sourceLabel"),
    decision: formData.get("decision"),
    overrideReason: formData.get("overrideReason") || undefined,
    outcomeNote: formData.get("outcomeNote") || undefined,
    suppressUntil: formData.get("suppressUntil") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.from("cds_recommendation_decisions").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    recommendation_key: parsed.data.recommendationKey,
    recommendation_fingerprint: parsed.data.recommendationFingerprint,
    category: parsed.data.category,
    priority: parsed.data.priority,
    title: parsed.data.title,
    trigger_text: parsed.data.triggerText,
    source_label: parsed.data.sourceLabel,
    decision: parsed.data.decision,
    override_reason: parsed.data.overrideReason ?? null,
    outcome_note: parsed.data.outcomeNote ?? null,
    suppress_until: parsed.data.suppressUntil ? `${parsed.data.suppressUntil}T00:00:00Z` : null,
  });

  if (error) {
    // The DB's own messages are already clinician-legible (e.g. "A Care
    // Coordinator can see decision support but cannot accept or override a
    // clinical recommendation.") -- surfaced verbatim rather than a generic
    // failure, same as completeHealthCheckReview.
    return { error: error.message };
  }
  return { success: true };
}
