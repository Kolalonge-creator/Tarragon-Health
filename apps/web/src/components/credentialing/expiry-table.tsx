import { Badge } from "@/components/ui/badge";
import { daysUntil, describeDays, EXPIRY_BAND_LABEL, EXPIRY_BAND_TONE, expiryBand } from "@/lib/credentialing/expiry";
import { DOCUMENT_KIND_LABEL, formatDate } from "@/lib/credentialing/labels";
import type { ExpiryRow } from "@/lib/credentialing/schemas";
import {
  grantGrace,
  offboardClinician,
  reinstateClinician,
  renewCredential,
  revokeGrace,
  suspendClinician,
} from "@/lib/credentialing/review-actions";
import { getProposedConfig } from "@tarragon/shared";
import { Field, fieldClass, Hidden, Muted, SubmitButton } from "./shared";

/** The longest grace period a reviewer can record. The database enforces the same number from credentialing_config. */
const GRACE_MAX_DAYS = (getProposedConfig("credentialing.rules").value as { grace_max_days: number }).grace_max_days;

function DateCell({ label, iso, now, show }: { label: string; iso: string | null; now: Date; show: boolean }) {
  if (!show) return <span className="text-xs text-charcoal-ink/50">{label}: covered by Tarragon</span>;
  const days = daysUntil(iso, now);
  const band = expiryBand(days);
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-charcoal-ink/55">{label}</div>
      <div className="text-sm">{iso ? formatDate(iso) : "Not recorded"}</div>
      <Badge variant={EXPIRY_BAND_TONE[band]}>{band === "ok" || band === "not_recorded" ? EXPIRY_BAND_LABEL[band] : describeDays(days)}</Badge>
    </div>
  );
}

function Actions({ row, returnTo }: { row: ExpiryRow; returnTo: string }) {
  return (
    <div className="space-y-3 text-sm">
      {row.renewal_documents.map((d) => (
        <form key={d.id} action={renewCredential} className="flex flex-wrap items-end gap-2">
          <Hidden name="staffId" value={row.id} />
          <Hidden name="documentId" value={d.id} />
          <Hidden name="kind" value={d.kind === "indemnity_certificate" ? "indemnity" : "licence"} />
          <Hidden name="returnTo" value={returnTo} />
          <div className="text-xs">
            <a href={`/api/credentialing/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-green underline">
              {DOCUMENT_KIND_LABEL[d.kind] ?? d.kind}
            </a>{" "}
            uploaded {formatDate(d.created_at)}
          </div>
          <Field label="New expiry date">
            <input type="date" name="expires_on" required className={fieldClass} />
          </Field>
          <SubmitButton tone="outline">Check and record renewal</SubmitButton>
        </form>
      ))}

      {row.grace.map((g) => (
        <form key={g.id} action={revokeGrace} className="flex flex-wrap items-center gap-2">
          <Hidden name="graceId" value={g.id} />
          <Hidden name="returnTo" value={returnTo} />
          <span>
            Grace for {g.kind} until {formatDate(g.ends_at)}: {g.reason}
          </span>
          <SubmitButton tone="outline">End grace</SubmitButton>
        </form>
      ))}

      <details>
        <summary className="cursor-pointer font-medium">Grace period</summary>
        <form action={grantGrace} className="mt-2 flex flex-wrap items-end gap-2">
          <Hidden name="staffId" value={row.id} />
          <Hidden name="returnTo" value={returnTo} />
          <Field label="For">
            <select name="kind" className={fieldClass}>
              <option value="licence">Licence</option>
              {row.indemnity_required ? <option value="indemnity">Indemnity</option> : null}
            </select>
          </Field>
          <Field label="Days">
            <input name="days" type="number" min={1} max={GRACE_MAX_DAYS} defaultValue={Math.min(7, GRACE_MAX_DAYS)} required className={fieldClass} />
          </Field>
          <Field label="Reason (recorded, with your name)">
            <input name="reason" required minLength={10} className={fieldClass} />
          </Field>
          <SubmitButton tone="outline">Record grace</SubmitButton>
        </form>
      </details>

      <details>
        <summary className="cursor-pointer font-medium">{row.status === "suspended" ? "Reinstate" : "Pause or remove access"}</summary>
        <div className="mt-2 space-y-2">
          {row.status === "suspended" ? (
            <form action={reinstateClinician} className="flex flex-wrap items-end gap-2">
              <Hidden name="staffId" value={row.id} />
              <Hidden name="returnTo" value={returnTo} />
              <Field label="Reason (at least 10 characters)">
                <input name="reason" required minLength={10} className={fieldClass} />
              </Field>
              <SubmitButton>Reinstate</SubmitButton>
            </form>
          ) : (
            <form action={suspendClinician} className="flex flex-wrap items-end gap-2">
              <Hidden name="staffId" value={row.id} />
              <Hidden name="returnTo" value={returnTo} />
              <Field label="Reason (at least 10 characters)">
                <input name="reason" required minLength={10} className={fieldClass} />
              </Field>
              <SubmitButton tone="danger">Pause access</SubmitButton>
            </form>
          )}
          <form action={offboardClinician} className="flex flex-wrap items-end gap-2">
            <Hidden name="staffId" value={row.id} />
            <Hidden name="returnTo" value={returnTo} />
            <Field label="Remove from the network (at least 10 characters)">
              <input name="reason" required minLength={10} className={fieldClass} />
            </Field>
            <SubmitButton tone="danger">Remove</SubmitButton>
          </form>
        </div>
      </details>
    </div>
  );
}

/** Everyone who works here, soonest expiry first, with the actions a reviewer needs. `now` is passed in so the page decides the day. */
export function ExpiryTable({ rows, returnTo, now }: { rows: ExpiryRow[]; returnTo: string; now: Date }) {
  if (rows.length === 0) return <Muted>No clinicians on file.</Muted>;
  return (
    <ul className="space-y-4">
      {rows.map((r) => (
        <li key={r.id} className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4 dark:border-night-ink/15 dark:bg-night-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{r.full_name}</p>
              <p className="text-xs text-charcoal-ink/55">
                {r.employment_type === "employed" ? "Employed" : "Freelance"} · level {r.level ?? "not set"} · {r.audited_task_count} tasks reviewed
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={r.status === "active" ? "green" : r.status === "suspended" ? "red" : "grey"}>{r.status}</Badge>
              <Badge variant={r.eligible ? "green" : "red"}>{r.eligible ? "Eligible for cases" : "Not eligible"}</Badge>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateCell label="MDCN licence" iso={r.license_expires_at} now={now} show />
            <DateCell label="Indemnity" iso={r.indemnity_expires_at} now={now} show={r.indemnity_required} />
          </div>
          <Actions row={r} returnTo={returnTo} />
        </li>
      ))}
    </ul>
  );
}
