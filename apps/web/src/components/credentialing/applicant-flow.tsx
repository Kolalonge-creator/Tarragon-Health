import Link from "next/link";
import {
  beginTest,
  completeTrainingModule,
  saveApplicationDetails,
  startApplication,
  submitApplication,
} from "@/lib/credentialing/applicant-actions";
import { APPLICATION_STATE_LABEL, DOCUMENT_KINDS, formatDate, missingLabel } from "@/lib/credentialing/labels";
import type { MyApplication } from "@/lib/credentialing/schemas";
import { DocumentUploadForm } from "./document-upload-form";
import { Field, fieldClass, Hidden, Muted, Section, StateBadge, SubmitButton } from "./shared";

const HOME = "/account/clinician";

export function StartApplication({ canApply }: { canApply: boolean }) {
  return (
    <Section
      title="Join as a clinician"
      hint="Apply to work with Tarragon Health's care team. We check your MDCN licence, qualifications, identity and referees, then you complete a short training and test."
    >
      <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
        <li>Your current-year MDCN practising licence and a screenshot of your MDCN portal page</li>
        <li>Your graduation licence or degree certificate and your NYSC certificate</li>
        <li>A government ID and your CV</li>
        <li>Your own professional indemnity certificate if you will work as a freelance clinician</li>
        <li>Two referees we can reach through their institution</li>
      </ul>
      {canApply ? (
        <form action={startApplication}>
          <Hidden name="returnTo" value={HOME} />
          <SubmitButton>Start my application</SubmitButton>
        </form>
      ) : (
        <Muted>Only a personal Tarragon account can apply. Sign in with the account you want to use as a clinician.</Muted>
      )}
    </Section>
  );
}

function Timeline({ app }: { app: MyApplication }) {
  return (
    <Section title="Where you are">
      <ol className="space-y-1 text-sm">
        {app.transitions.map((t, i) => (
          <li key={`${t.to_state}-${i}`} className="flex justify-between gap-3">
            <span>{APPLICATION_STATE_LABEL[t.to_state] ?? t.to_state}</span>
            <span className="text-charcoal-ink/55 dark:text-night-ink/55">{formatDate(t.created_at)}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function DetailsForm({ app }: { app: MyApplication }) {
  const d = app.details;
  const r1 = d.referees[0] ?? {};
  const r2 = d.referees[1] ?? {};
  const conflicts = (d.conflicts_declaration ?? {}) as Record<string, unknown>;
  const expiryDay = d.indemnity_expires_at ? d.indemnity_expires_at.slice(0, 10) : "";
  return (
    <Section title="Your details" hint="Save as you go. You can change anything until you submit.">
      <form action={saveApplicationDetails} className="space-y-5">
        <Hidden name="applicationId" value={app.id} />
        <Hidden name="returnTo" value={HOME} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="MDCN folio number">
            <input name="mdcn_folio" defaultValue={d.mdcn_folio ?? ""} className={fieldClass} required maxLength={40} />
          </Field>
          <Field label="Qualification" hint="For example MBBS or MB BS">
            <input name="qualification" defaultValue={d.qualification ?? ""} className={fieldClass} required maxLength={120} />
          </Field>
          <Field label="Year you graduated">
            <input name="graduation_year" type="number" min={1950} defaultValue={d.graduation_year ?? ""} className={fieldClass} />
          </Field>
          <Field label="Year you finished NYSC">
            <input name="nysc_year" type="number" min={1950} defaultValue={d.nysc_year ?? ""} className={fieldClass} />
          </Field>
          <Field label="Years of practice after house job" hint="We need at least the minimum set by our clinical team.">
            <input name="years_since_house_job" type="number" step="0.5" min={0} defaultValue={d.years_since_house_job ?? ""} className={fieldClass} required />
          </Field>
          <Field label="Specialties" hint="Separate with commas">
            <input name="specialties" defaultValue={d.specialties.join(", ")} className={fieldClass} />
          </Field>
          <Field label="Languages you speak with patients" hint="Separate with commas, for example English, Yoruba, Pidgin">
            <input name="languages" defaultValue={d.languages.join(", ")} className={fieldClass} required />
          </Field>
        </div>

        {([1, 2] as const).map((n) => {
          const r = n === 1 ? r1 : r2;
          return (
            <fieldset key={n} className="space-y-3 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
              <legend className="px-1 text-sm font-medium">Referee {n}</legend>
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                Someone who has supervised your clinical work. We will reach them through their institution, so give the hospital or clinic they work at.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <input name={`referee${n}_name`} defaultValue={r.name ?? ""} className={fieldClass} required />
                </Field>
                <Field label="Hospital or institution">
                  <input name={`referee${n}_institution`} defaultValue={r.institution ?? ""} className={fieldClass} required />
                </Field>
                <Field label="Phone">
                  <input name={`referee${n}_phone`} defaultValue={r.phone ?? ""} className={fieldClass} />
                </Field>
                <Field label="Email">
                  <input name={`referee${n}_email`} type="email" defaultValue={r.email ?? ""} className={fieldClass} />
                </Field>
                <Field label="How they know your work">
                  <input name={`referee${n}_relationship`} defaultValue={r.relationship ?? ""} className={fieldClass} />
                </Field>
              </div>
            </fieldset>
          );
        })}

        {app.employment_type === "contracted" ? (
          <fieldset className="space-y-3 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
            <legend className="px-1 text-sm font-medium">Your professional indemnity cover</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Insurer">
                <input name="indemnity_insurer" defaultValue={d.indemnity_insurer ?? ""} className={fieldClass} />
              </Field>
              <Field label="Policy number">
                <input name="indemnity_policy_number" defaultValue={d.indemnity_policy_number ?? ""} className={fieldClass} />
              </Field>
              <Field label="Cover ends on">
                <input name="indemnity_expires_on" type="date" defaultValue={expiryDay} className={fieldClass} />
              </Field>
            </div>
          </fieldset>
        ) : null}

        <fieldset className="space-y-2 rounded-md border border-charcoal-ink/10 p-3 text-sm dark:border-night-ink/15">
          <legend className="px-1 text-sm font-medium">Conflicts of interest</legend>
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">Tick anything that applies to you. Tick none if none applies, then confirm below.</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="conflict_pharmacy" defaultChecked={conflicts.pharmacy === true} /> I have a financial interest in a pharmacy
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="conflict_lab" defaultChecked={conflicts.lab === true} /> I have a financial interest in a laboratory
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="conflict_hmo" defaultChecked={conflicts.hmo === true} /> I have a financial interest in an HMO or insurer
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="conflict_referee" defaultChecked={conflicts.referee_relationship === true} /> One of my referees is a relative or business partner
          </label>
          <Field label="Anything else we should know">
            <input name="conflict_notes" defaultValue={typeof conflicts.notes === "string" ? conflicts.notes : ""} className={fieldClass} maxLength={500} />
          </Field>
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" name="conflicts_confirm" defaultChecked={app.details.conflicts_declaration !== null} required /> I confirm this declaration is true
          </label>
        </fieldset>
        <SubmitButton>Save my details</SubmitButton>
      </form>
    </Section>
  );
}

function DocumentsSection({ app, editable }: { app: MyApplication; editable: boolean }) {
  const byKind = new Map(app.documents.map((d) => [d.kind, d]));
  return (
    <Section
      title="Your documents"
      hint="PDF, JPG, PNG or WebP, up to 8 MB each. A clear photo taken in good light is fine. Uploading again replaces the earlier file."
    >
      <ul className="space-y-4">
        {DOCUMENT_KINDS.filter((k) => (k.forContractedOnly ? app.employment_type === "contracted" : true)).map((k) => {
          const doc = byKind.get(k.kind);
          return (
            <li key={k.kind} className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {k.label}
                    {k.optional ? <span className="ml-1 text-xs font-normal text-charcoal-ink/50">(optional)</span> : null}
                  </p>
                  <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{k.hint}</p>
                </div>
                <span className="text-xs">
                  {doc ? (
                    <>
                      Uploaded {formatDate(doc.created_at)}
                      {doc.verified ? " and checked" : ""}
                    </>
                  ) : (
                    "Not uploaded yet"
                  )}
                </span>
              </div>
              {editable ? (
                <DocumentUploadForm
                  kind={k.kind}
                  applicationId={app.id}
                  returnTo={HOME}
                  buttonLabel={doc ? "Replace" : "Upload"}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function SubmitSection({ app }: { app: MyApplication }) {
  return (
    <Section title="Send it for checking">
      {app.missing.length > 0 ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium">Still needed before you can submit:</p>
          <ul className="list-disc pl-5">
            {app.missing.map((m) => (
              <li key={m}>{missingLabel(m)}</li>
            ))}
          </ul>
          <Muted>Save your details after changing them so this list updates.</Muted>
        </div>
      ) : (
        <Muted>Everything we need is here.</Muted>
      )}
      <form action={submitApplication}>
        <Hidden name="applicationId" value={app.id} />
        <Hidden name="returnTo" value={HOME} />
        <SubmitButton>Submit my application</SubmitButton>
      </form>
    </Section>
  );
}

function TrainingSection({ app }: { app: MyApplication }) {
  const t = app.test;
  const allDone = app.modules.every((m) => m.completed);
  const exhausted = t.attempts_used >= t.attempts_allowed;
  return (
    <>
      <Section title="Training" hint="Read each module, then mark it as done. The test opens when every module is done.">
        {app.modules.length === 0 ? (
          <Muted>We are still preparing the training. We will let you know when it is ready.</Muted>
        ) : (
          <ul className="space-y-4">
            {app.modules.map((m) => (
              <li key={m.id} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">{m.title}</p>
                  <span className="text-xs text-charcoal-ink/55">{m.minutes} min</span>
                </div>
                {m.summary ? <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{m.summary}</p> : null}
                <div className="space-y-2 text-sm">
                  {m.content.map((c, i) => (
                    <p key={i}>{c.body}</p>
                  ))}
                </div>
                {m.completed ? (
                  <p className="text-sm font-medium text-green-700 dark:text-green-300">Done</p>
                ) : (
                  <form action={completeTrainingModule}>
                    <Hidden name="applicationId" value={app.id} />
                    <Hidden name="moduleId" value={m.id} />
                    <Hidden name="returnTo" value={HOME} />
                    <SubmitButton tone="outline">Mark as done</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Test" hint="Scenario questions. You need the pass mark, and every safety-critical scenario must be right.">
        <p className="text-sm">
          Attempts used: {t.attempts_used} of {t.attempts_allowed}
        </p>
        {exhausted ? (
          <Muted>You have used all your attempts. Our team has been told and will be in touch.</Muted>
        ) : t.open_attempt_id ? (
          <Link href={`${HOME}/test`} className="text-sm font-medium text-brand-green underline">
            Continue the test
          </Link>
        ) : (
          <form action={beginTest} className="space-y-2">
            <Hidden name="applicationId" value={app.id} />
            <Hidden name="returnTo" value={HOME} />
            {t.next_allowed_at ? <Muted>You can try again after {formatDate(t.next_allowed_at)}.</Muted> : null}
            <SubmitButton>{allDone ? "Start the test" : "Start the test (finish the training first)"}</SubmitButton>
          </form>
        )}
      </Section>
    </>
  );
}

export function ApplicantFlow({ app }: { app: MyApplication }) {
  const state = app.state;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Your application</h2>
        <StateBadge state={state} />
      </div>

      {state === "started" ? (
        <>
          <DetailsForm app={app} />
          <DocumentsSection app={app} editable />
          <SubmitSection app={app} />
        </>
      ) : null}

      {state === "documents_submitted" || state === "checks_in_progress" ? (
        <>
          <Section title="We are checking your application" hint="Our team is checking your licence, qualifications, identity and referees. You do not need to do anything. If we need a clearer document we will tell you.">
            <Muted>You can replace a document below if we asked you to.</Muted>
          </Section>
          <DocumentsSection app={app} editable />
        </>
      ) : null}

      {state === "training" ? <TrainingSection app={app} /> : null}

      {state === "test_passed" ? (
        <Section title="You passed the test" hint="Our team will review your application and let you know." >
          <Muted>Nothing more to do for now.</Muted>
        </Section>
      ) : null}

      {state === "approved_tier1" ? (
        <Section title="You are approved" hint="Our team will switch you on once your first-day setup is complete. You will get a message when it is done.">
          <Muted>Nothing more to do for now.</Muted>
        </Section>
      ) : null}

      {state === "active" ? (
        <Section title="You are active">
          <Link href="/clinician" className="text-sm font-medium text-brand-green underline">
            Go to your clinician dashboard
          </Link>
        </Section>
      ) : null}

      {state === "rejected" ? (
        <Section title="Your application was not approved" hint="Our team can tell you more. You can apply again later.">
          <Muted>If you think we got something wrong, reply to the email we sent you.</Muted>
        </Section>
      ) : null}

      {state === "offboarded" ? (
        <Section title="You have left the network">
          <Muted>If this is a mistake, contact our team.</Muted>
        </Section>
      ) : null}

      <Timeline app={app} />
    </div>
  );
}
