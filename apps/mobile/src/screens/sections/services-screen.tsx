import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { cancelPendingServicePurchase, loadServicesState, formatPrice, type ServicesState } from "@/lib/services";
import type { Currency } from "@tarragon/shared";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle } from "@/ui/components";

function when(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" });
}

/**
 * "My services" — mirrors apps/web/.../patient/subscription/subscription-manager.tsx:
 * the pay-per-service model has no "current plan," just whichever
 * service_purchases rows are currently active (has_feature_access unions
 * features across all of them) — a paid-and-active purchase can't be
 * cancelled or resumed, it's a one-off charge for a fixed window that
 * simply expires. An unpaid ('pending_payment') purchase can be closed
 * though (see the "Not right now" control below, reusing the same
 * cancelPendingServicePurchase RPC wrapper as the Overview payment-issue
 * card). Active/past are read natively (plain RLS-scoped reads); buying is
 * never done natively — a real Paystack checkout, promo-code redemption,
 * and free-tier instant activation all happen on the web page, same pattern
 * as Screening Days' "Pay" and Financial Profile's "Pay my share"
 * (WebBrowser.openBrowserAsync to the equivalent web page, not a second
 * checkout implementation).
 */
export function ServicesScreen() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ServicesState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadServicesState();
    if (result.ok) {
      setState(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refresh]);

  async function openServicesPage() {
    await WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/subscription`);
    void refresh();
  }

  /** Same "Not right now" action as the web My Services page's payment-failure
   * banner / mobile's Overview payment-issue-card — reuses the shared
   * cancelPendingServicePurchase RPC wrapper rather than a second
   * implementation. This is the one place a stale pending_payment purchase is
   * reachable once its 30-minute grace period has passed and it has scrolled
   * off the Overview card (or a patient never saw it there). */
  async function handleCancelPending(purchaseId: string) {
    setCancellingId(purchaseId);
    setCancelError(null);
    const result = await cancelPendingServicePurchase(purchaseId);
    if (result.ok) {
      await refresh();
    } else {
      setCancelError("Could not close this — try again");
    }
    setCancellingId(null);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (!state) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.screen }}>
        <ErrorText>{error ?? "Could not load your services just now."}</ErrorText>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View>
        <ScreenTitle>My services</ScreenTitle>
        <MutedText>One-off purchases covering a fixed window each. Nothing auto-renews. Buy again any time to extend.</MutedText>
      </View>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Your active services</Text>
        {state.active.length === 0 ? (
          <MutedText>
            Nothing active yet. The app itself is free; you only ever pay for a doctor&apos;s time. Buy a
            service when you want one.
          </MutedText>
        ) : (
          <View style={{ gap: 10 }}>
            {state.active.map((purchase) => {
              const endLabel = when(purchase.expires_at);
              return (
                <View key={purchase.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>
                      {purchase.service_product?.name ?? "Unknown service"}
                    </Text>
                    <MutedText>{endLabel ? `Active until ${endLabel}` : "Active, no expiry"}</MutedText>
                  </View>
                  <Badge tone="brand">Active</Badge>
                </View>
              );
            })}
          </View>
        )}
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Buy a service</Text>
        <MutedText>One-off payment, no auto-renewal. Opens the full patient app to pay and apply a promo code.</MutedText>
        {state.buyable.length === 0 ? (
          <MutedText>You already have everything currently on offer.</MutedText>
        ) : (
          <View style={{ gap: 6 }}>
            {state.buyable.map((product) => (
              <Text key={product.id} style={{ fontSize: 13, color: colors.ink }}>
                {product.name} ({formatPrice(product.price_kobo, product.currency as Currency)})
              </Text>
            ))}
          </View>
        )}
        <PrimaryButton title="Buy or manage services" onPress={openServicesPage} />
      </Card>

      {state.past.length > 0 && (
        <Card style={{ gap: 10 }}>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Past services</Text>
          <View style={{ gap: 8 }}>
            {state.past.map((purchase) => (
              <View key={purchase.id} style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ fontSize: 13, color: colors.ink, flex: 1 }}>{purchase.service_product?.name ?? "Unknown service"}</Text>
                  <Badge>{purchase.status === "pending_payment" ? "Payment pending" : purchase.status}</Badge>
                </View>
                {purchase.status === "pending_payment" && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Not right now"
                    accessibilityState={{ disabled: cancellingId === purchase.id }}
                    disabled={cancellingId === purchase.id}
                    onPress={() => handleCancelPending(purchase.id)}
                    style={{ alignSelf: "flex-end", opacity: cancellingId === purchase.id ? 0.6 : 1 }}
                  >
                    {cancellingId === purchase.id ? (
                      <ActivityIndicator size="small" color={colors.muted} />
                    ) : (
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>Not right now</Text>
                    )}
                  </Pressable>
                )}
              </View>
            ))}
          </View>
          {cancelError && <ErrorText>{cancelError}</ErrorText>}
        </Card>
      )}
    </ScrollView>
  );
}
