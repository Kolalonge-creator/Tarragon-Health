import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { canOfferApproval, ruleSetRowSchema, summariseRules } from "@/lib/queue/rule-set-review";
import { TASK_TYPE_LABEL } from "@/lib/queue/task-types";
import { approveRuleSetAction } from "./actions";

export const metadata = { title: "Blood pressure triage rules" };
export const dynamic = "force-dynamic";

type Reader = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string | boolean): PromiseLike<{ data: unknown; error: { message: string } | null }> & {
        order(column: string, o: { ascending: boolean }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
};

const OUTCOME_STYLE: Record<string, string> = {
  red: "bg-red-100 text-red-800",
  amber: "bg-amber-100 text-amber-900",
  green: "bg-emerald-100 text-emerald-800",
  "repeat reading": "bg-sky-100 text-sky-800",
  "asks about symptoms": "bg-violet-100 text-violet-800",
};

function dueText(minutes: number | null): string {
  if (minutes === null) return "";
  if (minutes % 1440 === 0) return ` within ${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return ` within ${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return ` within ${minutes} minutes`;
}

export default async function TriageRulesPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const sp = await searchParams;
  const supabase = (await createClient()) as unknown as Reader;

  const sets = await supabase.from("triage_rule_sets").select("id, code, version, status, approved_by, approved_at, note, rules").eq("code", "bp_care_triage").order("version", { ascending: false });
  const rows = sets.error ? null : z.array(ruleSetRowSchema).safeParse(sets.data);
  const unconfirmed = await supabase.from("task_types").select("code, needs_confirmation, confirmed_at").eq("is_active", true);
  const unconfirmedRows = unconfirmed.error ? null : z.array(z.object({ code: z.string(), needs_confirmation: z.boolean(), confirmed_at: z.string().nullable() })).safeParse(unconfirmed.data);
  const waiting = unconfirmedRows?.success ? unconfirmedRows.data.filter((t) => t.needs_confirmation && !t.confirmed_at).map((t) => t.code) : null;

  const latest = rows?.success ? rows.data[0] ?? null : null;
  const approved = rows?.success ? rows.data.find((r) => r.status === "approved") ?? null : null;
  const shown = latest ? summariseRules(latest.rules) : null;
  const failed = !rows || !rows.success || waiting === null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Blood pressure triage rules"
        description="The rules that grade a blood pressure reading as red, amber or green, and what each grade does. Until you sign, results are graded but shadow only: nothing new is paged or opened as a clinical task from them. Signing is your clinical decision. It is not done for you."
      />
      {sp.done && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{sp.done}</p>}
      {sp.error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{sp.error}</p>}

      {failed || !latest ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          The rule set could not be loaded just now. Nothing has been changed. Try again in a moment.
        </p>
      ) : (
        <>
          <section className="rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Version {latest.version}</h2>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${latest.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                {latest.status === "draft" ? "Draft, not signed" : latest.status === "approved" ? "Signed" : "Retired"}
              </span>
            </div>
            {latest.note && <p className="mt-1 text-sm text-charcoal-ink/70">{latest.note}</p>}
            {approved?.approved_at && <p className="mt-1 text-xs text-charcoal-ink/60">Signed on {new Date(approved.approved_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}.</p>}
          </section>

          <section aria-labelledby="rules-h" className="space-y-2">
            <h2 id="rules-h" className="font-heading text-base font-semibold text-charcoal-ink">What the rules do</h2>
            {shown === null ? (
              <p className="text-sm text-charcoal-ink/70">The rule list could not be read in this format. Do not sign what you cannot read.</p>
            ) : (
              <ul className="grid gap-2">
                {shown.map((r) => (
                  <li key={r.id} className="rounded-lg border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-charcoal-ink/60">{r.id}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${OUTCOME_STYLE[r.outcome] ?? ""}`}>{r.outcome}</span>
                      {r.pagesOnCall && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">pages the on-call clinician</span>}
                    </div>
                    <p className="mt-1 text-charcoal-ink">{r.description}</p>
                    {r.tasks.map((t, i) => (
                      <p key={i} className="mt-0.5 text-xs text-charcoal-ink/70">Opens a task: {TASK_TYPE_LABEL[t.task] ?? t.task.replace(/_/g, " ")}{dueText(t.dueMinutes)}</p>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {latest.status === "draft" && (
            <section aria-labelledby="sign-h" className="space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card">
              <h2 id="sign-h" className="font-heading text-base font-semibold text-charcoal-ink">Sign this rule set</h2>
              <p className="text-sm text-charcoal-ink/70">
                Signing records your name and the time, ends shadow mode, and from then on a graded result opens clinical tasks for your team as set out above.
                A later version replaces this one; this one is then retired, never edited.
              </p>
              {waiting && waiting.length > 0 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  One step first: confirm {waiting.map((c) => TASK_TYPE_LABEL[c] ?? c).join(", ")} on the{" "}
                  <a className="font-medium underline" href="/clinician/task-types">Task types and priorities</a> page. You cannot sign until it is confirmed.
                </p>
              ) : null}
              {canOfferApproval(latest.status, waiting?.length ?? 1) && (
                <form action={approveRuleSetAction} className="space-y-3">
                  <input type="hidden" name="id" value={latest.id} />
                  <label className="flex items-start gap-2 text-sm text-charcoal-ink">
                    <input type="checkbox" name="understood" className="mt-1" required />
                    <span>I have read every rule above and I approve this rule set for use with patients.</span>
                  </label>
                  <label className="block text-sm text-charcoal-ink">
                    Note (optional)
                    <textarea name="note" rows={2} maxLength={500} className="mt-1 w-full rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm" />
                  </label>
                  <label className="block text-sm text-charcoal-ink">
                    Type SIGN to confirm
                    <input name="typed" autoComplete="off" required className="mt-1 w-40 rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm uppercase" />
                  </label>
                  <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
                    Sign rule set version {latest.version}
                  </button>
                </form>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
