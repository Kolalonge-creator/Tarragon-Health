import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  formatServicePrice,
  isPurchaseCurrentlyActive,
  loadActiveServiceProducts,
  loadMyServicePurchases,
  type ServiceProduct,
  type ServicePurchase,
} from "@/lib/services";
import { postServicesCheckout } from "@/lib/api";
import { colors, radius, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle } from "@/ui/components";

/** `tarragonhealth://services-callback` — the deep link Paystack's hosted
 * checkout redirects back to. expo-web-browser's openAuthSessionAsync
 * recognises any navigation to this URL as "finished" and hands control
 * back to the app; it is never a screen of its own. */
const CHECKOUT_CALLBACK_URL = "tarragonhealth://services-callback";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" });
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Payment pending",
  cancelled: "Cancelled",
  expired: "Expired",
  refunded: "Refunded",
};

/**
 * "My services" — the pay-per-service billing screen (2026-08-31 cutover,
 * see CLAUDE.md: the app is free, Tarragon charges only for a doctor's
 * time, one-off per service_products row). Mirrors
 * apps/web/.../patient/subscription/subscription-manager.tsx. The only
 * piece that cannot be a plain native form is the actual card entry:
 * Paystack collects that on its own hosted page (never ours, on web
 * either — see lib/paystack/transactions.ts), opened here via
 * expo-web-browser's openAuthSessionAsync rather than the app's own
 * WebViewScreen, so this stays a real native purchase flow with a proper
 * return, not a content embed.
 */
export function ServicesScreen() {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ServiceProduct[]>([]);
  const [purchases, setPurchases] = useState<ServicePurchase[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [buyingCode, setBuyingCode] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [buyMessage, setBuyMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [productsResult, purchasesResult] = await Promise.all([loadActiveServiceProducts(), loadMyServicePurchases()]);
    if (!productsResult.ok) {
      setLoadError(productsResult.error);
      return;
    }
    if (!purchasesResult.ok) {
      setLoadError(purchasesResult.error);
      return;
    }
    setLoadError(null);
    setProducts(productsResult.data);
    setPurchases(purchasesResult.data);
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => setLoadError("Could not load your services."))
      .finally(() => setLoading(false));
  }, [refresh]);

  async function buy(product: ServiceProduct) {
    setBuyError(null);
    setBuyMessage(null);
    setBuyingCode(product.code);
    try {
      const result = await postServicesCheckout(product.code, CHECKOUT_CALLBACK_URL, promoCode);
      if (result.error) {
        setBuyError(result.error);
        return;
      }
      if (result.activated) {
        setBuyMessage("Added. This is active now.");
        await refresh();
        return;
      }
      if (result.checkoutUrl) {
        await WebBrowser.openAuthSessionAsync(result.checkoutUrl, CHECKOUT_CALLBACK_URL);
        setBuyMessage("We're confirming your payment. If it succeeded, this activates automatically within a minute or two.");
        await refresh();
        return;
      }
      setBuyError("Could not start checkout.");
    } finally {
      setBuyingCode(null);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const active = purchases.filter(isPurchaseCurrentlyActive);
  const activeProductIds = new Set(active.map((p) => p.service_product_id));
  const buyable = products.filter((p) => !activeProductIds.has(p.id));
  const past = purchases.filter((p) => !isPurchaseCurrentlyActive(p));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <View>
        <ScreenTitle>My services</ScreenTitle>
        <MutedText>
          One-off purchases covering a fixed window each. Nothing auto-renews. Buy again any time to
          extend.
        </MutedText>
      </View>

      {loadError && (
        <Card>
          <ErrorText>{loadError}</ErrorText>
        </Card>
      )}

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Your active services</Text>
        {active.length === 0 ? (
          <MutedText>
            Nothing active yet. The app itself is free; you only ever pay for a doctor&apos;s time.
            Buy a service when you want one.
          </MutedText>
        ) : (
          active.map((purchase) => {
            const endLabel = formatDate(purchase.expires_at);
            return (
              <View
                key={purchase.id}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>
                    {purchase.service_product_name ?? "Unknown service"}
                  </Text>
                  <MutedText>{endLabel ? `Active until ${endLabel}` : "Active, no expiry"}</MutedText>
                </View>
                <Badge tone="brand">Active</Badge>
              </View>
            );
          })
        )}
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Buy a service</Text>
        <MutedText>One-off payment, no auto-renewal.</MutedText>
        {buyError && <ErrorText>{buyError}</ErrorText>}
        {buyMessage && <MutedText>{buyMessage}</MutedText>}

        {buyable.length === 0 ? (
          <MutedText>You already have everything currently on offer.</MutedText>
        ) : (
          <>
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Promo code (optional)</Text>
              <TextInput
                value={promoCode}
                onChangeText={setPromoCode}
                placeholder="e.g. WELCOME10"
                autoCapitalize="characters"
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.control,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  fontSize: 14,
                  color: colors.ink,
                }}
              />
            </View>
            <View style={{ gap: 8 }}>
              {buyable.map((product) => (
                <View key={product.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{product.name}</Text>
                    {product.description && <MutedText>{product.description}</MutedText>}
                  </View>
                  <PrimaryButton
                    title={`${product.price_kobo === 0 ? "Switch to" : "Buy"} ${formatServicePrice(product.price_kobo, product.currency)}`}
                    onPress={() => buy(product)}
                    loading={buyingCode === product.code}
                    disabled={buyingCode !== null}
                  />
                </View>
              ))}
            </View>
          </>
        )}
      </Card>

      {past.length > 0 && (
        <Card style={{ gap: 8 }}>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Past services</Text>
          {past.map((purchase) => (
            <View key={purchase.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
              <Text style={{ fontSize: 13, color: colors.muted, flex: 1 }}>{purchase.service_product_name ?? "Unknown service"}</Text>
              <Badge>{STATUS_LABEL[purchase.status] ?? purchase.status}</Badge>
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
