"use client";

import { useState } from "react";
import { useCareAccessLog, type CareAccessEvent } from "@/lib/queries/care-graph";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * What has actually been done with the access this person has given out.
 *
 * A consent switch with no audit trail asks the patient to police a
 * relationship from memory, and the relationships here are the hard ones to
 * police: the grantee is usually the person paying, frequently senior in the
 * family, and always harder to say no to than a stranger would be.
 *
 * Reads care_access_events, which RLS scopes to rows the caller is the subject
 * of. The log is append-only at the table-privilege level, so nothing on this
 * screen can be tidied away later — including by the patient themselves, which
 * is the point of an audit trail.
 */

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const SCOPE_PHRASE: Record<string, string> = {
  care_receipt: "looked at your care receipt",
  health_summary: "looked at your health information",
  care_status: "checked whether your care is being reviewed",
  billing: "looked at what you owe",
  refill_request: "asked the pharmacy to refill a prescription for you",
  booking: "booked or paid for care for you",
  messaging: "took part in a conversation with your care team",
};

/**
 * Plain English, built from the event kind and the fixed scope vocabulary.
 *
 * Deliberately never renders anything free-text from the row: `scope` is
 * CHECK-constrained to the seven values above precisely so this line can never
 * become a place where clinical content shows up.
 */
function describe(event: CareAccessEvent): string {
  const who = event.subjectName ?? event.actorName ?? "Someone";

  switch (event.kind) {
    case "granted":
      return `You gave ${who} access to your care`;
    case "permission_changed":
      return `You changed what ${who} can do`;
    case "clinical_access_granted":
      return `You let ${who} see your health information`;
    case "clinical_access_withdrawn":
      return `You stopped ${who} seeing your health information`;
    case "revoked":
      return `${who} no longer has access to your care`;
    case "acted_for":
      return `${who} ${SCOPE_PHRASE[event.scope ?? ""] ?? "did something on your behalf"}`;
    case "record_viewed":
    case "receipt_generated":
      return `${who} ${SCOPE_PHRASE[event.scope ?? ""] ?? "looked at your care"}`;
    default:
      return `${who} did something on your record`;
  }
}

export function AccessLogPanel() {
  const [expanded, setExpanded] = useState(false);
  const { data: events, isLoading, isError } = useCareAccessLog(expanded ? 100 : 8);

  // Nothing has ever happened, so there is nothing to reassure anyone about.
  // Showing an empty audit panel to someone who has never shared anything is
  // just anxiety with a heading on it.
  if (!isLoading && !isError && (events?.length ?? 0) === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>What has been done with your care</CardTitle>
        <CardDescription>
          Every time someone you have added looks at your care or acts on it, it is recorded here.
          Nobody can remove anything from this list, including us.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load this.</p>}
        {events && events.length > 0 && (
          <>
            <ul className="divide-y divide-charcoal-ink/10">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span className="text-sm text-charcoal-ink">{describe(event)}</span>
                  <span className="text-xs text-charcoal-ink/50">{longDate(event.occurredAt)}</span>
                </li>
              ))}
            </ul>
            {!expanded && events.length >= 8 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setExpanded(true)}
              >
                Show more
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
