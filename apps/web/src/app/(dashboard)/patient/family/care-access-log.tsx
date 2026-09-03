import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface CareAccessLogRow {
  id: string;
  kind: string;
  occurredAt: string;
  isAboutMe: boolean;
  actorIsMe: boolean;
  patientName: string | null;
  actorName: string | null;
  subjectName: string | null;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * One line per event, in the reader's own voice. `care_access_events` names
 * the acting party as "actor" and the other side of a grant as "subject" —
 * neutral database language nobody should see; this is where it becomes a
 * sentence a patient or a supporter would actually recognise.
 */
function describe(row: CareAccessLogRow): string {
  const actor = row.actorIsMe ? "You" : (row.actorName ?? "Someone");
  const subject = row.subjectName ?? "someone";
  const patient = row.patientName ?? "their record";

  if (row.isAboutMe) {
    switch (row.kind) {
      case "granted":
        return `${actor} gave ${subject} access to your record`;
      case "revoked":
        return `${actor} removed ${subject}'s access to your record`;
      case "clinical_access_granted":
        return `You let ${subject} see your health information`;
      case "clinical_access_withdrawn":
        return `You stopped ${subject} seeing your health information`;
      case "permission_changed":
        return `${subject}'s access to your record changed`;
      case "receipt_generated":
        return `A care receipt was generated for ${subject}`;
      case "data_exported":
        return `${actor} exported data from your record`;
      case "record_viewed":
        return `${actor} viewed your record`;
      case "acted_for":
        return `${actor} acted on your behalf`;
      default:
        return `Something changed on your record`;
    }
  }

  // Not about my own record — this is my own activity as a supporter.
  switch (row.kind) {
    case "revoked":
      return row.actorIsMe
        ? `You removed your own access to ${patient}`
        : `Your access to ${patient} was removed`;
    case "receipt_generated":
      return `You generated a care receipt for ${patient}`;
    case "data_exported":
      return `You exported data from ${patient}`;
    case "record_viewed":
      return `You viewed ${patient}`;
    case "acted_for":
      return `You acted on behalf of ${patient}`;
    default:
      return `Something changed on ${patient}`;
  }
}

/**
 * "Your record was accessed by..." — the account of who has touched a
 * person's record and what changed about who can see it. Deliberately
 * scoped to grant lifecycle events (granted/revoked/clinical access
 * on/off/receipts/exports) plus whatever `record_viewed`/`acted_for`
 * activity is logged; it does not yet cover every clinician page view —
 * see private.log_care_access's own callers before promising more than
 * that in front of a patient.
 */
export function CareAccessLog({ events }: { events: CareAccessLogRow[] }) {
  if (events.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>What&rsquo;s happened with your access</CardTitle>
        <CardDescription>
          Every time someone&rsquo;s access to a record changed, on your record or on one you help
          look after.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {events.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-4 py-3">
              <span className="text-sm text-charcoal-ink">{describe(row)}</span>
              <span className="shrink-0 text-xs text-charcoal-ink/50">
                {shortDate(row.occurredAt)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
