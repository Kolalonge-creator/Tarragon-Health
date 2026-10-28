"use client";

import Link from "next/link";
import { t } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMyMembership } from "@/lib/queries/commerce";
import { useActiveEmergency } from "@/lib/queries/emergency";
import { useFreeGuidance } from "@/lib/queries/free-red-checkin";
import { redAcknowledgedThisSession } from "./red-session";

/**
 * W-53 / D-03 (founder, 2026-10-27): the calm-screen Membership offer that replaced the Join button on the red screen. Plain, with the price and the
 * refund window beside the button, no countdown. Shown only to a person who is not a Member, never while a red or emergency state is open, and never after
 * one was acknowledged in this session. `priceLabel` and `refundDays` come from the versioned price and refund configuration (read by the page), never typed here.
 */
export function FollowWithDoctorCard({ patientId, priceLabel, refundDays }: { patientId: string; priceLabel: string; refundDays: number }) {
  const membership = useMyMembership();
  const emergency = useActiveEmergency(patientId);
  const guidance = useFreeGuidance(patientId);
  if (membership.data?.is_member !== false) return null; // loading, error or already a Member: say nothing
  if (emergency.data || guidance.data || redAcknowledgedThisSession()) return null;
  return (
    <Card data-testid="follow-with-doctor">
      <CardHeader>
        <CardTitle className="text-base">{t("freered.follow.title", "en")}</CardTitle>
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
