"use client";

import { useState } from "react";
import { koboToNaira } from "@tarragon/shared";
import { Badge, type BadgeProps } from "@/components/ui/badge";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSponsoredReservations, type SponsoredReservation } from "@/lib/queries/sponsorship";

function naira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;
}

const STATUS_LABEL: Record<SponsoredReservation["status"], string> = {
  pending_payment: "Payment in progress",
  invited: "Waiting to be claimed",
  claimed: "Claimed",
  expired: "Expired, unclaimed",
  cancelled: "Cancelled",
};

const STATUS_VARIANT: Record<SponsoredReservation["status"], BadgeVariant> = {
  pending_payment: "grey",
  invited: "amber",
  claimed: "green",
  expired: "grey",
  cancelled: "grey",
};

/**
 * The claim link for a waiting reservation. No text message is sent to the person (SMS is for sign-in codes only): the sponsor gives them
 * this link themselves. It is a private link, shown only to the person who paid.
 */
function ClaimLink({ token, firstName }: { token: string; firstName: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${typeof window === "undefined" ? "" : window.location.origin}/claim/${token}`;
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
        Give this link to {firstName} yourself. We do not text them. It is private to you and them.
      </p>
      <div className="flex gap-2">
        <input readOnly value={url} aria-label={`Claim link for ${firstName}`} className="min-w-0 flex-1 rounded-lg border border-charcoal-ink/20 bg-white px-2 py-1 text-xs text-charcoal-ink dark:border-night-ink/25" />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}

/**
 * A non-clinical lifecycle list only — paid/invited/claimed/expired — same
 * boundary every other sponsor-facing view on this page keeps: money and
 * status, never what the reservation was later used for clinically.
 */
export function ReservationsSent() {
  const { data: reservations, isLoading } = useSponsoredReservations();

  if (isLoading || !reservations || reservations.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reservations you&apos;ve sent</CardTitle>
        <CardDescription>
          Care you paid for against just a phone number, before they had an account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/10">
          {reservations.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                  {r.recipientFirstName} · {r.serviceName}
                </p>
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  {r.recipientPhone} · {naira(r.amountKobo)}
                </p>
              </div>
              <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
              </div>
              {r.inviteToken && <ClaimLink token={r.inviteToken} firstName={r.recipientFirstName} />}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
