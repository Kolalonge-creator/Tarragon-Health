import { Badge } from "@/components/ui/badge";
import { daysUntil, describeDays, EXPIRY_BAND_TONE, expiryBand } from "@/lib/credentialing/expiry";
import { BLOCKER_LABEL, COMPETENCY_LABEL, formatDate } from "@/lib/credentialing/labels";
import type { MyCredentialStatus } from "@/lib/credentialing/schemas";
import { DocumentUploadForm } from "./document-upload-form";
import { Muted, Section } from "./shared";

function ExpiryLine({ label, expiresAt, inGrace, now }: { label: string; expiresAt: string | null; inGrace: boolean; now: Date }) {
  const days = daysUntil(expiresAt, now);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-2">
        <span>{expiresAt ? formatDate(expiresAt) : "Not recorded"}</span>
        <Badge variant={EXPIRY_BAND_TONE[expiryBand(days)]}>{describeDays(days)}</Badge>
        {inGrace ? <Badge variant="amber">Grace period</Badge> : null}
      </span>
    </div>
  );
}

/** A clinician's own credential status and renewal uploads. Used on their Training and profile page and in the join flow. */
export function CredentialStatus({ status, returnTo, now }: { status: MyCredentialStatus; returnTo: string; now: Date }) {
  const paused = status.status !== "active";
  const level1 = status.level === 1;
  return (
    <div className="space-y-5">
      <Section title="Your status">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.eligible ? "green" : "red"}>{status.eligible ? "You can take cases" : "You cannot take cases right now"}</Badge>
          {status.level ? <Badge variant="blue">Level {status.level}</Badge> : null}
        </div>
        {status.blockers.length > 0 ? (
          <ul className="list-disc pl-5 text-sm">
            {status.blockers.map((b) => (
              <li key={b}>{BLOCKER_LABEL[b] ?? b}</li>
            ))}
          </ul>
        ) : null}
        {paused ? (
          <Muted>Upload your renewed documents below. Our team will check them and switch your access back on.</Muted>
        ) : null}
        {level1 ? (
          <Muted>
            Your first {status.audit_required_count} completed tasks are reviewed by our clinical team. {status.audited_task_count} reviewed so far.
          </Muted>
        ) : null}
      </Section>

      <Section title="Licence and cover" hint="We remind you three months before, one month before, and on the day. Keep these dates up to date.">
        <ExpiryLine label="MDCN practising licence" expiresAt={status.licence_expires_at} inGrace={status.licence_in_grace} now={now} />
        {status.indemnity_required ? (
          <ExpiryLine label="Professional indemnity cover" expiresAt={status.indemnity_expires_at} inGrace={status.indemnity_in_grace} now={now} />
        ) : (
          <Muted>Your indemnity cover is provided by Tarragon Health.</Muted>
        )}
      </Section>

      <Section title="Renew" hint="Upload your new documents. Our team checks them and records the new dates.">
        <div className="space-y-4">
          <DocumentUploadForm kind="mdcn_practising_licence" applicationId={null} returnTo={returnTo} withExpiry buttonLabel="Upload new licence" />
          <DocumentUploadForm kind="mdcn_portal_screenshot" applicationId={null} returnTo={returnTo} buttonLabel="Upload portal screenshot" />
          {status.indemnity_required ? (
            <DocumentUploadForm kind="indemnity_certificate" applicationId={null} returnTo={returnTo} withExpiry buttonLabel="Upload new certificate" />
          ) : null}
        </div>
      </Section>

      <Section title="What you are cleared for">
        {status.competencies.length === 0 ? (
          <Muted>No competencies recorded yet.</Muted>
        ) : (
          <div className="flex flex-wrap gap-2">
            {status.competencies.map((c) => (
              <Badge key={c} variant="blue">
                {COMPETENCY_LABEL[c] ?? c}
              </Badge>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
