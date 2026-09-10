import { useEffect, useState } from "react";
import { Text } from "react-native";
import { loadMonitoringCover } from "@/lib/monitoring-cover";
import type { ServicePurchaseWithProduct } from "@/lib/services";
import { colors } from "@/ui/theme";
import { Card, MutedText } from "@/ui/components";

const ENDING_SOON_DAYS = 21;

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Mirrors apps/web/src/components/monitoring-cover-card.tsx. Same two rules
 * apply here: never imply an uncovered patient is unmonitored (every reading
 * is still checked against protocols and the full emergency safety net
 * applies regardless of payment), and never suggest cover might auto-renew
 * (it never does — see the pricing page's "no subscription, nothing to
 * cancel" promise).
 */
export function MonitoringCoverCard() {
  const [cover, setCover] = useState<ServicePurchaseWithProduct | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadMonitoringCover().then((result) => {
      if (!cancelled) setCover(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (cover === undefined) return null;

  if (!cover) {
    return (
      <Card style={{ gap: 6 }}>
        <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>
          Nobody is alerted when one of your readings is dangerous
        </Text>
        <MutedText>
          Every reading you log is still checked against care protocols, and you still get the full
          emergency safety net — immediate guidance, your emergency contact notified, and a check-in
          afterwards. Continuous Monitoring adds a doctor on your care team being told as well, from
          ₦7,500 for three months. Nothing renews and no card is kept.
        </MutedText>
      </Card>
    );
  }

  const endsAt = cover.expires_at;
  const remaining = endsAt ? daysUntil(endsAt) : null;
  const endingSoon = remaining !== null && remaining <= ENDING_SOON_DAYS;

  return (
    <Card style={{ gap: 6, borderColor: endingSoon ? colors.status.warn : colors.brand }}>
      <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>
        A doctor is watching your readings
      </Text>
      <MutedText>
        {endsAt ? (
          <>
            Your {cover.service_product?.name ?? "cover"} runs until {shortDate(endsAt)}
            {endingSoon ? ` — that is ${remaining} day${remaining === 1 ? "" : "s"} away.` : "."} It
            will simply stop then; nothing renews on its own.
          </>
        ) : (
          "Your cover has no end date."
        )}
      </MutedText>
    </Card>
  );
}
