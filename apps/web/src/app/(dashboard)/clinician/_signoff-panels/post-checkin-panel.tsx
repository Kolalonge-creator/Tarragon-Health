import { signPostCheckinConfigAction } from "../clinical-signoff/post-checkin-actions";
import type { PostCheckinRulesView } from "@/lib/queries/pending-post-checkin-signoff";

const ROUTE_WORDS: Record<string, string> = {
  ok: "nothing further",
  concern_alert: "raises a clinician alert",
  clinician_task: "creates a task for the clinician on the visit",
  clarify_task: "creates a task to clarify, for the clinician on the visit",
};

/**
 * Sign the post-consultation check-in configuration. Shown inline on the sign-off hub. Every question, answer and number is read from the draft
 * being signed, so the words and the values cannot differ. Signing alone does nothing: an admin must also switch the check-in guard on.
 */
export function PostCheckinPanel({ version, rules }: { version: number | null; rules: PostCheckinRulesView | null }) {
  if (version === null) return null;
  const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
  return (
    <form action={signPostCheckinConfigAction} className="space-y-3">
      <input type="hidden" name="version" value={version} />
      <h3 className="font-medium text-charcoal-ink">Check-ins after a consultation, version {version}</h3>
      {rules ? (
        <>
          <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
            <li>After a completed consultation the patient gets a short check-in at {rules.offsets.map((o) => `${o.afterHours} hours (${o.code})`).join(" and ")}.</li>
            <li>
              If it is not answered, they get {rules.maxNudges} gentle reminder {rules.nudgeAfterHours} hours after it opens, and it closes as not answered after {rules.expireAfterHours} hours. Silence raises no alert; the clinician on the visit gets one low-priority task.
            </li>
            <li>Anything the patient types that matches the danger-phrase list opens the emergency path at once. A concerning answer raises one clinician alert at level {rules.concernAlertLevel}.</li>
          </ul>
          {rules.questions.map((q) => (
            <div key={q.text} className="text-sm text-charcoal-ink">
              <p className="font-medium">{q.text}</p>
              <ul className="list-disc pl-5 text-charcoal-ink/80">
                {q.options.map((o) => (
                  <li key={o.label}>
                    {o.label}: {ROUTE_WORDS[o.route] ?? o.route}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      ) : (
        <p className="text-sm text-charcoal-ink/80">The questions in this draft could not be read, so they are not shown here. Do not sign until they can be.</p>
      )}
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1" required disabled={!rules} />
        <span>I have read the questions, what each answer does and the timing, and I sign check-in configuration version {version} for use. An admin must still switch the check-in guard on before any check-in is sent.</span>
      </label>
      <button type="submit" className={btn} disabled={!rules}>Sign check-in configuration version {version}</button>
    </form>
  );
}
