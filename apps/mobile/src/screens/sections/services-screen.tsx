import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import type { Currency } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { cancelPendingServicePurchase, loadServicesState, formatPrice, type ServicesState } from "@/lib/services";
import { PLATFORM_URL } from "@/lib/platform-url";
import { space, useTheme } from "@/ui/design";
import { AppText, Badge, Button, Card, InlineAlert, ListItem, Screen, Skeleton, SkeletonGroup } from "@/ui/kit";

function when(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" });
}

const PAST_STATUS_KEY: Record<string, MessageKey> = {
  pending_payment: "services.past.pending_payment",
  expired: "services.past.expired",
  cancelled: "services.past.cancelled",
  refunded: "services.past.refunded",
  failed: "services.past.failed",
};

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
 * Buying a specific product is a card payment (or promo code) on the web:
 * "Buy" hands off to the equivalent web page, same pattern as Screening
 * Days' "Pay" and Financial Profile's "Pay my share"
 * (WebBrowser.openBrowserAsync, not a second checkout implementation).
 */
export function ServicesScreen() {
  const { colors } = useTheme();
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ServicesState | null>(null);
  const [failed, setFailed] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelFailed, setCancelFailed] = useState(false);

  const refresh = useCallback(async () => {
    const result = await loadServicesState();
    if (result.ok) {
      setState(result.data);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [refresh]);

  function retry() {
    setLoading(true);
    refresh()
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }

  async function openServicesPage() {
    await WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/subscription`);
    void refresh();
  }

  /** Same "Not right now" action as the web My Services page's payment-failure
   * banner / mobile's Overview payment-issue-card: reuses the shared
   * cancelPendingServicePurchase RPC wrapper rather than a second
   * implementation. This is the one place a stale pending_payment purchase is
   * reachable once its 30-minute grace period has passed and it has scrolled
   * off the Overview card (or a patient never saw it there). */
  async function handleCancelPending(purchaseId: string) {
    if (cancellingId) return;
    setCancellingId(purchaseId);
    setCancelFailed(false);
    const result = await cancelPendingServicePurchase(purchaseId);
    if (result.ok) {
      await refresh();
    } else {
      setCancelFailed(true);
    }
    setCancellingId(null);
  }

  if (loading) {
    return (
      <Screen>
        <SkeletonGroup label={tr("services.title")}>
          <View style={{ gap: space.lg }}>
            <Skeleton height={28} width="55%" />
            <Skeleton height={110} />
            <Skeleton height={150} />
          </View>
        </SkeletonGroup>
      </Screen>
    );
  }

  if (!state) {
    // A failed read is never shown as "nothing active".
    return (
      <Screen>
        <Card style={{ gap: space.md }}>
          <InlineAlert tone="info" message={tr("services.load_error")} />
          <Button title={tr("services.retry")} variant="secondary" onPress={retry} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>
          {tr("services.title")}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {tr("services.subtitle")}
        </AppText>
      </View>

      {failed ? <InlineAlert tone="info" message={tr("services.load_error")} /> : null}

      <Card style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {tr("services.active.heading")}
        </AppText>
        {state.active.length === 0 ? (
          <AppText variant="body" tone="textMuted">
            {tr("services.active.empty")}
          </AppText>
        ) : (
          state.active.map((purchase) => {
            const endLabel = when(purchase.expires_at);
            return (
              <View key={purchase.id} style={{ gap: space.xs }}>
                <AppText variant="bodyStrong">{purchase.service_product?.name ?? tr("services.unknown")}</AppText>
                <AppText variant="caption" tone="textMuted">
                  {endLabel ? tr("services.active.until", { date: endLabel }) : tr("services.active.no_expiry")}
                </AppText>
                <Badge label={tr("services.active.badge")} tone="positive" />
              </View>
            );
          })
        )}
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {tr("services.buy.heading")}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {tr("services.buy.body")}
        </AppText>
        {state.buyable.length === 0 ? (
          <AppText variant="body" tone="textMuted">
            {tr("services.buy.empty")}
          </AppText>
        ) : (
          <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: "hidden" }}>
            {state.buyable.map((product, index) => (
              <View key={product.id} style={index > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}>
                <ListItem
                  title={product.name}
                  subtitle={formatPrice(product.price_kobo, product.currency as Currency)}
                  trailing={<Button title={tr("services.buy.cta")} variant="secondary" fullWidth={false} onPress={() => void openServicesPage()} />}
                />
              </View>
            ))}
          </View>
        )}
        <Button title={tr("services.buy.manage")} onPress={() => void openServicesPage()} />
      </Card>

      {state.past.length > 0 ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="title" heading>
            {tr("services.past.heading")}
          </AppText>
          {state.past.map((purchase) => {
            const statusKey = PAST_STATUS_KEY[purchase.status];
            return (
              <View key={purchase.id} style={{ gap: space.sm }}>
                <AppText variant="bodyStrong">{purchase.service_product?.name ?? tr("services.unknown")}</AppText>
                <Badge label={statusKey ? tr(statusKey) : purchase.status.replace(/_/g, " ")} />
                {purchase.status === "pending_payment" ? (
                  <Button
                    title={tr("services.past.not_now")}
                    variant="ghost"
                    fullWidth={false}
                    loading={cancellingId === purchase.id}
                    disabled={cancellingId !== null}
                    onPress={() => void handleCancelPending(purchase.id)}
                  />
                ) : null}
              </View>
            );
          })}
          {cancelFailed ? <InlineAlert tone="danger" message={tr("services.cancel_error")} /> : null}
        </Card>
      ) : null}
    </Screen>
  );
}
