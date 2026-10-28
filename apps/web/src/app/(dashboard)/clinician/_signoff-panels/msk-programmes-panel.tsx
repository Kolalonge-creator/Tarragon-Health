import { approveMskProgrammeContentAction, confirmMskEntryListAction } from "../clinical-signoff/msk-programmes-actions";
import { mskProgrammeWaits, type MskProgrammeView } from "@/lib/queries/pending-msk-programmes-signoff";

/**
 * Read and sign the back, neck, knee and hip pain programmes (S96). Shown inline on the sign-off hub. Everything a patient will see is shown
 * here in full: the entry questions with the route each one takes, and every weekly session with its exercises, doses and stop rules.
 * Every one of these is an UNSIGNED DRAFT written by an agent from NICE NG59 and NG226 style guidance (to verify against the source); none
 * has been reviewed by a clinician, and every dose, hold time and number of repeats is PROPOSED. A physiotherapist may review the same rows
 * later: the approval is one function and a changed text is a new version.
 * Signing here switches nothing on. The pain guard stays off until the entry list is confirmed, clinical cover and the outcome thresholds are
 * attested on the go-live page, and the guard is switched there.
 */
const ROUTE_WORDS: Record<string, string> = {
  crisis: "go to hospital now",
  same_day_clinician: "care team task, same day",
  medical_review_first: "care team review first (within 2 days)",
  education_only: "advice only",
};

function Programme({ p }: { p: MskProgrammeView }) {
  const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
  const contentWaits = p.reviewState !== "approved";
  const listWaits = p.listStatus !== "confirmed";
  return (
    <section className="space-y-3 rounded-lg border border-charcoal-ink/15 p-4">
      <h3 className="font-medium text-charcoal-ink">{p.title}</h3>
      <p className="text-sm text-charcoal-ink/80">
        Content version {p.version}: {p.reviewState}. Entry list version {p.listVersion ?? "none"}: {p.listStatus ?? "none"}.
      </p>

      {p.notPhysiotherapistReviewed && (
        <p className="rounded-md border border-amber-300 p-2 text-sm" data-testid="not-physio-reviewed">
          Marker (internal, never shown to patients): <span className="font-medium">not physiotherapist-reviewed</span>. You approve the exercise doses and progressions
          alone. The marker stays on this version so it can be re-reviewed when a physiotherapist is hired; it is cleared only by recording a physiotherapist review.
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-medium">Entry questions and what each one does ({p.questions.length})</summary>
        <ol className="ml-5 mt-2 list-decimal space-y-1 text-sm">
          {p.questions.map((q) => (
            <li key={q.code}>
              {q.question} <span className="text-charcoal-ink/70">({ROUTE_WORDS[q.route] ?? q.route}{q.unverified ? ", local addition not yet confirmed" : ""})</span>
            </li>
          ))}
        </ol>
      </details>

      <details>
        <summary className="cursor-pointer text-sm font-medium">All {p.sessions.length} weekly sessions and their exercises</summary>
        <div className="mt-2 space-y-4">
          {p.sessions.map((s) => (
            <div key={s.ordinal} className="space-y-1 text-sm">
              <p className="font-medium">{s.title}</p>
              <p className="whitespace-pre-line">{s.body}</p>
              <ul className="ml-5 list-disc space-y-1">
                {s.exercises.map((e) => (
                  <li key={e.key}>
                    <span className="font-medium">{e.name}</span> ({e.intensity}). Dose: {e.dose} Steps: {e.steps.join(" ")} Easier: {e.easier} Harder: {e.harder} {e.stopIf}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>

      {contentWaits && (
        <form action={approveMskProgrammeContentAction} className="space-y-2">
          <input type="hidden" name="code" value={p.code} />
          <input type="hidden" name="version" value={p.version} />
          <label className="flex items-start gap-2 text-sm text-charcoal-ink">
            <input type="checkbox" name="understood" className="mt-1" required />
            <span>I have read all of this programme&apos;s content above and I approve version {p.version}. An approved version cannot be changed; a change is a new version.</span>
          </label>
          <button type="submit" className={btn}>Approve content version {p.version}</button>
        </form>
      )}
      {listWaits && p.listVersion !== null && (
        <form action={confirmMskEntryListAction} className="space-y-2">
          <input type="hidden" name="code" value={p.code} />
          <input type="hidden" name="version" value={p.listVersion} />
          <label className="flex items-start gap-2 text-sm text-charcoal-ink">
            <input type="checkbox" name="understood" className="mt-1" required />
            <span>I have read every entry question and its route above and I confirm list version {p.listVersion}. It is the list the programme applies at entry, before every session and on &quot;my pain got worse&quot;.</span>
          </label>
          <button type="submit" className={btn}>Confirm entry list version {p.listVersion}</button>
        </form>
      )}
      {!contentWaits && !listWaits && <p className="text-sm">Content approved and entry list confirmed.</p>}
    </section>
  );
}

export function MskProgrammesPanel({ programmes }: { programmes: MskProgrammeView[] }) {
  const waiting = programmes.filter(mskProgrammeWaits);
  if (waiting.length === 0) return null;
  return (
    <div className="space-y-6">
      <p className="text-sm text-charcoal-ink/80">
        Draft self-help programmes for back, neck, knee and hip pain: eight weekly sessions each, exercises shown as steps and line drawings, a red-flag entry
        screen, a &quot;my pain got worse&quot; check, and the free PEG pain questions plus a function goal at weeks 1, 4 and 8. Approving and confirming switch nothing on.
      </p>
      {waiting.map((p) => <Programme key={p.code} p={p} />)}
    </div>
  );
}
