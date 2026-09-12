import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { startThread } from "@/lib/messages";
import { cancelPendingServicePurchase, formatPrice, type PendingPaymentIssue } from "@/lib/services";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, radius, spacing } from "@/ui/theme";

interface PaymentIssueCardProps {
  issue: PendingPaymentIssue;
  /** Called once the card's job is done (checkout re-opened, or the
   * purchase was cancelled) so the caller can refresh and let this card
   * disappear along with the rest of Overview's data. */
  onResolved: () => void;
}

/**
 * Native equivalent of apps/web/.../patient/payment-failure-banner.tsx —
 * §91.10 patient-facing recovery for a service_purchases checkout the
 * patient started and never finished (still 'pending_payment' after the
 * same 30-minute grace period, see getPendingPaymentIssue).
 *
 * "Retry payment" is the one action that stays a WebBrowser handoff:
 * buying is never done natively anywhere in this app (see
 * services-screen.tsx's own note) — retrying is literally the same
 * operation as buying the product again, so this opens the same
 * /patient/subscription page every other native "Pay" entry point already
 * opens (Screening Days, Financial Profile, Services), not a bespoke
 * "resume this checkout" implementation. "Message the care team" and
 * "Not right now" are real native actions — both already have a plain
 * RPC (start_care_thread / cancel_pending_service_purchase) a native
 * screen can call directly.
 */
export function PaymentIssueCard({ issue, onResolved }: PaymentIssueCardProps) {
  const [retrying, setRetrying] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [messageSent, setMessageSent] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRetry() {
    setRetrying(true);
    try {
      await WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/subscription`);
    } finally {
      setRetrying(false);
      onResolved();
    }
  }

  async function handleMessage() {
    setMessaging(true);
    setError(null);
    try {
      await startThread(
        "Payment issue",
        `My payment for purchase ${issue.id} keeps failing and I need help sorting it out.`
      );
      setMessageSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send. Try again.");
    } finally {
      setMessaging(false);
    }
  }

  async function handleDismiss() {
    setDismissing(true);
    setError(null);
    const result = await cancelPendingServicePurchase(issue.id);
    if (result.ok) {
      onResolved();
    } else {
      setError("Could not close this — try again");
      setDismissing(false);
    }
  }

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.status.warn,
        backgroundColor: colors.status.warnBg,
        borderRadius: radius.card,
        padding: spacing.card,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
        <Ionicons name="warning-outline" size={20} color={colors.status.warn} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>
            {`You started buying ${issue.serviceProductName} but didn't finish`}
          </Text>
          <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 2 }}>
            {`${formatPrice(issue.payableKobo, issue.currency)} is still unpaid. Pick up where you left off with the same or a different card.`}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <ActionPill title="Retry payment" tone="brand" loading={retrying} onPress={handleRetry} />
        {messageSent ? (
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.brand, paddingVertical: 9 }}>
            Sent. The care team will follow up.
          </Text>
        ) : (
          <ActionPill title="Message the care team" tone="outline" loading={messaging} onPress={handleMessage} />
        )}
        <ActionPill title="Not right now" tone="plain" loading={dismissing} onPress={handleDismiss} />
      </View>

      {error ? <Text style={{ fontSize: 12, color: colors.danger }}>{error}</Text> : null}
    </View>
  );
}

function ActionPill({
  title,
  tone,
  loading,
  onPress,
}: {
  title: string;
  tone: "brand" | "outline" | "plain";
  loading?: boolean;
  onPress: () => void;
}) {
  const toneStyle =
    tone === "brand"
      ? { backgroundColor: colors.brand }
      : tone === "outline"
        ? { borderWidth: 1, borderColor: colors.border, backgroundColor: "transparent" }
        : { backgroundColor: "transparent" };
  const textColor = tone === "brand" ? "#FFFFFF" : colors.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: loading }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        {
          borderRadius: radius.control,
          paddingVertical: 9,
          paddingHorizontal: 14,
          alignItems: "center",
          justifyContent: "center",
        },
        toneStyle,
        { opacity: pressed || loading ? 0.7 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tone === "brand" ? "#FFFFFF" : colors.ink} />
      ) : (
        <Text style={{ fontSize: 13, fontWeight: "600", color: textColor }}>{title}</Text>
      )}
    </Pressable>
  );
}
