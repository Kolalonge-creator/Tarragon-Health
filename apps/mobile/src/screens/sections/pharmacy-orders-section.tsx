import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { koboToNaira } from "@tarragon/shared";
import {
  getPharmacyOrders,
  isPharmacyOrderPayable,
  payPharmacyOrderWithCredit,
  pharmacyOrderItemsSummary,
  PHARMACY_ORDER_STATUS_LABEL,
  type PayPharmacyOrderWithCreditResult,
  type PharmacyOrderListItem,
  type PharmacyOrderStatus,
} from "@/lib/prescription-renewal";
import { loadPlatformCreditState } from "@/lib/platform-credit";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, inkAlpha, radius } from "@/ui/theme";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton, SectionLabel } from "@/ui/components";

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

/**
 * "Pay with Platform Credit" for one pending_payment order — checks the
 * caller's balance first (reusing the same domain layer the Financial
 * section's balance card uses), pays in-app via
 * payPharmacyOrderWithCredit when there's enough, and otherwise points at
 * card payment instead of offering a button that would just fail
 * server-side, mirroring PayWithPlatformCreditDialog on web.
 */
function PayWithCreditPanel({
  order,
  onPaid,
  onFallbackToCard,
}: {
  order: PharmacyOrderListItem;
  onPaid: () => void;
  onFallbackToCard: () => void;
}) {
  const [balanceKobo, setBalanceKobo] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<PayPharmacyOrderWithCreditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPlatformCreditState().then((res) => {
      if (cancelled) return;
      if (res.ok) setBalanceKobo(res.data.balanceKobo);
      else setBalanceError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const amountKobo = order.payableKobo;
  const hasEnoughCredit = balanceKobo !== null && balanceKobo >= amountKobo;
  const shortfallKobo = balanceKobo !== null ? Math.max(0, amountKobo - balanceKobo) : null;

  async function pay() {
    setPaying(true);
    setError(null);
    const res = await payPharmacyOrderWithCredit(order.id);
    setPaying(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.data);
    if (res.data.ok) onPaid();
  }

  if (balanceKobo === null && !balanceError) {
    return <ActivityIndicator color={colors.brand} style={{ marginVertical: 6 }} />;
  }

  return (
    <View style={{ gap: 8, marginTop: 6, backgroundColor: colors.groupBg, borderRadius: radius.control, padding: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <MutedText>You owe</MutedText>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{naira(amountKobo)}</Text>
      </View>
      {balanceKobo !== null ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <MutedText>Your platform credit</MutedText>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{naira(balanceKobo)}</Text>
        </View>
      ) : null}

      {balanceError ? <ErrorText>{balanceError}</ErrorText> : null}

      {balanceKobo !== null && !hasEnoughCredit ? (
        <MutedText>
          You need {naira(shortfallKobo ?? 0)} more. Top up in the Financial section, or pay by card instead.
        </MutedText>
      ) : null}

      {result && !result.ok ? (
        <ErrorText>
          {result.reason === "insufficient_balance"
            ? `You need ₦${koboToNaira(result.shortfall_kobo).toLocaleString()} more.`
            : "This order can no longer be paid for — refresh and try again."}
        </ErrorText>
      ) : null}
      {result?.ok ? <MutedText>Paid. Your order is confirmed.</MutedText> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}

      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <PrimaryButton
            title={paying ? "Paying…" : "Pay with credit"}
            onPress={pay}
            disabled={paying || balanceKobo === null || !hasEnoughCredit}
          />
        </View>
        <View style={{ flex: 1 }}>
          <SecondaryButton title="Pay by card instead" onPress={onFallbackToCard} disabled={paying} />
        </View>
      </View>
    </View>
  );
}

function PharmacyOrderCard({ order, onChanged }: { order: PharmacyOrderListItem; onChanged: () => Promise<void> }) {
  const [payOpen, setPayOpen] = useState(false);

  async function openCardPayment() {
    // No native card-payment flow exists for pharmacy orders — hand off to
    // the real web payment page (card form + voucher/promo redemption),
    // same "open the web page for the real-money step" pattern
    // services-screen.tsx's openServicesPage and financial-profile-screen.tsx's
    // runTopUp already use. Refresh on return in case it was paid there.
    await WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/medications`);
    await onChanged();
  }

  return (
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <StatusPill status={order.status} />
        {order.orderNumber ? <Text style={{ fontSize: 11, color: colors.faint }}>{order.orderNumber}</Text> : null}
      </View>
      <Text style={{ fontSize: 14.5, fontWeight: "600", color: colors.ink }}>
        {pharmacyOrderItemsSummary(order.items) || "Pharmacy order"}
      </Text>
      <MutedText>
        {naira(order.totalKobo)} · requested {formatDate(order.requestedAt)}
      </MutedText>

      {isPharmacyOrderPayable(order.status) ? (
        !payOpen ? (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton title={`Pay ${naira(order.payableKobo)}`} onPress={() => setPayOpen(true)} />
            </View>
          </View>
        ) : (
          <PayWithCreditPanel
            order={order}
            onPaid={() => {
              onChanged();
            }}
            onFallbackToCard={openCardPayment}
          />
        )
      ) : null}
    </Card>
  );
}

/**
 * "Your pharmacy orders" — native counterpart to
 * apps/web/src/app/(dashboard)/patient/pharmacy-orders-list.tsx: every
 * pharmacy_orders row this patient has, with a Platform-Credit-first "Pay"
 * affordance on anything still pending_payment and a card-payment fallback
 * via the system browser. See lib/prescription-renewal.ts's module comment
 * for why order CREATION isn't ported here (no live pharmacy to choose from
 * yet) and why the payment step calls the RPC directly rather than through a
 * new Next.js passthrough route.
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
