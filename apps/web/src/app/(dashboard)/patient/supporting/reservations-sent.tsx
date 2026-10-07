"use client";

import { koboToNaira } from "@tarragon/shared";
import { Badge, type BadgeProps } from "@/components/ui/badge";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;
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
            <li key={r.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                  {r.recipientFirstName} · {r.serviceName}
                </p>
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  {r.recipientPhone} · {naira(r.amountKobo)}
                </p>
              </div>
              <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
