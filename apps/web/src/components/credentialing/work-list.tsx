import { Badge } from "@/components/ui/badge";
import { PRIMARY_SOURCE_ROUTE_LABEL, formatDate } from "@/lib/credentialing/labels";
import type { WorkList as WorkListData } from "@/lib/credentialing/schemas";
import { recordCredentialDates, recordPrimarySource } from "@/lib/credentialing/review-actions";
import { Field, fieldClass, Hidden, Muted, Section, SubmitButton } from "./shared";

type Part = "unverified" | "rechecks" | "missing_dates";

function EvidenceForm({
  staffId,
  documents,
  returnTo,
  label,
}: {
  staffId: string;
  documents: WorkListData["unverified"][number]["documents"];
  returnTo: string;
  label: string;
}) {
  if (documents.length === 0) {
    return <Muted>Waiting for the clinician to upload the DataFlow report or MDCN confirmation under Training and profile.</Muted>;
  }
  return (
    <form action={recordPrimarySource} className="flex flex-wrap items-end gap-2">
      <Hidden name="staffId" value={staffId} />
      <Hidden name="returnTo" value={returnTo} />
      <Field label="Their uploaded file">
        <select name="documentId" required className={fieldClass}>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.kind === "mdcn_confirmation" ? "Verification report" : "Register screenshot"}, {formatDate(d.created_at)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="How it was verified">
        <select name="route" className={fieldClass} defaultValue="mdcn_dataflow">
          {Object.entries(PRIMARY_SOURCE_ROUTE_LABEL).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reference number">
        <input name="reference" required minLength={4} maxLength={80} className={fieldClass} />
      </Field>
      <Field label="Date verified">
        <input type="date" name="verified_on" required className={fieldClass} />
      </Field>
      <Field label="Notes">
        <input name="notes" maxLength={1000} className={fieldClass} />
      </Field>
      <SubmitButton>{label}</SubmitButton>
    </form>
  );
}

/**
 * The credentialing work list (P5). Three plain lists, each with the form that clears it. Nothing here suspends anyone:
 * a missing record or an overdue re-check is a job for a person, and the database refuses a form that is wrong.
 * No evidence or date is ever filled in for anybody; the reviewer types what the file in front of them says.
 */
export function WorkList({ list, returnTo, parts }: { list: WorkListData; returnTo: string; parts: readonly Part[] }) {
  return (
    <div className="space-y-5">
      {parts.includes("unverified") ? (
        <Section
          title="Registration evidence needed"
          hint="Everyone working here needs a recorded MDCN or DataFlow verification. People who started before this rule can keep working until you record theirs."
        >
          {list.unverified.length === 0 ? (
            <Muted>Everyone working here has a verification on record.</Muted>
          ) : (
            <ul className="space-y-4">
              {list.unverified.map((r) => (
                <li key={r.staff_id} className="space-y-2 border-b border-charcoal-ink/10 pb-4 last:border-0 dark:border-night-ink/15">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {r.full_name}
                    <Badge variant={r.grandfathered ? "amber" : "red"}>{r.grandfathered ? "Working, evidence not recorded yet" : "Cannot take cases until recorded"}</Badge>
                  </p>
                  <EvidenceForm staffId={r.staff_id} documents={r.documents} returnTo={returnTo} label="Record verification" />
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {parts.includes("rechecks") ? (
        <Section title="Six-month spot re-checks" hint="Look the clinician up at the source again and record what you saw. An overdue re-check is flagged to the Chief Medical Officer. It never pauses anyone's access.">
          {list.rechecks.length === 0 ? (
            <Muted>No re-check is due.</Muted>
          ) : (
            <ul className="space-y-4">
              {list.rechecks.map((r) => (
                <li key={r.staff_id} className="space-y-2 border-b border-charcoal-ink/10 pb-4 last:border-0 dark:border-night-ink/15">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {r.full_name}
                    <Badge variant={r.overdue ? "red" : "amber"}>{r.overdue ? "Overdue" : "Due"} since {formatDate(r.due_on)}</Badge>
                    <span className="text-xs font-normal text-charcoal-ink/60 dark:text-night-ink/60">last verified {formatDate(r.last_verified_on)}</span>
                  </p>
                  <EvidenceForm staffId={r.staff_id} documents={r.documents} returnTo={returnTo} label="Record re-check" />
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {parts.includes("missing_dates") ? (
        <Section title="Licence and cover dates missing" hint="Without a date, nothing can remind the clinician or pause access when it runs out. Enter the date printed on the document and say where you read it. A date already on file is changed through the renewal check, not here.">
          {list.missing_dates.length === 0 ? (
            <Muted>Every working clinician has their dates on file.</Muted>
          ) : (
            <ul className="space-y-4">
              {list.missing_dates.map((r) => (
                <li key={r.staff_id} className="space-y-2 border-b border-charcoal-ink/10 pb-4 last:border-0 dark:border-night-ink/15">
                  <p className="font-medium">{r.full_name}</p>
                  <form action={recordCredentialDates} className="flex flex-wrap items-end gap-2">
                    <Hidden name="staffId" value={r.staff_id} />
                    <Hidden name="returnTo" value={returnTo} />
                    {r.licence_missing ? (
                      <Field label="MDCN licence expires">
                        <input type="date" name="licence_expires_on" className={fieldClass} />
                      </Field>
                    ) : null}
                    {r.indemnity_missing ? (
                      <Field label="Cover expires">
                        <input type="date" name="indemnity_expires_on" className={fieldClass} />
                      </Field>
                    ) : null}
                    <Field label="Where you read it (recorded, with your name)">
                      <input name="note" required minLength={10} maxLength={500} className={fieldClass} />
                    </Field>
                    <SubmitButton>Record dates</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
    </div>
  );
}
