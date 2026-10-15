import { useEffect, useState } from "react";
import { Text } from "react-native";
import { loadMonitoringCover } from "@/lib/monitoring-cover";
import { loadMembership } from "@/lib/commerce/api";
import type { ServicePurchaseWithProduct } from "@/lib/services";
import { useLegacyColors } from "@/ui/design";
import { Card, MutedText } from "@/ui/legacy-kit";

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
 * Mirrors apps/web/src/components/monitoring-cover-card.tsx. Same rules apply
 * here: never imply a free-plan patient is unmonitored (every reading is still
 * checked against protocols and the full emergency safety net applies on both
 * plans), and never suggest anything might auto-renew. Continuous monitoring is
 * a Membership benefit now, not a product: this card names no price. A pass
 * bought before that, and still held, is shown until it ends.
 */
export function MonitoringCoverCard() {
  const colors = useLegacyColors();
  const [cover, setCover] = useState<ServicePurchaseWithProduct | null | undefined>(undefined);
  const [isMember, setIsMember] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMembership().then((m) => {
      // inside the 14 day grace the person is still a Member (graceEndsAt is set only then)
      if (!cancelled && m.ok) setIsMember(m.data.isMember || m.data.graceEndsAt !== undefined);
    });
    loadMonitoringCover().then((result) => {
      if (!cancelled) setCover(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (cover === undefined) return null;

  if (isMember) {
    return (
      <Card style={{ gap: 6, borderColor: colors.brand }}>
        <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>
          A doctor is watching your readings
        </Text>
        <MutedText>
          As a Member, a doctor on your care team is told when one of your readings is dangerous and follows up with you.
        </MutedText>
      </Card>
    );
  }

  if (!cover) {
    return (
      <Card style={{ gap: 6 }}>
        <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>
          On the free plan a doctor is not told when a reading is dangerous
        </Text>
        <MutedText>
          Every reading you log is still checked against care protocols, and you still get the full
          emergency safety net — immediate guidance, your emergency contact notified, and a check-in
          afterwards. Membership adds a doctor on your care team being told as well, and following
          up with you. You can join from the Membership page.
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
