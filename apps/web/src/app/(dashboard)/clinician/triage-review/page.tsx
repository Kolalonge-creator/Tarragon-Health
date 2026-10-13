import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { allowedAgreements, parseReviewList, type Agreement } from "@/lib/triage-accuracy/report";
import { recordTriageReviewAction } from "./actions";

export const metadata = { title: "Review automatic grades" };
export const dynamic = "force-dynamic";

const LABEL: Record<Agreement, string> = {
  right: "The grade was right",
  should_have_been_higher: "It should have been higher",
  should_have_been_lower: "It should have been lower",
};
const NOTES: Record<string, string> = {
  saved: "Saved. Thank you.",
  invalid: "Not saved. Choose one answer.",
  refused: "Not saved. You can only review a task you completed, once.",
  off: "Reviews are not switched on yet.",
};

/**
 * After finishing a task that came from an automatic triage grade, say whether the grade was right (S38e, Module 22.4). Optional, and it never
 * holds up a task. It shows no patient name: only the kind of task, when it was completed and the grade the system gave. There is no free-text
 * box on purpose, so nothing that identifies a patient can be typed in.
 */
export default async function TriageReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "clinician") redirect("/clinician");
  const sp = await searchParams;
  const note = typeof sp.m === "string" ? NOTES[sp.m] : undefined;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clinician_triage_review_list");
  const list = error ? null : parseReviewList(data);

  return (
    <div className="space-y-6">
      <PageHeader title="Review automatic grades" backTo={{ href: "/clinician", label: "Dashboard" }}
        description="Tasks you completed in the last 14 days that began with an automatic grade. Tell us whether the grade was right. This helps the clinical lead check the checker. It is optional and never about you." />
      {note ? <p role="status">{note}</p> : null}
      {!list ? (
        <p role="alert">The list could not be read. Please refresh.</p>
      ) : list.status === "not_available" ? (
        <p>Grade reviews are not switched on yet. The clinical lead will turn them on once they are approved.</p>
      ) : list.rows.length === 0 ? (
        <p>Nothing to review right now.</p>
      ) : (
        <ul className="space-y-3">
          {list.rows.map((r) => (
            <li key={r.task_id} className="space-y-2 rounded border p-3">
              <p className="text-sm">
                {r.task_type.replace(/_/g, " ")}, completed {r.completed_at.slice(0, 10)}. The system graded it <strong>{r.graded_as}</strong>.
              </p>
              <form action={recordTriageReviewAction} className="grid gap-2 sm:max-w-md">
                <input type="hidden" name="taskId" value={r.task_id} />
                <fieldset className="space-y-1">
                  <legend className="text-sm">Was the grade right?</legend>
                  {allowedAgreements(r.graded_as).map((a) => (
                    <label key={a} className="flex min-h-11 items-center gap-2">
                      <input type="radio" name="agreement" value={a} required /> {LABEL[a]}
                    </label>
                  ))}
                </fieldset>
                <button type="submit" className="min-h-11 rounded border px-4">Save</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
