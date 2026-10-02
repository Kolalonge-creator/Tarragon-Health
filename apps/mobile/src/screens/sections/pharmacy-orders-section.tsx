import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { koboToNaira } from "@tarragon/shared";
import {
  getPharmacyOrders,
  isPharmacyOrderPayable,
  pharmacyOrderItemsSummary,
  PHARMACY_ORDER_STATUS_LABEL,
  type PharmacyOrderListItem,
  type PharmacyOrderStatus,
} from "@/lib/prescription-renewal";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, inkAlpha } from "@/ui/theme";
import { Card, MutedText, PrimaryButton, SectionLabel } from "@/ui/components";

const naira = (kobo: number) => `₦${koboToNaira(kobo).toLocaleString()}`;

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const STATUS_TONE: Record<PharmacyOrderStatus, "green" | "amber" | "grey" | "red"> = {
  pending_payment: "amber",
  payment_confirmed: "grey",
  requested: "grey",
  confirmed: "grey",
  unavailable: "amber",
  dispensed: "grey",
  out_for_delivery: "grey",
  delivery_failed: "red",
  delivered: "green",
  cancelled: "grey",
};

function StatusPill({ status }: { status: PharmacyOrderStatus }) {
  const tone = STATUS_TONE[status];
  const styles: Record<string, { bg: string; text: string }> = {
    green: { bg: colors.brandTint, text: colors.brandPressed },
    amber: { bg: colors.status.warnBg, text: colors.status.warn },
    grey: { bg: inkAlpha(0.08), text: colors.muted },
    red: { bg: "#FBE9E7", text: colors.danger },
  };
  const s = styles[tone];
  return (
    <View style={{ backgroundColor: s.bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}>
      <Text style={{ fontSize: 11, fontWeight: "700", color: s.text }}>{PHARMACY_ORDER_STATUS_LABEL[status]}</Text>
    </View>
  );
}

function PharmacyOrderCard({ order, onChanged }: { order: PharmacyOrderListItem; onChanged: () => Promise<void> }) {
  async function openCardPayment() {
    // No native card-payment flow exists for pharmacy orders — hand off to
    // the real web payment page (card form + voucher/promo redemption),
    // same "open the web page for the real-money step" pattern
    // services-screen.tsx's openServicesPage already uses. Refresh on
    // return in case it was paid there.
    await WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/medications`);
    await onChanged();
  }

  return (
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <StatusPill status={order.status} />
        {order.orderNumber ? <Text style={{ fontSize: 11, color: colors.subtle }}>{order.orderNumber}</Text> : null}
      </View>
      <Text style={{ fontSize: 14.5, fontWeight: "600", color: colors.ink }}>
        {pharmacyOrderItemsSummary(order.items) || "Pharmacy order"}
      </Text>
      <MutedText>
        {naira(order.totalKobo)} · requested {formatDate(order.requestedAt)}
      </MutedText>

      {isPharmacyOrderPayable(order.status) ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <View style={{ flex: 1 }}>
            <PrimaryButton title={`Pay ${naira(order.payableKobo)} by card`} onPress={() => void openCardPayment()} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

/**
 * "Your pharmacy orders" — native counterpart to
 * apps/web/src/app/(dashboard)/patient/pharmacy-orders-list.tsx: every
 * pharmacy_orders row this patient has, with a card-payment "Pay"
 * affordance (system browser hand-off) on anything still pending_payment.
 * See lib/prescription-renewal.ts's module comment for why order CREATION
 * isn't ported here (no live pharmacy to choose from yet).
 *
 * Delivery-address collection, dispense logging, and the courier timeline
 * stay web-only for this pass — this screen's job is "see your orders, pay
 * the ones that need it," matching the gap medicine-cabinet-screen.tsx's
 * header comment used to flag.
 */
export function PharmacyOrdersSection({ patientId }: { patientId: string }) {
  const [orders, setOrders] = useState<PharmacyOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const result = await getPharmacyOrders(patientId);
    if (result.ok) {
      setError(false);
      setOrders(result.data);
    } else {
      setError(true);
    }
  }, [patientId]);

  useEffect(() => {
    load()
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [load]);

  function retry() {
    setLoading(true);
    load()
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  if (loading) {
    return (
      <View style={{ gap: 10 }}>
        <SectionLabel>Your pharmacy orders</SectionLabel>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ gap: 10 }}>
        <SectionLabel>Your pharmacy orders</SectionLabel>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="We couldn't load your pharmacy orders. Tap to retry."
          onPress={retry}
        >
          <Card style={{ alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>We couldn&apos;t load this right now</Text>
            <MutedText>Tap to retry.</MutedText>
          </Card>
        </Pressable>
      </View>
    );
  }

  // Nothing on file at all reads as "nothing to show" — no false claim
  // either way, matching how the other cabinet sections handle an empty
  // list. A patient with no pharmacy order yet simply sees nothing here.
  if (orders.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>Your pharmacy orders</SectionLabel>
      <View style={{ gap: 10 }}>
        {orders.map((order) => (
          <PharmacyOrderCard key={order.id} order={order} onChanged={load} />
        ))}
      </View>
    </View>
  );
}
