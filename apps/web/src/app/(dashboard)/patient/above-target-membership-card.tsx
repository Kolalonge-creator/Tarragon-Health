"use client";

import Link from "next/link";
import { t } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMyMembership, useMyMembershipOffer } from "@/lib/queries/commerce";
import { useActiveEmergency } from "@/lib/queries/emergency";
import { useFreeGuidance } from "@/lib/queries/free-red-checkin";
import { redAcknowledgedThisSession } from "./red-session";

/**
 * Journey 1 (owner decision 2026-10-28): the Membership offer for a Free patient whose 7 day average is above target. The database decides (public.my_membership_offer:
 * Free only, above the risk engine's own line, and only while checkout is open), so this card shows nothing until that says "offer". The words and the price
 * and refund window are the ones the calm-screen offer already uses (W-53); only the title differs. Never shown during a red or emergency state, never
 * after one was acknowledged this session, and a failed read means no card.
 */
export function AboveTargetMembershipCard({ patientId, priceLabel, refundDays }: { patientId: string; priceLabel: string; refundDays: number }) {
  const offer = useMyMembershipOffer();
  const membership = useMyMembership();
  const emergency = useActiveEmergency(patientId);
  const guidance = useFreeGuidance(patientId);
  if (offer.data?.status !== "offer" || membership.data?.is_member !== false) return null;
  if (emergency.data || guidance.data || redAcknowledgedThisSession()) return null;
  return (
    <Card data-testid="above-target-membership">
      <CardHeader>
        <CardTitle className="text-base">{t("freered.above.title", "en")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{t("freered.follow.body", "en", { price: priceLabel, days: String(refundDays) })}</p>
        <Link href="/patient/membership" className="inline-flex min-h-11 items-center rounded-md bg-brand-green px-3 py-2 font-medium text-white">
          {t("freered.follow.cta", "en")}
        </Link>
      </CardContent>
    </Card>
  );
}
