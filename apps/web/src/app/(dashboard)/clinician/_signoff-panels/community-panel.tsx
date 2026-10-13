import { t } from "@tarragon/i18n";
import { PROPOSED_CONFIG } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { adminGroupsSchema, ruleSetsSchema, rulesSchema, type Rule, type RuleSet } from "@/lib/community/model";
import { loadGuards } from "@/lib/go-live/load";
import { activateRuleSetAction, approveGroupRulesAction, attestCommunityConditionAction, loadStarterSafetyRulesAction } from "../community/actions";
import { SignoffChecklist, type Attestation, type AttestCode, type ReadOnlyCondition } from "../community/signoff/signoff-checklist";

const LOAD_FAILED = "We could not load this just now. Please reload the page in a moment.";
const ATTEST_CODES: readonly AttestCode[] = ["crisis_owner_named", "consent_text_approved", "clinical_safety_case_current"];

function consentVersion(): string {
  const entry = PROPOSED_CONFIG.find((e) => e.key === "community.rules");
  const value = entry?.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "v1";
  const v = (value as { readonly [k: string]: unknown })["consent_version"];
  return typeof v === "string" ? v : "v1";
}

/**
 * Everything Community needs the Chief Medical Officer to sign, as one block. It is shown inline on the sign-off hub
 * (/clinician/clinical-signoff) like every other thing that needs their signature, and on its own page at /clinician/community/signoff.
 * Every signing calls the same database functions the other Community pages use; the database checks the signer is the CMO. Nothing
 * here switches Community on.
 */
export async function CommunitySignoffPanel() {
  const supabase = await createClient();
  const [groupsRes, setsRes, guards] = await Promise.all([
    supabase.rpc("community_admin_groups"),
    supabase.rpc("community_admin_rule_sets"),
    loadGuards(),
  ]);
  const groupsParsed = adminGroupsSchema.safeParse(groupsRes.data);
  const setsParsed = ruleSetsSchema.safeParse(setsRes.data);
  const community = guards.ok ? (guards.data.find((g) => g.key === "community") ?? null) : null;
  if (groupsRes.error || setsRes.error || !groupsParsed.success || !setsParsed.success || !community) {
    return (
      <p role="alert" className="text-sm text-red-700">
        {LOAD_FAILED}
      </p>
    );
  }

  const sets: RuleSet[] = setsParsed.data.rule_sets;
  const live = sets.find((s) => s.status === "active") ?? null;
  // The newest draft is the one that carries safety rules, if any does.
  const drafts = sets.filter((s) => s.status === "draft").sort((a, b) => b.version - a.version);
  const draft = drafts.find((d) => d.safety_rule_count > 0) ?? drafts[0] ?? null;
  let draftSafetyRules: Rule[] = [];
  if (draft && draft.safety_rule_count > 0) {
    const rulesRes = await supabase.rpc("community_admin_rules", { p_version: draft.version });
    const parsed = rulesSchema.safeParse(rulesRes.data);
    if (rulesRes.error || !parsed.success) {
      return (
        <p role="alert" className="text-sm text-red-700">
          {LOAD_FAILED}
        </p>
      );
    }
    draftSafetyRules = parsed.data.rules.filter((r) => r.action === "safety");
  }

  const attestations: Attestation[] = ATTEST_CODES.map((code) => ({
    code,
    met: community.conditions.find((c) => c.code === code)?.met === true,
  }));
  const otherConditions: ReadOnlyCondition[] = community.conditions
    .filter((c) => c.source === "data")
    .map((c) => ({ code: c.code, label: c.label, met: c.met, detail: c.detail ?? null }));

  return (
    <SignoffChecklist
      live={live}
      draft={draft}
      draftSafetyRules={draftSafetyRules}
      waitingGroups={groupsParsed.data.groups.filter((g) => g.requires_cmo_rules && !g.rules_approved)}
      attestations={attestations}
      consentText={t("community.join.consent", "en")}
      consentVersion={consentVersion()}
      otherConditions={otherConditions}
      onLoadStarter={loadStarterSafetyRulesAction}
      onActivate={activateRuleSetAction}
      onApproveGroupRules={approveGroupRulesAction}
      onAttest={attestCommunityConditionAction}
    />
  );
}
