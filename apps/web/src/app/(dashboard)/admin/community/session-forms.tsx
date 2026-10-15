"use client";

import { ActionForm } from "./action-form";
import { cancelQaAction, createQaAction } from "./ops-actions";
import { QA_DOCTORS_MAX, QA_GROUPS_MAX, QA_INTRO_MAX, QA_MAX_HOURS, QA_TITLE_MAX } from "./ops-schemas";
import { btnDanger, field, help, label } from "./ui";

export type DoctorOption = { id: string; full_name: string; tier: "senior_medical_officer" | "chief_medical_officer" };
const TIER = { senior_medical_officer: "senior medical officer", chief_medical_officer: "Chief Medical Officer" } as const;

/** Creates a one-off doctor question session in one or more groups. Times are Africa/Lagos. */
export function CreateQaForm({ doctors, groups }: { doctors: DoctorOption[] | null; groups: Array<{ id: string; name: string }> }) {
  const haveDoctors = doctors !== null && doctors.length > 0;
  return (
    <ActionForm action={createQaAction} submitLabel="Create the session" pendingLabel="Creating..." confirm="Create this question session? It cannot be edited afterwards, only cancelled.">
      <div>
        <label htmlFor="qa-title" className={label}>Title</label>
        <input id="qa-title" name="title" required minLength={3} maxLength={QA_TITLE_MAX} className={field} />
      </div>
      <div>
        <label htmlFor="qa-intro" className={label}>Introduction (optional)</label>
        <textarea id="qa-intro" name="intro" rows={3} maxLength={QA_INTRO_MAX} aria-describedby="qa-intro-help" className={field} />
        <p id="qa-intro-help" className={help}>Up to {QA_INTRO_MAX} characters, shown to members at the top of the session.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="qa-open" className={label}>Opens (Lagos time)</label>
          <input id="qa-open" name="opens_at" type="datetime-local" required className={field} />
        </div>
        <div>
          <label htmlFor="qa-close" className={label}>Closes (Lagos time)</label>
          <input id="qa-close" name="closes_at" type="datetime-local" required aria-describedby="qa-win-help" className={field} />
        </div>
      </div>
      <p id="qa-win-help" className={help}>A session can run for up to {QA_MAX_HOURS} hours. Doctors can still answer for 60 minutes after it closes.</p>

      <fieldset>
        <legend className={label}>Doctors who will answer</legend>
        {haveDoctors ? (
          <div className="mt-1 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-charcoal-ink/15 p-2">
            {doctors.map((d) => (
              <div key={d.id} className="flex items-start gap-2 text-sm">
                <input id={`qa-doc-${d.id}`} type="checkbox" name="doctor_ids" value={d.id} className="mt-1" />
                <label htmlFor={`qa-doc-${d.id}`}>{d.full_name} ({TIER[d.tier]})</label>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-sm text-charcoal-ink">The list of doctors could not be loaded, so paste profile ids below.</p>
        )}
        <label htmlFor="qa-doc-paste" className={`${label} mt-2`}>{haveDoctors ? "Or paste doctor profile ids" : "Doctor profile ids"}</label>
        <textarea id="qa-doc-paste" name="doctor_ids_pasted" rows={2} autoComplete="off" aria-describedby="qa-doc-help" className={field} />
        <p id="qa-doc-help" className={help}>
          Pick 1 to {QA_DOCTORS_MAX} active senior medical officers or the Chief Medical Officer. Separate pasted ids with spaces, commas or new lines. Answers show the doctor&apos;s real name.
        </p>
      </fieldset>

      <fieldset>
        <legend className={label}>Groups where the session runs</legend>
        {groups.length === 0 ? (
          <p className="mt-1 text-sm text-charcoal-ink">There are no live groups to choose from yet.</p>
        ) : (
          <div className="mt-1 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-charcoal-ink/15 p-2">
            {groups.map((g) => (
              <div key={g.id} className="flex items-start gap-2 text-sm">
                <input id={`qa-grp-${g.id}`} type="checkbox" name="group_ids" value={g.id} className="mt-1" />
                <label htmlFor={`qa-grp-${g.id}`}>{g.name}</label>
              </div>
            ))}
          </div>
        )}
        <p className={help}>Pick 1 to {QA_GROUPS_MAX} live groups.</p>
      </fieldset>
    </ActionForm>
  );
}

export function CancelQaForm({ seriesId, title }: { seriesId: string; title: string }) {
  return (
    <ActionForm
      action={cancelQaAction}
      submitLabel="Cancel this session"
      pendingLabel="Cancelling..."
      submitClassName={btnDanger}
      className="space-y-2"
      confirm={`Cancel "${title}"? Doctors will no longer be able to answer.`}
    >
      <input type="hidden" name="series_id" value={seriesId} />
    </ActionForm>
  );
}
