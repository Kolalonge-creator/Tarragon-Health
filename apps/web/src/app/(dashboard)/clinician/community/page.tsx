import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  adminGroupsSchema,
  noteGroupsSchema,
  pinnedAdminSchema,
  ruleSetsSchema,
  rulesSchema,
  type RuleSet,
} from "@/lib/community/model";
import { getCommunityStaffContext } from "@/components/community/staff-rpc";
import {
  approveGroupRulesAction,
  activateRuleSetAction,
  createDraftRuleSetAction,
  deleteSafetyRuleAction,
  pinNoteAction,
  reviewPinAction,
  saveSafetyRuleAction,
} from "./actions";
import { GroupRulesApproval, RuleSetActivation, SafetyRulesEditor } from "./cmo-panels";
import { NotesPanel, type NoteRow } from "./notes-panel";

export const metadata = { title: "Community" };
export const dynamic = "force-dynamic";

const LOAD_FAILED = "We could not load this just now. Please reload the page in a moment.";

interface GroupChoice {
  id: string;
  name: string;
}

export default async function ClinicianCommunityPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const ctx = await getCommunityStaffContext();

  if (!ctx || (!ctx.is_cmo && !ctx.is_clinician)) {
    return (
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Community</h1>
        <p className="text-sm text-charcoal-ink/70">This page is for the Chief Medical Officer and for clinicians.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const { group: requestedGroup } = await searchParams;

  // --- Chief Medical Officer ---
  let cmoBlock: React.ReactNode = null;
  if (ctx.is_cmo) {
    const [groupsRes, setsRes] = await Promise.all([supabase.rpc("community_admin_groups"), supabase.rpc("community_admin_rule_sets")]);
    const groupsParsed = adminGroupsSchema.safeParse(groupsRes.data);
    const setsParsed = ruleSetsSchema.safeParse(setsRes.data);
    if (groupsRes.error || setsRes.error || !groupsParsed.success || !setsParsed.success) {
      cmoBlock = (
        <p role="alert" className="text-sm text-red-700">
          {LOAD_FAILED}
        </p>
      );
    } else {
      const waiting = groupsParsed.data.groups.filter((g) => g.requires_cmo_rules && !g.rules_approved);
      const sets: RuleSet[] = setsParsed.data.rule_sets;
      const draft = sets.find((s) => s.status === "draft") ?? null;
      let rules: ReturnType<typeof rulesSchema.parse>["rules"] = [];
      let rulesFailed = false;
      if (draft) {
        const rulesRes = await supabase.rpc("community_admin_rules", { p_version: draft.version });
        const rulesParsed = rulesSchema.safeParse(rulesRes.data);
        if (rulesRes.error || !rulesParsed.success) rulesFailed = true;
        else rules = rulesParsed.data.rules;
      }
      const safetyRules = rules.filter((r) => r.action === "safety" && (r.class === "emergency" || r.class === "self_harm"));
      cmoBlock = (
        <div className="space-y-4">
          <GroupRulesApproval groups={waiting} onApproveGroupRules={approveGroupRulesAction} />
          {rulesFailed ? (
            <p role="alert" className="text-sm text-red-700">
              {LOAD_FAILED}
            </p>
          ) : (
            <SafetyRulesEditor
              draft={draft}
              rules={safetyRules}
              otherRuleCount={rules.length - safetyRules.length}
              onSaveRule={saveSafetyRuleAction}
              onDeleteRule={deleteSafetyRuleAction}
              onCreateDraft={createDraftRuleSetAction}
            />
          )}
          <RuleSetActivation sets={sets} onActivate={activateRuleSetAction} />
          <p className="text-sm text-charcoal-ink/80">
            You switch the community on or off on the{" "}
            <Link href="/clinician/go-live" className="font-medium text-brand-green underline">
              go-live page
            </Link>
            . It is not switched here.
          </p>
        </div>
      );
    }
  }

  // --- Notes for groups (any clinician) ---
  let notesBlock: React.ReactNode = null;
  if (ctx.is_clinician) {
    let choices: GroupChoice[] = [];
    let listFailed = false;
    const groupsRes = await supabase.rpc("community_note_groups");
    const groupsParsed = noteGroupsSchema.safeParse(groupsRes.data);
    if (groupsRes.error || !groupsParsed.success) listFailed = true;
    else choices = groupsParsed.data.groups.filter((g) => g.status !== "archived").map((g) => ({ id: g.id, name: g.name }));
    const selected = choices.find((c) => c.id === requestedGroup) ?? choices[0] ?? null;
    let notes: NoteRow[] = [];
    let notesFailed = false;
    if (selected) {
      const res = await supabase.rpc("community_admin_pinned", { p_group_id: selected.id });
      const parsed = pinnedAdminSchema.safeParse(res.data);
      if (res.error || !parsed.success) notesFailed = true;
      else
        notes = parsed.data.pinned
          .filter((n) => n.unpinned_at === null)
          .map((n) => ({
            id: n.id,
            title: n.title,
            body: n.body,
            authored_by_name: n.authored_by_name,
            reviewed_by_name: n.reviewed_by_name,
            reviewed_at: n.reviewed_at,
            is_mine: n.authored_by_me === true,
          }));
    }
    notesBlock = (
      <section aria-labelledby="notes-h" className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4">
        <h2 id="notes-h" className="font-heading text-lg font-semibold text-charcoal-ink">
          Notes for groups
        </h2>
        {listFailed || notesFailed ? (
          <p role="alert" className="text-sm text-red-700">
            {LOAD_FAILED}
          </p>
        ) : !selected ? (
          <p className="text-sm text-charcoal-ink/70">
            No groups are open to choose from yet. Groups appear here once the community is switched on.
          </p>
        ) : (
          <>
            <nav aria-label="Choose a group" className="flex flex-wrap gap-2">
              {choices.map((c) => (
                <Link
                  key={c.id}
                  href={`/clinician/community?group=${c.id}`}
                  aria-current={c.id === selected.id ? "page" : undefined}
                  className={
                    c.id === selected.id
                      ? "rounded-md bg-brand-green/10 px-3 py-1.5 text-sm font-semibold text-brand-green underline"
                      : "rounded-md px-3 py-1.5 text-sm text-charcoal-ink/70 hover:text-charcoal-ink"
                  }
                >
                  {c.name}
                </Link>
              ))}
            </nav>
            <NotesPanel key={selected.id} groupId={selected.id} notes={notes} onPin={pinNoteAction} onReview={reviewPinAction} />
          </>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Community</h1>
        <p className="text-sm text-charcoal-ink/60">Group rules, safety rules and notes for the community groups.</p>
      </div>
      {cmoBlock}
      {notesBlock}
    </div>
  );
}
