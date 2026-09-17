import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { koboToNaira, nairaToKobo } from "@tarragon/shared";
import { loadFinancialProfile, type FinancialProfile } from "@/lib/financial-profile";
import {
  loadPlatformCreditState,
  platformCreditSuggestedAmountsKobo,
  startPlatformCreditTopup,
  PLATFORM_CREDIT_ENTRY_LABEL,
  type PlatformCreditState,
} from "@/lib/platform-credit";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, radius, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/components";

const naira = (kobo: number) => `₦${koboToNaira(kobo).toLocaleString()}`;

const amountInputStyle = {
  flex: 1,
  height: 38,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  fontSize: 14,
  color: colors.ink,
};

/**
 * Platform credit balance + top-up — mirrors
 * apps/web/src/components/platform-credit-card.tsx. A general-purpose
 * prepaid balance (not tied to one service, unlike a care voucher), read
 * natively over the /api/mobile/platform-credit/* passthrough routes.
 * "Top up" opens the real Paystack checkout in the system browser and
 * refreshes on return — same idiom as services-screen.tsx's
 * openServicesPage, not the weaker "open and forget" pattern used
 * elsewhere on this screen for the web-only card flows.
 */
function PlatformCreditSection() {
  const [state, setState] = useState<PlatformCreditState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingAmountKobo, setStartingAmountKobo] = useState<number | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customNaira, setCustomNaira] = useState("");
  const [customSubmitting, setCustomSubmitting] = useState(false);
  const [topupError, setTopupError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadPlatformCreditState();
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

  const pending = startingAmountKobo !== null || customSubmitting;

  /** Starts a top-up for a fixed suggested amount, then hands the caller
   * off to the real Paystack checkout in the system browser and refreshes
   * on return — same "open then refresh" idiom as services-screen.tsx's
   * openServicesPage, not the weaker "open and forget" pattern this screen
   * otherwise uses for the web-only card flows below. */
  async function runTopUp(amountKobo: number): Promise<void> {
    setTopupError(null);
    const result = await startPlatformCreditTopup(amountKobo);
    if (!result.ok) {
      setTopupError(result.error);
      return;
    }
    await WebBrowser.openBrowserAsync(result.data);
    void refresh();
  }

  async function handlePresetTopUp(amountKobo: number) {
    setStartingAmountKobo(amountKobo);
    await runTopUp(amountKobo);
    setStartingAmountKobo(null);
  }

  async function handleCustomTopUp() {
    const amountKobo = nairaToKobo(Number(customNaira));
    if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
      setTopupError("Enter how much you'd like to add.");
      return;
    }
    setCustomSubmitting(true);
    await runTopUp(amountKobo);
    setCustomSubmitting(false);
  }

  if (loading) {
    return (
      <Card style={{ alignItems: "center", paddingVertical: 20 }}>
        <ActivityIndicator color={colors.brand} />
      </Card>
    );
  }

  if (error || !state) {
    return (
      <Card>
        <ErrorText>{error ?? "Could not load your platform credit"}</ErrorText>
      </Card>
    );
  }

  const suggested = platformCreditSuggestedAmountsKobo(state.config);

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Platform credit</Text>
      <MutedText>
        Fund your account once and use it whenever you buy a service. It never expires and can&apos;t be
        withdrawn or transferred — only ever spent here.
      </MutedText>

      <View>
        <MutedText>Your balance</MutedText>
        <Text style={{ fontSize: 22, fontWeight: "700", color: colors.ink }}>{naira(state.balanceKobo)}</Text>
        {state.promoBalanceKobo > 0 && (
          <MutedText>Includes {naira(state.promoBalanceKobo)} of promotional credit.</MutedText>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Add to your balance</Text>
        {topupError && <ErrorText>{topupError}</ErrorText>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {suggested.map((amountKobo) => (
            <SecondaryButton
              key={amountKobo}
              title={naira(amountKobo)}
              loading={startingAmountKobo === amountKobo}
              disabled={pending}
              onPress={() => void handlePresetTopUp(amountKobo)}
            />
          ))}
          <SecondaryButton
            title={customOpen ? "Cancel" : "Custom amount"}
            disabled={pending}
            onPress={() => setCustomOpen(!customOpen)}
          />
        </View>

        {customOpen && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TextInput
              placeholder="Amount in ₦"
              placeholderTextColor={colors.faint}
              keyboardType="number-pad"
              value={customNaira}
              onChangeText={setCustomNaira}
              style={amountInputStyle}
            />
            <PrimaryButton
              title="Add funds"
              loading={customSubmitting}
              disabled={pending}
              onPress={() => void handleCustomTopUp()}
            />
          </View>
        )}
      </View>

      {state.ledger.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Recent activity</Text>
          {state.ledger.slice(0, 5).map((entry) => (
            <View
              key={entry.id}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}
            >
              <Text style={{ fontSize: 12.5, color: colors.ink, flex: 1 }}>
                {PLATFORM_CREDIT_ENTRY_LABEL[entry.entry_type] ?? entry.entry_type}
                {entry.description ? ` — ${entry.description}` : ""}
              </Text>
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>
                {entry.entry_type === "topup" || entry.entry_type === "admin_grant" ? "+" : "−"}
                {naira(entry.amount_kobo)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

const ORDER_TYPE_LABEL: Record<string, string> = {
  lab: "lab order",
  pharmacy: "pharmacy order",
  referral: "specialist referral",
};

const VOUCHER_TONE: Record<string, "brand" | "neutral"> = {
  active: "brand",
  reserved: "neutral",
  redeemed: "neutral",
  expired: "neutral",
  cancelled: "neutral",
};

const REFUND_TONE: Record<string, "brand" | "neutral"> = {
  due: "neutral",
  refunded: "brand",
  failed: "neutral",
};

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

interface FinancialProfileScreenProps {
  userId: string;
}

/**
 * "What have I paid, what am I on, what's still moving" — mirrors
 * apps/web/.../financial-profile/page.tsx section for section. Read-only;
 * "Pay my share" and any other checkout step opens the web page in the
 * system browser rather than reimplementing Paystack initiation here.
 */
export function FinancialProfileScreen({ userId }: FinancialProfileScreenProps) {
  const [profile, setProfile] = useState<FinancialProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFinancialProfile(userId)
      .then((result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setProfile(result.data);
      })
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={{ flex: 1, padding: spacing.screen, backgroundColor: colors.background }}>
        <ErrorText>{error ?? "Could not load your finances"}</ErrorText>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View>
        <ScreenTitle>Your finances</ScreenTitle>
        <MutedText>Your services, vouchers, transactions, and anything still being refunded, all in one place.</MutedText>
      </View>

      <View>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 8 }}>Your services</Text>
        {profile.activeServices.length === 0 && <MutedText>No active services yet.</MutedText>}
        {profile.activeServices.map((s) => (
          <Card key={s.id} style={{ gap: 2, marginBottom: 8 }}>
            <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>
              {s.service_product?.name ?? "Service"}
            </Text>
            <MutedText>
              {naira(s.payable_kobo ?? 0)} {s.currency}
              {s.expires_at ? ` · runs until ${when(s.expires_at)}` : ""}
            </MutedText>
          </Card>
        ))}
      </View>

      <PlatformCreditSection />

      <View>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 8 }}>Recent payment issues</Text>
        <MutedText>Your card details are not stored with us. A failed charge means Paystack declined it, not that anything on our side went wrong.</MutedText>
        {profile.recentFailures.length === 0 ? (
          <MutedText>No recent payment problems.</MutedText>
        ) : (
          profile.recentFailures.map((f) => (
            <MutedText key={f.id}>
              {when(f.created_at)}: {f.error}
            </MutedText>
          ))
        )}
      </View>

      {profile.pendingShares.length > 0 && (
        <View>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 8 }}>Your share of a split bill</Text>
          <MutedText>Someone supporting you paid part of one of your bills. This is the reduced amount left for you to pay yourself.</MutedText>
          {profile.pendingShares.map((share) => (
            <Card key={share.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
              <Text style={{ fontSize: 13.5, color: colors.ink, flex: 1 }}>
                {ORDER_TYPE_LABEL[share.transaction_subsidy?.order_type ?? ""] ?? "bill"} ·{" "}
                <Text style={{ fontWeight: "700" }}>{naira(share.amount_minor)}</Text>
              </Text>
              <SecondaryButton
                title="Pay my share"
                onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/financial-profile`)}
              />
            </Card>
          ))}
        </View>
      )}

      <View>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 8 }}>Care vouchers</Text>
        {profile.vouchers.length === 0 ? (
          <MutedText>No vouchers yet.</MutedText>
        ) : (
          profile.vouchers.map((v) => (
            <Card key={v.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <Text style={{ fontSize: 13, color: colors.ink, flex: 1 }}>
                {v.sku_name ?? (v.kind === "reward_discount" ? "Reward credit" : "Care voucher")}{" "}
                <Text style={{ color: colors.faint }}>{v.voucher_number}</Text>
                {"\n"}
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {naira(v.amount_paid_kobo)} of {naira(v.face_value_kobo)}
                </Text>
              </Text>
              <Badge tone={VOUCHER_TONE[v.status] ?? "neutral"}>{v.status}</Badge>
            </Card>
          ))
        )}
      </View>

      {profile.refunds.length > 0 && (
        <View>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 8 }}>Refunds in progress</Text>
          <MutedText>Refunds go back to the original card and are processed daily.</MutedText>
          {profile.refunds.map((r) => (
            <Card key={r.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
              <Text style={{ fontSize: 13, color: colors.ink, flex: 1 }}>
                {naira(r.amount_minor)} {r.currency} via {r.provider}
              </Text>
              <Badge tone={REFUND_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
            </Card>
          ))}
        </View>
      )}

      <View>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 8 }}>Transaction history</Text>
        {profile.transactions.length === 0 ? (
          <MutedText>No transactions yet.</MutedText>
        ) : (
          profile.transactions.map((t) => (
            <Card key={t.entry_id} style={{ gap: 2, marginBottom: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink, flex: 1 }}>{t.service_label}</Text>
                <Badge tone={t.status === "completed" ? "brand" : "neutral"}>{t.status}</Badge>
              </View>
              <MutedText>
                {when(t.posted_at)} · {t.direction === "money_in" ? t.recipient_label : t.payer_label}
              </MutedText>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>
                {t.direction === "money_out" ? "−" : ""}
                {naira(t.amount_minor)}
              </Text>
            </Card>
          ))
        )}
      </View>
    </ScrollView>
  );
}
