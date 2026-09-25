/**
 * The column lists behind AiSystemVersionRow/AiClinicalAccuracyCaseRow
 * (ai-governance-console.tsx), pulled into their own plain module rather than
 * exported from that file directly: ai-governance-console.tsx is a "use
 * client" component, and importing a plain string constant from a "use
 * client" module into a Server Component doesn't survive the RSC boundary as
 * a real string (confirmed live: `.select(AI_EVALUATION_CASE_COLUMNS)` threw
 * "split is not a function" from inside the Supabase client, which expects an
 * actual string). Every `.select()` fetching one of these row shapes — the
 * admin console's own page.tsx and /clinician/ai-governance/page.tsx, which
 * intentionally query a different, narrower slice (pending-only, one suite
 * kind) but render the exact same rows through AiSystemVersionCard /
 * ClinicalAccuracyReviewSection — shares one string from here instead of two
 * independently-typed literals that a future column add/rename can silently
 * update in one and not the other.
 */
export const AI_SYSTEM_VERSION_COLUMNS =
  "id, ai_system_id, version, model_identifier, intended_population, excluded_population, validation_summary, validation_completed_at, approved_at, deployed_at, retired_at, review_due_on, change_summary, created_at, validated_by_staff:clinical_staff!ai_system_versions_validated_by_fkey(full_name), approved_by_staff:clinical_staff!ai_system_versions_approved_by_fkey(full_name)";

export const AI_EVALUATION_CASE_COLUMNS =
  "id, suite_id, case_code, scenario, expected_tier, labeled_at, label_rationale, ai_evaluation_suites!inner(name, kind, ai_system_id), labeled_by_staff:clinical_staff!ai_evaluation_cases_labeled_by_fkey(full_name)";
