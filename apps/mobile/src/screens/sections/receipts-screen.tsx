import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";
import {
  loadPatientReceipts,
  type PatientReceipt,
  type PatientReceiptServiceType,
  type PatientReceiptStatus,
} from "@/lib/receipts";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, spacing } from "@/ui/theme";
import { Badge, ErrorText, GroupedList, GroupedListRow, MutedText } from "@/ui/components";

const SERVICE_ICON: Record<PatientReceiptServiceType, keyof typeof Ionicons.glyphMap> = {
  membership: "card-outline",
  laboratory: "flask-outline",
  pharmacy: "medkit-outline",
  referral: "git-network-outline",
  consultation: "calendar-outline",
  care_voucher: "receipt-outline",
};

const STATUS_LABEL: Record<PatientReceiptStatus, string> = {
  successful: "Paid",
  pending: "Pending",
  failed: "Failed",
  refunded: "Refunded",
  pending_refund: "Refund pending",
};

const STATUS_TONE: Record<PatientReceiptStatus, "brand" | "neutral"> = {
  successful: "brand",
  pending: "neutral",
  failed: "neutral",
  refunded: "neutral",
  pending_refund: "neutral",
};

const INVOICEABLE_STATUSES: PatientReceiptStatus[] = ["successful", "refunded"];

function formatAmount(amountMinor: number, currency: string): string {
  const cur = (["NGN", "GBP", "USD"] as const).includes(currency as Currency) ? (currency as Currency) : "NGN";
  return `${CURRENCY_SYMBOL[cur]}${fromMinorUnits(amountMinor, cur).toLocaleString()}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/** Every payment the patient made — membership, lab, pharmacy, referral,
 * video consultation, care-voucher instalments. Mirrors
 * apps/web/src/app/(dashboard)/patient/receipts/receipts-list.tsx; "Download
 * invoice" opens the existing PDF route in the system browser rather than
 * reimplementing a PDF viewer natively. */
export function ReceiptsScreen() {
  const [receipts, setReceipts] = useState<PatientReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadPatientReceipts();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setReceipts(result.data);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 18 }}
    >
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Receipts</Text>
        <MutedText>
          Every payment you have made: membership, labs, pharmacy, referrals, video
          consultations, and care vouchers.
        </MutedText>
      </View>

      {loading && <ActivityIndicator color={colors.brand} />}
      {error && <ErrorText>{error}</ErrorText>}
      {!loading && !error && receipts.length === 0 && (
        <MutedText>Nothing here yet. Payments you make will show up as receipts.</MutedText>
      )}

      {receipts.length > 0 && (
        <GroupedList>
          {receipts.map((r) => {
            // The headline figure is what actually left the patient's card,
            // not our listed price — those two only ever differ for a
            // 'membership' row where Paystack passed its own transaction fee
            // on to the customer. Falls back to the listed price for every
            // other service_type, and for a free/voucher-covered activation
            // with no real Paystack charge behind it.
            const headlineAmount = r.charged_amount_minor ?? r.amount_minor;
            const hasFee = r.fee_minor !== null && r.fee_minor > 0;
            const subtitle = hasFee
              ? `${formatDate(r.occurred_at)} · Ref ${r.reference.slice(0, 18)}\n${formatAmount(r.amount_minor, r.currency)} for the service + ${formatAmount(r.fee_minor!, r.currency)} card processing fee`
              : `${formatDate(r.occurred_at)} · Ref ${r.reference.slice(0, 18)}`;
            return (
              <GroupedListRow
                key={`${r.service_type}:${r.id}`}
                title={r.service_label}
                subtitle={subtitle}
                leading={<Ionicons name={SERVICE_ICON[r.service_type] ?? "card-outline"} size={20} color={colors.muted} />}
                trailing={
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>
                      {formatAmount(headlineAmount, r.currency)}
                    </Text>
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    {INVOICEABLE_STATUSES.includes(r.status) && (
                      <Text
                        onPress={() =>
                          void WebBrowser.openBrowserAsync(
                            `${PLATFORM_URL}/api/patient/receipts/${r.service_type}/${r.id}/invoice`
                          )
                        }
                        style={{ fontSize: 11, fontWeight: "700", color: colors.brand }}
                      >
                        Download invoice
                      </Text>
                    )}
                  </View>
                }
              />
            );
          })}
        </GroupedList>
      )}
    </ScrollView>
  );
}
