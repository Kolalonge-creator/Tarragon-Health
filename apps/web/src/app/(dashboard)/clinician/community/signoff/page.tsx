import Link from "next/link";
import { t } from "@tarragon/i18n";
import { PROPOSED_CONFIG } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { adminGroupsSchema, ruleSetsSchema, rulesSchema, type Rule, type RuleSet } from "@/lib/community/model";
import { loadGuards } from "@/lib/go-live/load";
import { getCommunityStaffContext } from "@/components/community/staff-rpc";
import { activateRuleSetAction, approveGroupRulesAction, attestCommunityConditionAction, loadStarterSafetyRulesAction } from "../actions";
import { SignoffChecklist, type Attestation, type AttestCode, type ReadOnlyCondition } from "./signoff-checklist";

export const metadata = { title: "Community sign-off" };
export const dynamic = "force-dynamic";

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
 * The Chief Medical Officer's one page for everything Community needs signed: the emergency and self-harm rules, group rules that need
 * approval, and the three statements only a person can make. Every signing calls the same database function the other pages use, and the
 * database checks that the signed-in person is the Chief Medical Officer. Nothing here switches Community on: that stays on the go-live page.
 */
export default async function CommunitySignoffPage() {
  const ctx = await getCommunityStaffContext();
  if (!ctx || !ctx.is_cmo) {
    return (
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Community sign-off</h1>
        <p className="text-sm text-charcoal-ink/70">This page is for the Chief Medical Officer.</p>
      </div>
    );
  }

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
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Community sign-off</h1>
        <p role="alert" className="text-sm text-red-700">
          {LOAD_FAILED}
        </p>
      </div>
    );
  }

  const sets: RuleSet[] = setsParsed.data.rule_sets;
  const live = sets.find((s) => s.status === "active") ?? null;
  // The newest draft is the one that carries safety rules, if any does.
  const drafts = sets.filter((s) => s.status === "draft").sort((a, b) => b.version - a.version);
  const draft = drafts.find((d) => d.safety_rule_count > 0) ?? drafts[0] ?? null;
  let draftSafetyRules: Rule[] = [];
  let rulesFailed = false;
  if (draft && draft.safety_rule_count > 0) {
    const rulesRes = await supabase.rpc("community_admin_rules", { p_version: draft.version });
    const parsed = rulesSchema.safeParse(rulesRes.data);
    if (rulesRes.error || !parsed.success) rulesFailed = true;
    else draftSafetyRules = parsed.data.rules.filter((r) => r.action === "safety");
  }

  const attestations: Attestation[] = ATTEST_CODES.map((code) => ({
    code,
    met: community.conditions.find((c) => c.code === code)?.met === true,
  }));
  const otherConditions: ReadOnlyCondition[] = community.conditions
    .filter((c) => c.source === "data")
    .map((c) => ({ code: c.code, label: c.label, met: c.met, detail: c.detail ?? null }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Community sign-off</h1>
        <p className="text-sm text-charcoal-ink/60">
          Read each item and sign it yourself. Each signing is recorded with your name and the date. Nothing here switches the community on.
        </p>
      </div>
      <nav aria-label="Related pages" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href="/clinician/community" className="font-medium text-brand-green underline">
          All Community tools
        </Link>
        <Link href="/clinician/community/drill" className="font-medium text-brand-green underline">
          Safety drill
        </Link>
        <Link href="/clinician/go-live" className="font-medium text-brand-green underline">
          Go-live page (the switch)
        </Link>
      </nav>
      {rulesFailed ? (
        <p role="alert" className="text-sm text-red-700">
          {LOAD_FAILED}
        </p>
      ) : (
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
      )}
    </div>
  );
}
