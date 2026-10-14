import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";
import {
  loadPatientReceipts,
  type PatientReceipt,
  type PatientReceiptServiceType,
  type PatientReceiptStatus,
} from "@/lib/receipts";
import { asLocale, en, t, type MessageKey } from "@tarragon/i18n";
import { formatNaira } from "@tarragon/commerce";
import { PLATFORM_URL } from "@/lib/platform-url";
import { useUiLanguage } from "@/lib/ui-language";
import { loadMyOrders, requestRefund } from "@/lib/commerce/api";
import { orderStateKey, type OrderRow } from "@/lib/commerce/parse";
import { radius, spacing } from "@/ui/theme";
import { placeholderColorFor, useLegacyColors, useTheme } from "@/ui/design";
import { Badge, Card, ErrorText, GroupedList, GroupedListRow, MutedText, SecondaryButton } from "@/ui/legacy-kit";

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

const isKey = (k: string): k is MessageKey => Object.hasOwn(en, k);
const REFUND_STATE_KEY: Record<string, MessageKey> = {
  completed: "receipts.refund.completed", rejected: "receipts.refund.rejected", failed: "receipts.refund.failed",
};
const REFUND_RESULT_KEY: Record<string, MessageKey> = {
  requested: "refund.request.success", already_requested: "refund.request.already_requested", order_not_paid: "refund.request.order_not_paid",
  reason_too_short: "refund.request.reason_placeholder", covered_by_sponsor: "receipts.refund.covered", not_found: "receipts.refund.supporter",
};

/**
 * The catalogue orders (S72, 19.8): what was bought, what a sponsor covered, and a refund request for the ones the person paid for themselves. The same
 * database function the website calls decides everything (request_order_refund). Plain text, so it stays light on a slow connection (S34).
 */
function OrdersAndRefunds() {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await loadMyOrders();
    if (r.ok) setOrders(r.data);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function submit(orderId: string) {
    setBusy(true); setNotice(null);
    const r = await requestRefund(orderId, reason.trim());
    setBusy(false);
    setNotice(r ? (REFUND_RESULT_KEY[r.result] ?? "refund.request.not_eligible") : "refund.request.not_eligible");
    if (r?.result === "requested") { setOpen(null); setReason(""); await refresh(); }
  }

  if (orders.length === 0) return null;
  return (
    <Card>
      <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{tr("receipts.orders.title")}</Text>
      {orders.map((o) => {
        const covered = o.amountKobo === 0 && o.sponsorShareKobo > 0;
        const canAsk = o.state === "paid" && o.amountKobo > 0 && o.isBuyer && o.refundState === null;
        return (
          <View key={o.orderId} style={{ paddingVertical: 8, gap: 6 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: colors.ink, flexShrink: 1 }}>{isKey(o.nameKey) ? t(o.nameKey, locale) : ""}</Text>
              <Text style={{ color: colors.ink }}>{covered ? (o.sponsorName ? tr("sponsor.history_covered", { name: o.sponsorName }) : tr("sponsor.covered_generic")) : `\u20A6${formatNaira(o.totalKobo ?? o.amountKobo)}`}</Text>
            </View>
            <MutedText>{tr(orderStateKey(o.state))}</MutedText>
            {o.refundState !== null ? <MutedText>{tr(REFUND_STATE_KEY[o.refundState] ?? "receipts.refund.pending")}</MutedText> : null}
            {canAsk && open !== o.orderId ? <SecondaryButton title={tr("refund.request.button")} onPress={() => { setOpen(o.orderId); setNotice(null); }} /> : null}
            {canAsk && open === o.orderId ? (
              <View style={{ gap: 8 }}>
                <Text style={{ color: colors.ink, fontWeight: "600" }}>{tr("refund.request.reason_label")}</Text>
                <TextInput
                  keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={reason} onChangeText={setReason} multiline maxLength={500}
                  placeholder={tr("refund.request.reason_placeholder")} accessibilityLabel={tr("refund.request.reason_label")}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: 10, paddingVertical: 10, minHeight: 72, color: colors.ink }}
                />
                <SecondaryButton title={busy ? tr("refund.request.submitting") : tr("refund.request.submit")} onPress={() => void submit(o.orderId)} disabled={busy || reason.trim().length < 5} />
              </View>
            ) : null}
            {!o.isBuyer && o.state === "paid" ? <MutedText>{tr("receipts.refund.supporter")}</MutedText> : null}
          </View>
        );
      })}
      {notice ? <MutedText>{tr(notice)}</MutedText> : null}
    </Card>
  );
}

/** Every payment the patient made — membership, lab, pharmacy, referral,
 * video consultation, care-voucher instalments. Mirrors
 * apps/web/src/app/(dashboard)/patient/receipts/receipts-list.tsx; "Download
 * invoice" opens the existing PDF route in the system browser rather than
 * reimplementing a PDF viewer natively. */
export function ReceiptsScreen() {
  const colors = useLegacyColors();
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

      <OrdersAndRefunds />

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
                        style={{ fontSize: 11, fontWeight: "700", color: colors.brandPressed }}
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
