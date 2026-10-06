import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { asLocale, en, t, type MessageKey } from "@tarragon/i18n";
import { estimatedBreakdown, formatNaira, type FeeEstimateSchedule } from "@tarragon/commerce";
import { getProposedConfig, type ConfigValue } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { loadCatalogue, loadMembership, loadMyOrders, startCheckout, verifyOrder } from "@/lib/commerce/api";
import { checkoutErrorKey, keepsRetryKey, orderStateKey, type CatalogueItem, type MembershipState, type OrderRow } from "@/lib/commerce/parse";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton } from "@/ui/legacy-kit";

const naira = (kobo: number) => `₦${formatNaira(kobo)}`;
const isKey = (k: string): k is MessageKey => Object.hasOwn(en, k);

function lagos(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/**
 * Membership and care packs (S25). Shows what is included, the price and an ESTIMATED processing fee labelled as one, then
 * opens Paystack's hosted page in the in-app browser. Only the item code and a retry key are sent; the price is read by the
 * server. When the browser closes the app asks the server (which asks Paystack) whether the order is paid: coming back from
 * the browser is never proof of payment. Nothing here stores or shows a balance (INV-09).
 */
/** Set when a supporter pays for someone in their Care Circle (S29): the order is for them, the card is the payer's own. */
export interface Beneficiary { id: string; name: string }

export function MembershipSection({ beneficiary }: { beneficiary?: Beneficiary }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const tr = useCallback((key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params), [locale]);
  const copy = useCallback((key: string) => (isKey(key) ? t(key, locale) : ""), [locale]);
  const fee = getProposedConfig<ConfigValue>("commerce.processing_fee_estimate").value as unknown as FeeEstimateSchedule;

  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [membership, setMembership] = useState<MembershipState>({ isMember: false, endsAt: null });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  // One retry key per item, made on first tap and kept until a refusal, so a double tap or a dropped connection is the SAME order.
  const keys = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    const [c, o, m] = await Promise.all([loadCatalogue(), loadMyOrders(), loadMembership()]);
    if (c.ok) setItems(c.data);
    if (o.ok) setOrders(o.data);
    if (m.ok) setMembership(m.data);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** For someone else the name and what happens come first, before any card is touched (S29c): they are asked to accept, and a no is a refund. */
  function confirmGift(item: CatalogueItem) {
    if (!beneficiary) {
      void pay(item);
      return;
    }
    Alert.alert(tr("circle.pay.confirm_title", { name: beneficiary.name }), tr("circle.pay.confirm_body", { name: beneficiary.name }), [
      { text: tr("circle.pay.confirm_no"), style: "cancel" },
      { text: tr("circle.pay.confirm_yes", { name: beneficiary.name }), onPress: () => void pay(item) },
    ]);
  }

  async function pay(item: CatalogueItem) {
    setErrorKey(null);
    setNotice(null);
    setBusy(item.code);
    let key = keys.current.get(item.code);
    if (!key) {
      key = Crypto.randomUUID();
      keys.current.set(item.code, key);
    }
    const r = await startCheckout(item.code, key, beneficiary?.id);
    if (!r.ok) {
      if (!keepsRetryKey(r.code)) keys.current.delete(item.code);
      // "You are already a member" would be wrong when the order was for somebody else.
      setErrorKey(beneficiary && r.code === "already_member" ? "circle.pay.already_member" : checkoutErrorKey(r.code));
      setBusy(null);
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(r.checkoutUrl);
    } finally {
      // Whatever the patient did in the browser, ask the server what is true.
      const v = await verifyOrder(r.reference);
      if (v?.state === "paid") {
        keys.current.delete(item.code);
        setNotice("shop.return.paid.body");
      } else if (v?.outcome === "mismatch") setNotice("shop.return.mismatch");
      else if (v?.state === "failed") setNotice("shop.return.failed");
      else setNotice("shop.return.pending");
      setBusy(null);
      await refresh();
    }
  }

  if (!loaded) return <ActivityIndicator />;
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}>{beneficiary ? tr("circle.pay.who", { name: beneficiary.name }) : tr("shop.title")}</Text>
      {beneficiary ? <MutedText>{tr("circle.pay.note", { name: beneficiary.name })}</MutedText> : null}
      {beneficiary ? <MutedText>{tr("circle.pay.only_year")}</MutedText> : null}
      {!beneficiary && membership.isMember && membership.endsAt ? <MutedText>{tr("shop.member_until", { date: lagos(membership.endsAt) })}</MutedText> : null}
      {items.length === 0 ? <MutedText>{tr("shop.not_open")}</MutedText> : null}
      {items.filter((item) => !beneficiary || item.kind === "membership").map((item) => {
        const b = estimatedBreakdown(item.amountKobo, fee);
        const blocked = !beneficiary && item.kind === "membership" && membership.isMember;
        return (
          <Card key={item.code}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{copy(item.nameKey)}</Text>
            <MutedText>{copy(item.descriptionKey)}</MutedText>
            <Text style={{ fontWeight: "600", color: colors.ink, marginTop: 8 }}>{tr("shop.included")}</Text>
            {item.includedKeys.map((k) => (
              <Text key={k} style={{ color: colors.ink }}>{`• ${copy(k)}`}</Text>
            ))}
            <Text style={{ color: colors.ink, marginTop: 8 }}>{`${tr("pay.fee.price")}: ${naira(b.priceKobo)}`}</Text>
            <Text style={{ color: colors.ink }}>{`${tr("pay.fee.line")}: ${tr("shop.fee.about", { amount: naira(b.feeKobo) })}`}</Text>
            <Text style={{ color: colors.ink, fontWeight: "700" }}>{`${tr("pay.fee.total")}: ${tr("shop.fee.about", { amount: naira(b.totalKobo) })}`}</Text>
            <MutedText>{tr("pay.fee.explain")}</MutedText>
            <MutedText>{tr("shop.fee.estimate")}</MutedText>
            <MutedText>{tr("shop.no_renew")}</MutedText>
            {blocked ? null : <PrimaryButton title={busy === item.code ? tr("shop.paying") : tr("shop.pay")} onPress={() => confirmGift(item)} disabled={busy !== null} />}
          </Card>
        );
      })}
      {errorKey ? <ErrorText>{tr(errorKey)}</ErrorText> : null}
      {notice ? <MutedText>{tr(notice)}</MutedText> : null}
      <Card>
        <Text style={{ fontWeight: "700", color: colors.ink }}>{tr("shop.history.title")}</Text>
        {orders.length === 0 ? <MutedText>{tr("shop.history.empty")}</MutedText> : null}
        {orders.map((o) => (
          <View key={o.orderId} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
            <View>
              <Text style={{ color: colors.ink }}>{copy(o.nameKey)}</Text>
              <MutedText>{lagos(o.paidAt ?? o.createdAt)}</MutedText>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ color: colors.ink }}>{naira(o.totalKobo ?? o.amountKobo)}</Text>
              <MutedText>{tr(orderStateKey(o.state))}</MutedText>
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}
