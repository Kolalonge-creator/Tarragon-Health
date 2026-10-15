import Link from "next/link";
import { CommunityNav, LoadFailed } from "../community-nav";
import type { Rule } from "@/lib/community/model";
import { loadRules, loadRuleSets, requireAdmin } from "../load";
import { ActivateForm, AddRuleForm, CLASS_LABEL, DeleteRuleForm, HostsForm, NewDraftForm } from "../rule-forms";
import { card, h1, h2, link, notice } from "../ui";

export const metadata = { title: "Community filter rules" };
export const dynamic = "force-dynamic";

const STATUS = { draft: "Draft", active: "Live", retired: "Retired" } as const;
const ACTION = { block: "Blocks the post", hold: "Holds it for a moderator", safety: "Safety hand-off" } as const;

export default async function CommunityRulesPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  await requireAdmin();
  const { v } = await searchParams;
  const sets = await loadRuleSets();
  const list = sets.ok ? sets.data.rule_sets : [];
  const wanted = Number(v);
  const current = list.find((s) => s.version === wanted) ?? list.find((s) => s.status === "active") ?? list[0];
  const live = list.find((s) => s.status === "active");
  const rules = current ? await loadRules(current.version) : null;
  const byClass = new Map<string, Rule[]>();
  if (rules?.ok) for (const r of rules.data.rules) byClass.set(r.class, [...(byClass.get(r.class) ?? []), r]);

  return (
    <div className="space-y-8">
      <h1 className={h1}>Community filter rules</h1>
      <CommunityNav />
      <p className={`${notice} border-amber-300 bg-amber-50 text-amber-900`}>
        Until the Chief Medical Officer has signed a live version with emergency and self-harm rules, the community cannot be switched on.
        {live ? ` The live version is ${live.version}${live.safety_rule_count > 0 ? ", and it has safety rules." : ", and it has no safety rules yet."}` : " There is no live version yet."}
      </p>
      <p className="max-w-3xl text-sm text-charcoal-ink/70">
        The filter checks every post before it is shown. A version keeps its rules once it is live; to change them, start a new draft, edit it, and make it live. Emergency and self-harm rules are written by the Chief Medical Officer in the clinician area.
      </p>
      {!sets.ok ? (
        <LoadFailed what="The rule sets" />
      ) : (
        <>
          <nav aria-label="Versions">
            <ul className="flex flex-wrap gap-2 text-sm">
              {list.map((s) => (
                <li key={s.version}>
                  <Link href={`/admin/community/rules?v=${s.version}`} aria-current={current?.version === s.version ? "page" : undefined} className={`${link} ${current?.version === s.version ? "font-bold" : ""}`}>
                    Version {s.version} ({STATUS[s.status]}, {s.rule_count} rules, {s.safety_rule_count} safety)
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <NewDraftForm fromVersion={current?.version ?? null} />

          {current && (
            <section aria-labelledby="version" className="space-y-6">
              <h2 id="version" className={h2}>Version {current.version} ({STATUS[current.status]})</h2>
              {!rules?.ok ? (
                <LoadFailed what="The rules" />
              ) : (
                <div className="space-y-4">
                  {[...byClass.entries()].map(([cls, rs]) => (
                    <div key={cls} className={card}>
                      <h3 className="font-semibold text-charcoal-ink">{CLASS_LABEL[cls] ?? cls}</h3>
                      <ul className="mt-2 divide-y divide-charcoal-ink/10 text-sm">
                        {rs.map((r) => (
                          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                            <span>
                              <code className="break-all font-mono text-xs">{r.pattern}</code>{" "}
                              <span className="text-charcoal-ink/70">({r.kind === "detector" ? "built-in detector" : "pattern"}. {ACTION[r.action]})</span>
                            </span>
                            {current.status === "draft" && r.action !== "safety" && <DeleteRuleForm version={current.version} ruleId={r.id} />}
                            {current.status === "draft" && r.action === "safety" && <span className="text-xs text-charcoal-ink/70">Only the Chief Medical Officer can remove this.</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {byClass.size === 0 && <p className="text-sm">This version has no rules yet.</p>}
                </div>
              )}

              <div className={card}>
                <h3 className="font-semibold text-charcoal-ink">Allowed link hostnames</h3>
                {current.status === "draft" ? (
                  <div className="mt-2 max-w-xl"><HostsForm version={current.version} hosts={current.params.allowed_hosts ?? []} /></div>
                ) : (
                  <p className="mt-2 text-sm">{(current.params.allowed_hosts ?? []).length ? (current.params.allowed_hosts ?? []).join(", ") : "None. Every link is blocked."}</p>
                )}
              </div>

              {current.status === "draft" ? (
                <>
                  <div className={card}>
                    <h3 className="font-semibold text-charcoal-ink">Add a rule</h3>
                    <div className="mt-2 max-w-xl"><AddRuleForm version={current.version} /></div>
                  </div>
                  <div className={card}>
                    <h3 className="font-semibold text-charcoal-ink">Make this version live</h3>
                    <div className="mt-2 max-w-xl"><ActivateForm version={current.version} /></div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-charcoal-ink/70">Only a draft can be changed. Start a new draft from this version to make changes.</p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
