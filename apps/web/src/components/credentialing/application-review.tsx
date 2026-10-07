import { getProposedConfig } from "@tarragon/shared";
import { Badge } from "@/components/ui/badge";
import {
  activateClinician,
  approveApplication,
  beginChecks,
  grantCompetency,
  grantTestRetake,
  recordCheck,
  rejectApplication,
  revokeCompetency,
  setEmploymentType,
  setLevel,
  verifyDocument,
} from "@/lib/credentialing/review-actions";
import { APPLICATION_STATE_LABEL, CHECK_KIND_HINT, CHECK_KIND_LABEL, COMPETENCY_CODES, COMPETENCY_LABEL, DOCUMENT_KIND_LABEL, formatDate } from "@/lib/credentialing/labels";
import type { ApplicationDetail } from "@/lib/credentialing/schemas";
import { Field, fieldClass, Hidden, Muted, Section, StateBadge, SubmitButton } from "./shared";

const FLAG_TEXT: Record<string, string> = {
  in_use: "This MDCN folio number belongs to another clinician already working here. Do not pass the licence check until you have found out why.",
  previously_rejected: "This folio number appeared on an application that was rejected. Look at that application before you continue.",
  previously_suspended: "This folio number belongs to a clinician who was suspended or left the network. Look at their record before you continue.",
};

const CLOSED = ["rejected", "offboarded", "active", "suspended"];

const CONFLICT_LABEL: Record<string, string> = {
  pharmacy: "interest in a pharmacy",
  lab: "interest in a laboratory",
  hmo: "interest in an HMO or insurer",
  referee_relationship: "a referee is a relative or business partner",
};

/** The declaration in words: what was ticked, or that the applicant declared none, or that nothing was declared. */
function describeConflicts(declaration: Record<string, unknown> | null): string {
  if (!declaration) return "Not declared";
  const ticked = Object.keys(CONFLICT_LABEL).filter((k) => declaration[k] === true).map((k) => CONFLICT_LABEL[k]);
  const note = typeof declaration.notes === "string" && declaration.notes ? ` Note: ${declaration.notes}` : "";
  return `${ticked.length === 0 ? "Declared none." : `Declared: ${ticked.join("; ")}.`}${note}`;
}

function ReasonForm({ action, hidden, label, tone = "outline", returnTo }: { action: (fd: FormData) => Promise<void>; hidden: Record<string, string>; label: string; tone?: "danger" | "outline"; returnTo: string }) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      {Object.entries(hidden).map(([k, v]) => (
        <Hidden key={k} name={k} value={v} />
      ))}
      <Hidden name="returnTo" value={returnTo} />
      <Field label="Reason (at least 10 characters)">
        <input name="reason" required minLength={10} className={fieldClass} />
      </Field>
      <SubmitButton tone={tone}>{label}</SubmitButton>
    </form>
  );
}

function CheckForm({ detail, kind, returnTo }: { detail: ApplicationDetail; kind: string; returnTo: string }) {
  const isReferee = kind === "referee_1" || kind === "referee_2";
  const refIndex = kind === "referee_1" ? 0 : 1;
  const ref = detail.application.referees[refIndex];
  return (
    <form action={recordCheck} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
      <Hidden name="applicationId" value={detail.application.id} />
      <Hidden name="kind" value={kind} />
      <Hidden name="returnTo" value={returnTo} />
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{CHECK_KIND_HINT[kind]}</p>
      {isReferee && ref ? (
        <p className="text-sm">
          {ref.name}, {ref.institution}. {ref.phone ? `Phone ${ref.phone}. ` : ""}
          {ref.email ? `Email ${ref.email}.` : ""}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {kind === "licence" ? (
          <Field label="Expiry date printed on the licence">
            <input type="date" name="licence_expires_on" className={fieldClass} />
          </Field>
        ) : null}
        {isReferee ? (
          <>
            <Field label="How you reached them">
              <select name="contact_source" className={fieldClass} defaultValue="independent_institution">
                <option value="independent_institution">Through the institution (switchboard or official email)</option>
                <option value="applicant_supplied">Using only the details the applicant gave</option>
              </select>
            </Field>
            <Field label="Contact you used">
              <input name="contact_used" className={fieldClass} maxLength={200} />
            </Field>
            <Field label="Date you spoke">
              <input type="date" name="called_on" className={fieldClass} />
            </Field>
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" name="confirmed_back" /> They confirmed the reference back to us
            </label>
          </>
        ) : null}
        <Field label="Notes">
          <input name="notes" className={fieldClass} maxLength={1000} />
        </Field>
        <Field label="Result">
          <select name="result" className={fieldClass} defaultValue="passed">
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>
        </Field>
      </div>
      <SubmitButton>Record</SubmitButton>
    </form>
  );
}

/**
 * The review page for one application. Shown to an admin (reviewer) and to the Chief Medical Officer; `isCmo`
 * reveals the CMO-only forms. Hiding a button is a courtesy: the database refuses anyone who may not act.
 */
export function ApplicationReview({ detail, returnTo, isCmo }: { detail: ApplicationDetail; returnTo: string; isCmo: boolean }) {
  const a = detail.application;
  const staff = detail.staff;
  const live = !CLOSED.includes(a.state);
  const docs = detail.documents.filter((d) => !d.superseded);
  const checksByKind = new Map(detail.checks.map((c) => [c.kind, c]));
  const maxAttempts = (getProposedConfig("credentialing.rules").value as { test_max_attempts: number }).test_max_attempts;
  const exhausted = detail.attempts.length >= maxAttempts + a.test_extra_attempts;

  return (
    <div className="space-y-5">
      <Section title={detail.applicant.full_name ?? "Applicant"}>
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge state={a.state} />
          <Badge variant="grey">{a.employment_type === "employed" ? "Employed" : "Freelance"}</Badge>
          {a.folio_flag ? <Badge variant="red">Folio flag</Badge> : null}
        </div>
        <p className="text-sm">
          {detail.applicant.email ?? "No email"} · {detail.applicant.phone ?? "No phone"} · MDCN folio {a.mdcn_folio ?? "not given"}
        </p>
        {a.folio_flag ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/15 dark:text-red-200">{FLAG_TEXT[a.folio_flag]}</p> : null}
        {detail.folio_conflict.length > 0 ? (
          <p className="text-sm">
            Same folio on file: {detail.folio_conflict.map((c) => `${c.full_name} (${c.status})`).join(", ")}
          </p>
        ) : null}
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-charcoal-ink/55">Qualification</dt><dd>{a.qualification ?? "Not given"} {a.graduation_year ? `(${a.graduation_year})` : ""}</dd></div>
          <div><dt className="text-xs text-charcoal-ink/55">NYSC</dt><dd>{a.nysc_year ?? "Not given"}</dd></div>
          <div><dt className="text-xs text-charcoal-ink/55">Practice after house job</dt><dd>{a.years_since_house_job ?? "Not given"} years</dd></div>
          <div><dt className="text-xs text-charcoal-ink/55">Languages</dt><dd>{a.languages.join(", ") || "Not given"}</dd></div>
          <div><dt className="text-xs text-charcoal-ink/55">Specialties</dt><dd>{a.specialties.join(", ") || "None given"}</dd></div>
          {a.employment_type === "contracted" ? (
            <div><dt className="text-xs text-charcoal-ink/55">Indemnity</dt><dd>{a.indemnity_insurer ?? "Not given"}, {a.indemnity_policy_number ?? ""}, ends {formatDate(a.indemnity_expires_at)}</dd></div>
          ) : null}
          <div className="sm:col-span-2"><dt className="text-xs text-charcoal-ink/55">Conflicts of interest declared</dt><dd>{describeConflicts(a.conflicts_declaration)}</dd></div>
        </dl>
        {live ? (
          <form action={setEmploymentType} className="flex flex-wrap items-end gap-2">
            <Hidden name="applicationId" value={a.id} />
            <Hidden name="returnTo" value={returnTo} />
            <Field label="Employment type" hint="Set by the organisation, not the applicant. Freelance clinicians need their own indemnity.">
              <select name="employment_type" defaultValue={a.employment_type} className={fieldClass}>
                <option value="contracted">Freelance</option>
                <option value="employed">Employed</option>
              </select>
            </Field>
            <SubmitButton tone="outline">Save</SubmitButton>
          </form>
        ) : null}
      </Section>

      <Section title="Documents" hint="Opening a document is logged with your name. Mark one as checked once you have looked at it.">
        {docs.length === 0 ? <Muted>No documents yet.</Muted> : null}
        <ul className="space-y-2 text-sm">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <a href={`/api/credentialing/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-green underline">
                  {DOCUMENT_KIND_LABEL[d.kind] ?? d.kind}
                </a>{" "}
                <span className="text-xs text-charcoal-ink/55">
                  {formatDate(d.created_at)}
                  {d.verified_at ? `, checked by ${d.verified_by_name ?? "a reviewer"} on ${formatDate(d.verified_at)}` : ", not checked yet"}
                </span>
              </span>
              {!d.verified_at ? (
                <form action={verifyDocument}>
                  <Hidden name="documentId" value={d.id} />
                  <Hidden name="returnTo" value={returnTo} />
                  <SubmitButton tone="outline">Mark as checked</SubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      {a.state === "documents_submitted" ? (
        <Section title="Start the checks" hint="Starting creates the six checks below.">
          <form action={beginChecks}>
            <Hidden name="applicationId" value={a.id} />
            <Hidden name="returnTo" value={returnTo} />
            <SubmitButton>Start checks</SubmitButton>
          </form>
        </Section>
      ) : null}

      {detail.checks.length > 0 ? (
        <Section title="Checks" hint="You cannot verify your own application, and the person who verified a check cannot also approve.">
          <div className="space-y-4">
            {Object.keys(CHECK_KIND_LABEL).map((kind) => {
              const c = checksByKind.get(kind);
              if (!c) return null;
              return (
                <div key={kind} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{CHECK_KIND_LABEL[kind]}</p>
                    <Badge variant={c.result === "passed" ? "green" : c.result === "failed" ? "red" : "grey"}>
                      {c.result === "pending" ? "Not done" : c.result === "passed" ? "Passed" : "Failed"}
                    </Badge>
                  </div>
                  {c.performed_at ? (
                    <p className="text-xs text-charcoal-ink/60">
                      {c.performed_by_name ?? "A reviewer"} on {formatDate(c.performed_at)}
                      {c.notes ? `: ${c.notes}` : ""}
                    </p>
                  ) : null}
                  {a.state === "checks_in_progress" && c.result !== "passed" ? <CheckForm detail={detail} kind={kind} returnTo={returnTo} /> : null}
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}

      {["training", "test_passed", "approved_tier1", "active", "suspended"].includes(a.state) || detail.attempts.length > 0 ? (
        <Section title="Training and test">
          <p className="text-sm">
            Training modules done: {detail.training.completed} of {detail.training.required}
          </p>
          {detail.attempts.length === 0 ? <Muted>No test attempts yet.</Muted> : null}
          <ul className="space-y-1 text-sm">
            {detail.attempts.map((t) => (
              <li key={t.attempt_number}>
                Attempt {t.attempt_number}: {t.submitted_at ? `${t.score_percent}% , safety-critical ${t.red_correct} of ${t.red_total}, ${t.passed ? "passed" : "not passed"}` : "in progress"}
              </li>
            ))}
          </ul>
          {isCmo && a.state === "training" && exhausted ? (
            <ReasonForm action={grantTestRetake} hidden={{ applicationId: a.id }} label="Allow one more attempt" returnTo={returnTo} />
          ) : null}
        </Section>
      ) : null}

      {isCmo && a.state === "test_passed" ? (
        <Section title="Approve" hint="Approval creates the clinician record, switched off. Level 1 is limited task types with early review; level 2 is full task types. On call and lead clinician need level 2.">
          <form action={approveApplication} className="space-y-3">
            <Hidden name="applicationId" value={a.id} />
            <Hidden name="returnTo" value={returnTo} />
            <Field label="Level" hint="Leave as default: freelance starts at 1, employed at 2.">
              <select name="level" className={fieldClass} defaultValue="">
                <option value="">Default for their employment type</option>
                <option value="1">Level 1</option>
                <option value="2">Level 2</option>
              </select>
            </Field>
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="mb-1 text-sm font-medium">Competencies</legend>
              {COMPETENCY_CODES.map((c) => (
                <label key={c} className="flex items-center gap-2">
                  <input type="checkbox" name="competency" value={c} /> {COMPETENCY_LABEL[c]}
                </label>
              ))}
            </fieldset>
            <SubmitButton>Approve</SubmitButton>
          </form>
        </Section>
      ) : null}

      {a.state === "approved_tier1" ? (
        <Section title="Switch on" hint="Switching on gives the clinician their clinician access. Do it when their first-day setup is complete.">
          <form action={activateClinician}>
            <Hidden name="applicationId" value={a.id} />
            <Hidden name="returnTo" value={returnTo} />
            <SubmitButton>Switch on</SubmitButton>
          </form>
        </Section>
      ) : null}

      {staff ? (
        <Section title="Clinician record">
          <p className="text-sm">
            {staff.status}, {staff.active ? "switched on" : "switched off"}, level {staff.level ?? "not set"}. Licence ends {formatDate(staff.license_expires_at)}.
          </p>
          <div className="flex flex-wrap gap-2">
            {staff.competencies.map((c) => (
              <Badge key={c} variant="blue">
                {COMPETENCY_LABEL[c] ?? c}
              </Badge>
            ))}
          </div>
          {isCmo ? (
            <div className="space-y-3">
              <form action={grantCompetency} className="flex flex-wrap items-end gap-2">
                <Hidden name="staffId" value={staff.id} />
                <Hidden name="returnTo" value={returnTo} />
                <Field label="Grant a competency">
                  <select name="code" className={fieldClass}>
                    {COMPETENCY_CODES.filter((c) => !staff.competencies.includes(c)).map((c) => (
                      <option key={c} value={c}>{COMPETENCY_LABEL[c]}</option>
                    ))}
                  </select>
                </Field>
                <SubmitButton tone="outline">Grant</SubmitButton>
              </form>
              <form action={revokeCompetency} className="flex flex-wrap items-end gap-2">
                <Hidden name="staffId" value={staff.id} />
                <Hidden name="returnTo" value={returnTo} />
                <Field label="Remove a competency">
                  <select name="code" className={fieldClass}>
                    {staff.competencies.map((c) => (
                      <option key={c} value={c}>{COMPETENCY_LABEL[c] ?? c}</option>
                    ))}
                  </select>
                </Field>
                <SubmitButton tone="outline">Remove</SubmitButton>
              </form>
              <form action={setLevel} className="flex flex-wrap items-end gap-2">
                <Hidden name="staffId" value={staff.id} />
                <Hidden name="returnTo" value={returnTo} />
                <Field label="Level">
                  <select name="level" className={fieldClass} defaultValue={String(staff.level ?? 1)}>
                    <option value="1">Level 1</option>
                    <option value="2">Level 2</option>
                  </select>
                </Field>
                <Field label="Reason">
                  <input name="reason" required minLength={10} className={fieldClass} />
                </Field>
                <SubmitButton tone="outline">Change level</SubmitButton>
              </form>
            </div>
          ) : null}
        </Section>
      ) : null}

      {live ? (
        <Section title="Not going ahead">
          <ReasonForm action={rejectApplication} hidden={{ applicationId: a.id }} label="Mark as not approved" tone="danger" returnTo={returnTo} />
        </Section>
      ) : null}

      <Section title="History">
        <ol className="space-y-1 text-sm">
          {detail.transitions.map((t, i) => (
            <li key={`${t.to_state}-${i}`} className="flex flex-wrap justify-between gap-2">
              <span>
                {t.from_state ? `${APPLICATION_STATE_LABEL[t.from_state] ?? t.from_state} to ` : ""}
                {APPLICATION_STATE_LABEL[t.to_state] ?? t.to_state}
                {t.reason ? `: ${t.reason}` : ""}
              </span>
              <span className="text-charcoal-ink/55">
                {t.actor_name ?? "System"}, {formatDate(t.created_at)}
              </span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
