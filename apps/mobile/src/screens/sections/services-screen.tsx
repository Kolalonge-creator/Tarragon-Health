import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { cancelPendingServicePurchase, loadServicesState, formatPrice, type ServiceProduct, type ServicesState } from "@/lib/services";
import { loadPlatformCreditState, spendPlatformCreditOnService, hasEnoughPlatformCredit } from "@/lib/platform-credit";
import type { Currency } from "@tarragon/shared";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/components";

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
 * card). Active/past are read natively (plain RLS-scoped reads).
 *
 * Buying a specific product tries platform credit first (added 2026-09-18):
 * if the caller's balance already covers the price, "Buy" settles it
 * in-app via spendPlatformCreditOnService and never opens a browser at all.
 * Short on balance (or anything else that isn't a clean credit purchase —
 * a promo code, card payment, or free-tier instant activation), it falls
 * back to the existing web hand-off, same pattern as Screening Days' "Pay"
 * and Financial Profile's "Pay my share" (WebBrowser.openBrowserAsync to the
 * equivalent web page, not a second checkout implementation).
 */
export function ServicesScreen() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ServicesState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [creditBalanceKobo, setCreditBalanceKobo] = useState(0);
  const [buyingCode, setBuyingCode] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadServicesState();
    if (result.ok) {
      setState(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }, []);

  /** Best-effort — a failed credit-balance read just means every "Buy"
   * button falls back to the browser hand-off (balance defaults to 0), it
   * never blocks the rest of the screen from loading. */
  const refreshCredit = useCallback(async () => {
    const result = await loadPlatformCreditState();
    if (result.ok) setCreditBalanceKobo(result.data.balanceKobo);
  }, []);

  useEffect(() => {
    Promise.all([refresh(), refreshCredit()])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refresh, refreshCredit]);

  async function openServicesPage() {
    await WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/subscription`);
    void refresh();
    void refreshCredit();
  }

  /**
   * Prefers an in-app platform credit spend when the balance already covers
   * the price — settles it directly, no browser at all. Otherwise (short on
   * balance, or a credit purchase that fails for any other reason — the
   * price moved, the balance changed between the check and the call, etc.)
   * falls back to the existing web checkout unchanged, same "open then
   * refresh" idiom as openServicesPage.
   */
  async function handleBuy(product: ServiceProduct) {
    if (!hasEnoughPlatformCredit(creditBalanceKobo, product.price_kobo)) {
      await openServicesPage();
      return;
    }
    setBuyingCode(product.code);
    setBuyError(null);
    const result = await spendPlatformCreditOnService(product.code);
    setBuyingCode(null);
    if (result.ok && result.data.ok) {
      await Promise.all([refresh(), refreshCredit()]);
      return;
    }
    if (result.ok && !result.data.ok && result.data.reason === "insufficient_balance") {
      // Balance moved since the check above (e.g. spent elsewhere) — fall
      // back to the browser rather than surfacing a dead end.
      await openServicesPage();
      return;
    }
    setBuyError("Could not complete this purchase with your platform credit — try again, or buy on the full app.");
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
        <MutedText>
          One-off payment, no auto-renewal. Covered by your platform credit balance, it&apos;s bought right here
          — otherwise this opens the full patient app to pay by card or apply a promo code.
        </MutedText>
        {state.buyable.length === 0 ? (
          <MutedText>You already have everything currently on offer.</MutedText>
        ) : (
          <View style={{ gap: 8 }}>
            {state.buyable.map((product) => {
              const coveredByCredit = hasEnoughPlatformCredit(creditBalanceKobo, product.price_kobo);
              return (
                <View
                  key={product.id}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{product.name}</Text>
                    <MutedText>
                      {formatPrice(product.price_kobo, product.currency as Currency)}
                      {coveredByCredit && product.price_kobo > 0 ? " · covered by your platform credit" : ""}
                    </MutedText>
                  </View>
                  <SecondaryButton
                    title={coveredByCredit && product.price_kobo > 0 ? "Buy with credit" : "Buy"}
                    loading={buyingCode === product.code}
                    disabled={buyingCode !== null}
                    onPress={() => void handleBuy(product)}
                  />
                </View>
              );
            })}
          </View>
        )}
        {buyError && <ErrorText>{buyError}</ErrorText>}
        <PrimaryButton title="Manage all services" onPress={openServicesPage} />
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
