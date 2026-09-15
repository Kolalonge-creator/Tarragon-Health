import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { koboToNaira } from "@tarragon/shared";
import { loadFinancialProfile, type FinancialProfile } from "@/lib/financial-profile";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, ScreenTitle, SecondaryButton } from "@/ui/components";

const naira = (kobo: number) => `₦${koboToNaira(kobo).toLocaleString()}`;

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
