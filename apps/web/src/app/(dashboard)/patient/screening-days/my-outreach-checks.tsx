"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDateTime } from "@/lib/format-date";
import { useMyOutreachEnrolments } from "@/lib/queries/screening-days";

type ConsultState = "none" | "ready" | "used" | "lapsed";

/** What the included results consultation can still do. Exported for its test. */
export function consultState(
  consult: { status: string; redeemed_at: string | null; expires_at: string | null } | null | undefined,
  now: Date = new Date(),
): ConsultState {
  if (!consult) return "none";
  if (consult.redeemed_at) return "used";
  if (consult.status !== "active") return "lapsed";
  if (consult.expires_at && new Date(consult.expires_at) <= now) return "lapsed";
  return "ready";
}

/**
 * An attendee's own outreach health checks (OD-01..OD-04): the lab form for the yearly blood tests (taken to any laboratory,
 * paid there), the one results consultation a paid place includes, and the way on to Membership. Renders nothing for a
 * patient who has never been enrolled at one.
 */
export function MyOutreachChecks() {
  const { data: enrolments } = useMyOutreachEnrolments();
  if (!enrolments || enrolments.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your health check</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {enrolments.map((e) => {
          const consult = Array.isArray(e.consult) ? e.consult[0] : e.consult;
          const state = consultState(consult);
          return (
            <div key={e.slot_id} className="space-y-2 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
              <p className="text-charcoal-ink/60 dark:text-night-ink/60">
                {formatPatientDateTime(e.enrolled_at, { day: "numeric", month: "long", year: "numeric" })}
              </p>
              <p>
                Your readings from the day are in your record. For your yearly blood tests, take this lab form to any
                laboratory you choose and pay the laboratory there. When you get your results, upload them in the app with
                this request, and the care team will look at them.
              </p>
              <a
                href={`/api/patient/lab-order/${e.lab_order_id}/request`}
                className="inline-block font-medium text-brand-green hover:underline dark:text-brand-green-bright"
              >
                Download your lab form
              </a>
              {state === "ready" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="blue">Results consultation included</Badge>
                  <Link href="/patient/appointments" className="font-medium text-brand-green hover:underline dark:text-brand-green-bright">
                    Book it once your results are in
                  </Link>
                  {consult?.expires_at ? (
                    <span className="text-charcoal-ink/60 dark:text-night-ink/60">
                      Use it by {formatPatientDateTime(consult.expires_at, { day: "numeric", month: "long" })}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {state === "used" ? <Badge variant="green">Results consultation booked</Badge> : null}
              {state === "lapsed" ? <Badge variant="grey">The included consultation has lapsed</Badge> : null}
            </div>
          );
        })}
        <p className="border-t border-charcoal-ink/10 pt-3 text-sm text-charcoal-ink/70 dark:border-night-ink/15 dark:text-night-ink/70">
          Want a doctor following up with you all year?{" "}
          <Link href="/patient/membership" className="font-medium text-brand-green hover:underline dark:text-brand-green-bright">
            See Membership
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
