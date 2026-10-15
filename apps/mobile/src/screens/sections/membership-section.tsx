import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Switch, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { asLocale, en, t, type MessageKey } from "@tarragon/i18n";
import { estimatedBreakdown, formatNaira, type FeeEstimateSchedule, type Quote } from "@tarragon/commerce";
import { getProposedConfig, type ConfigValue } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { loadCatalogue, loadMembership, loadMyOrders, loadQuote, startCheckout, verifyOrder } from "@/lib/commerce/api";
import { EntitlementsSection } from "./entitlements-section";
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
  // S72 (19.9): the database's own quote for each item, with and without Health Points. Points lower only Tarragon's own fee, for one payment, if chosen.
  const [quotes, setQuotes] = useState<Record<string, { plain: Quote | null; points: Quote | null }>>({});
  const [usePoints, setUsePoints] = useState<Record<string, boolean>>({});
  const [entKey, setEntKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  // One retry key per item, made on first tap and kept until a refusal, so a double tap or a dropped connection is the SAME order.
  const keys = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    const [c, o, m] = await Promise.all([loadCatalogue(), loadMyOrders(), loadMembership()]);
    if (c.ok) {
      setItems(c.data);
      if (!beneficiary) {
        const entries = await Promise.all(c.data.map(async (i) => [i.code, { plain: await loadQuote(i.code, false), points: await loadQuote(i.code, true) }] as const));
        setQuotes(Object.fromEntries(entries));
      }
    }
    if (o.ok) setOrders(o.data);
    if (m.ok) setMembership(m.data);
    setEntKey((k) => k + 1);
    setLoaded(true);
  }, [beneficiary]);

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
    const q = quotes[item.code];
    const pointsLine = q?.points?.lines.find((l) => l.rule === "points" && l.applied) ?? null;
    const chosen = usePoints[item.code] === true && pointsLine !== null ? q?.points ?? null : q?.plain ?? null;
    const r = await startCheckout(item.code, key, beneficiary?.id, {
      ...(chosen === q?.points && chosen !== null && usePoints[item.code] === true ? { usePoints: true } : {}),
      // the total the person was shown: the database refuses the order if it now works out a different one
      ...(chosen !== null ? { expectedAmountKobo: chosen.amountDueKobo } : {}),
    });
    if (!r.ok) {
      if (!keepsRetryKey(r.code)) keys.current.delete(item.code);
      // "You are already a member" would be wrong when the order was for somebody else.
      setErrorKey(beneficiary && r.code === "already_member" ? "circle.pay.already_member" : checkoutErrorKey(r.code));
      setBusy(null);
      return;
    }
    // S71 (19.5): a sponsor pays the whole order. There is no payment page to open; the order is already paid.
    if (r.covered) {
      keys.current.delete(item.code);
      setNotice("sponsor.done.body");
      setBusy(null);
      await refresh();
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
      {beneficiary ? null : <EntitlementsSection refreshKey={entKey} />}
      <Text style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}>{beneficiary ? tr("circle.pay.who", { name: beneficiary.name }) : tr("shop.title")}</Text>
      {beneficiary ? <MutedText>{tr("circle.pay.note", { name: beneficiary.name })}</MutedText> : null}
      {beneficiary ? <MutedText>{tr("circle.pay.only_year")}</MutedText> : null}
      {!beneficiary && membership.isMember && membership.endsAt ? <MutedText>{tr("shop.member_until", { date: lagos(membership.endsAt) })}</MutedText> : null}
      {!beneficiary && membership.graceEndsAt ? <MutedText>{tr("shop.in_grace", { date: lagos(membership.graceEndsAt) })}</MutedText> : null}
      {items.length === 0 ? <MutedText>{tr("shop.not_open")}</MutedText> : null}
      {items.filter((item) => !beneficiary || item.kind === "membership").map((item) => {
        const q = quotes[item.code];
        const pointsLine = q?.points?.lines.find((l) => l.rule === "points" && l.applied) ?? null;
        const pointsOn = usePoints[item.code] === true && pointsLine !== null;
        const quote = (pointsOn ? q?.points : q?.plain) ?? null;
        const b = estimatedBreakdown(quote?.amountDueKobo ?? item.amountKobo, fee);
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
            {pointsLine !== null && q?.points && !beneficiary ? (
              <View style={{ gap: 4, marginTop: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <Text style={{ color: colors.ink, flexShrink: 1 }}>{tr("checkout.points.label")}</Text>
                  <Switch
                    value={pointsOn} onValueChange={(v) => setUsePoints((m) => ({ ...m, [item.code]: v }))}
                    accessibilityLabel={tr("checkout.points.label")}
                  />
                </View>
                <MutedText>{tr("checkout.points.saves", { points: q.points.pointsApplied, amount: naira(q.points.pointsReductionKobo) })}</MutedText>
                <MutedText>{tr("checkout.points.explain")}</MutedText>
              </View>
            ) : null}
            <MutedText>{tr("shop.no_renew")}</MutedText>
            {blocked ? null : <PrimaryButton title={busy === item.code ? tr("shop.paying") : tr("shop.pay")} onPress={() => confirmGift(item)} disabled={busy !== null} />}
          </Card>
        );
      })}
      {errorKey ? <ErrorText>{tr(errorKey)}</ErrorText> : null}
      {/* a transfer or USSD payment that has not landed is "waiting for your bank", never a failure (S71, 19.2) */}
      {notice === "shop.return.pending" ? <Text style={{ fontWeight: "700", color: colors.ink }}>{tr("shop.return.pending.title")}</Text> : null}
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
              <Text style={{ color: colors.ink }}>{o.amountKobo === 0 && o.sponsorShareKobo > 0 ? (o.sponsorName ? tr("sponsor.history_covered", { name: o.sponsorName }) : tr("sponsor.covered_generic")) : naira(o.totalKobo ?? o.amountKobo)}</Text>
              <MutedText>{tr(orderStateKey(o.state))}</MutedText>
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}
