import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Switch, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { asLocale, en, t, type MessageKey } from "@tarragon/i18n";
import { RENEWAL_CONSENT_TICKED_BY_DEFAULT, arrangeItems, formatNaira, isTier, ladderActive, monthlyEquivalentKobo, monthlyFramingKobo, panelIncluded, UPGRADE_CODE, type FeeEstimateSchedule, type NotIncludedEntry, type PriceChangeNotice, type Quote } from "@tarragon/commerce";
import { buildCheckoutView, itemisedRows, returnNotice } from "@/lib/commerce/checkout-view";
import { HmoEligibilitySection } from "./hmo-eligibility-section";
import { getProposedConfig, type ConfigValue } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { needsPlusStateSetup, plusStateSetupErrorKey } from "@/lib/commerce/plus-state-setup";
import { loadAutoRenewEnabled, loadCatalogue, loadMembership, loadMyOrders, loadNotIncluded, loadPlusStates, loadPriceChangeNotices, loadQuote, setMyPlusState, startCheckout, verifyOrder } from "@/lib/commerce/api";
import { EntitlementsSection } from "./entitlements-section";
import { RefundRuleBlock } from "./refund-blocks";
import { RenewalSection } from "./renewal-section";
import { checkoutErrorKey, keepsRetryKey, orderStateKey, type CatalogueItem, type MembershipState, type OrderRow, type PlusState } from "@/lib/commerce/parse";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

const naira = (kobo: number) => `₦${formatNaira(kobo)}`;

// Whether the renewal switch starts on is one shared constant (RENEWAL_CONSENT_TICKED_BY_DEFAULT in @tarragon/commerce), the same on web and mobile.
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
  // OFF until the founder confirms it (pricing.transparency, OQ-WP1-02): then no monthly figure is shown
  const monthlyOn = (getProposedConfig<ConfigValue>("pricing.transparency").value as unknown as { monthly_equivalent?: { enabled?: unknown } }).monthly_equivalent?.enabled === true;

  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [membership, setMembership] = useState<MembershipState>({ isMember: false, endsAt: null });
  const [notIncluded, setNotIncluded] = useState<Readonly<Record<string, readonly NotIncludedEntry[]>>>({});
  const [priceNotices, setPriceNotices] = useState<PriceChangeNotice[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Membership Plus is bought for an approved state where blood is collected; only these can be chosen, and the choice stays fixed once paid
  const [plusStates, setPlusStates] = useState<PlusState[] | null>(null);
  const [plusStatesFailed, setPlusStatesFailed] = useState(false);
  const [collectionState, setCollectionState] = useState("");
  // a Plus member who has no state yet (employer seat, earlier grant) chooses it once
  const [setupState, setSetupState] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<MessageKey | null>(null);
  // S72 (19.9): the database's own quote for each item, with and without Health Points. Points lower only Tarragon's own fee, for one payment, if chosen.
  const [quotes, setQuotes] = useState<Record<string, { plain: Quote | null; points: Quote | null }>>({});
  const [usePoints, setUsePoints] = useState<Record<string, boolean>>({});
  const [entKey, setEntKey] = useState(0);
  // Automatic renewal: offered only while the platform switch is on, only for the person's OWN Membership (never a gift), never when they already hold one.
  const [renewSwitch, setRenewSwitch] = useState(false);
  const [renew, setRenew] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  // The reference of an order that is still "waiting for your bank" (transfer or USSD), so the person can ask again without paying twice.
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // One retry key per item, made on first tap and kept until a refusal, so a double tap or a dropped connection is the SAME order.
  const keys = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    const [c, o, m, ni, pn, ps, rs] = await Promise.all([loadCatalogue(), loadMyOrders(), loadMembership(), loadNotIncluded(), loadPriceChangeNotices(), loadPlusStates(), loadAutoRenewEnabled()]);
    setRenewSwitch(rs);
    setPlusStates(ps);
    setPlusStatesFailed(ps === null);
    // these two only add information; a failed read shows nothing extra, never a guess
    setNotIncluded(ni.ok ? ni.data : {});
    setPriceNotices(!beneficiary && pn.ok ? pn.data : []);
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

  /** Automatic renewal is offered only for the person's own Membership while the switch is on, and never to someone who already holds one. */
  function canRenewItem(item: CatalogueItem): boolean {
    return renewSwitch && !beneficiary && item.kind === "membership" && item.code !== "membership_upgrade_plus" && !membership.isMember;
  }

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

  /** Membership Plus and the upgrade to it need an approved state; only while the ladder is on, as in the database. */
  function needsStateFor(item: CatalogueItem): boolean {
    return ladderActive(items) && (item.code === "membership_annual" || item.code === UPGRADE_CODE);
  }

  async function pay(item: CatalogueItem) {
    if (needsStateFor(item) && !collectionState) return;
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
      // the person's own tick, only ever sent when they gave it
      ...(canRenewItem(item) && (renew[item.code] ?? RENEWAL_CONSENT_TICKED_BY_DEFAULT) ? { autoRenew: true } : {}),
      ...(needsStateFor(item) ? { collectionState } : {}),
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
      const n = returnNotice(v);
      if (n === "shop.return.paid.body") keys.current.delete(item.code);
      setPendingRef(n === "shop.return.pending" ? r.reference : null);
      setNotice(n);
      setBusy(null);
      await refresh();
    }
  }

  /** Asks the server again about an order that was waiting for the bank. Never opens a payment page, so it cannot charge twice. */
  async function checkAgain() {
    if (pendingRef === null) return;
    setChecking(true);
    const n = returnNotice(await verifyOrder(pendingRef));
    setChecking(false);
    setNotice(n);
    if (n !== "shop.return.pending") setPendingRef(null);
    await refresh();
  }

  if (!loaded) return <ActivityIndicator accessibilityLabel={tr("shop.title")} />;
  // The Membership ladder (founder decision 2026-10-21): two equal cards that state the annual blood panel first. A current Membership
  // member sees only the upgrade. Before the database serves the Membership item this is exactly the single-Membership screen.
  const ladder = ladderActive(items);
  const tierNow = !beneficiary && isTier(membership.tier) ? membership.tier : null;
  const arranged = arrangeItems(items, { tier: tierNow, isMember: !beneficiary && membership.isMember, inGrace: false, forSomeoneElse: beneficiary !== undefined });
  const visible = [...arranged.tierCards, ...(arranged.upgrade ? [arranged.upgrade] : []), ...arranged.others];
  return (
    <View style={{ gap: 12 }}>
      {beneficiary ? null : <EntitlementsSection refreshKey={entKey} />}
      {beneficiary ? null : <RenewalSection refreshKey={entKey} />}
      <AppText variant="title">{beneficiary ? tr("circle.pay.who", { name: beneficiary.name }) : tr("shop.title")}</AppText>
      {beneficiary ? <MutedText>{tr("circle.pay.note", { name: beneficiary.name })}</MutedText> : null}
      {beneficiary ? <MutedText>{tr("circle.pay.only_year")}</MutedText> : null}
      {!beneficiary && membership.isMember && membership.endsAt ? (
        <MutedText>{ladder && tierNow === "plus" ? tr("shop.tier.you_have_plus", { date: lagos(membership.endsAt) }) : ladder && tierNow === "evergreen" ? tr("shop.tier.you_have_evergreen", { date: lagos(membership.endsAt) }) : tr("shop.member_until", { date: lagos(membership.endsAt) })}</MutedText>
      ) : null}
      {ladder && !(membership.isMember && !beneficiary) ? (
        <View style={{ gap: 4 }}>
          <AppText variant="body">{tr("shop.tier.same_care")}</AppText>
          <MutedText>{tr("shop.tier.urgent_same")}</MutedText>
        </View>
      ) : null}
      {!beneficiary && membership.nextStartsAt ? <MutedText>{tr("shop.tier.next_year", { date: lagos(membership.nextStartsAt) })}</MutedText> : null}
      {needsPlusStateSetup({ ladder, forSomeoneElse: beneficiary !== undefined, tier: tierNow, membership }) ? (
        <Card>
          <AppText variant="bodyStrong">{tr("shop.plus.state.set_title")}</AppText>
          {plusStatesFailed ? (
            <View style={{ gap: 6 }}>
              <ErrorText>{tr("shop.plus.state.error")}</ErrorText>
              <SecondaryButton title={tr("shop.plus.state.retry")} onPress={() => void refresh()} />
            </View>
          ) : plusStates !== null && plusStates.length === 0 ? (
            <MutedText>{tr("shop.plus.state.none")}</MutedText>
          ) : (
            <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              {(plusStates ?? []).map((s) => {
                const on = setupState === s.state;
                return (
                  <Pressable
                    key={s.state}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => setSetupState(s.state)}
                    style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: on ? colors.ink : colors.muted }}
                  >
                    <Text style={{ color: colors.ink, fontWeight: on ? "700" : "400" }}>{s.displayName}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          <MutedText>{tr("shop.plus.state.warning")}</MutedText>
          {setupError ? <ErrorText>{tr(setupError)}</ErrorText> : null}
          <PrimaryButton
            title={setupBusy ? tr("shop.plus.state.set_saving") : tr("shop.plus.state.set_button")}
            disabled={!setupState || setupBusy}
            onPress={() => {
              setSetupBusy(true);
              setSetupError(null);
              void setMyPlusState(setupState).then((r) => {
                setSetupBusy(false);
                if (r.ok) { void refresh(); return; }
                setSetupError(plusStateSetupErrorKey(r.message));
              });
            }}
          />
        </Card>
      ) : null}
      {!beneficiary && membership.collectionState ? <MutedText>{tr("shop.plus.state.yours", { state: membership.collectionState })}</MutedText> : null}
      {!beneficiary && membership.graceEndsAt ? <MutedText>{tr("shop.in_grace", { date: lagos(membership.graceEndsAt) })}</MutedText> : null}
      {priceNotices.length > 0 ? (
        <Card>
          <AppText variant="bodyStrong">{tr("pricechange.title")}</AppText>
          {priceNotices.map((n) => (
            <View key={`${n.itemCode}-${n.endsAt}`} style={{ gap: 4, marginTop: 6 }}>
              <AppText variant="body">{tr("pricechange.body", { name: copy(n.nameKey), paid: naira(n.paidListKobo), date: lagos(n.newFrom), price: naira(n.newKobo) })}</AppText>
              <AppText variant="body">{tr("pricechange.kept", { ends: lagos(n.endsAt) })}</AppText>
            </View>
          ))}
          <MutedText>{tr("pricechange.renew")}</MutedText>
        </Card>
      ) : null}
      {items.length === 0 ? <MutedText>{tr("shop.not_open")}</MutedText> : null}
      {visible.filter((item) => !beneficiary || item.kind === "membership").map((item) => {
        const q = quotes[item.code];
        const pointsLine = q?.points?.lines.find((l) => l.rule === "points" && l.applied) ?? null;
        const pointsOn = usePoints[item.code] === true && pointsLine !== null;
        const quote = (pointsOn ? q?.points : q?.plain) ?? null;
        const view = buildCheckoutView({ item, quote, fee });
        // The upgrade is bought BY a current member, so being one never blocks it.
        const blocked = !beneficiary && item.kind === "membership" && membership.isMember && item.code !== UPGRADE_CODE;
        const tierCard = ladder && panelIncluded(item.code) !== null;
        return (
          <Card key={item.code}>
            {tierCard ? <MutedText>{tr(panelIncluded(item.code) ? "shop.tier.panel_yes" : "shop.tier.panel_no")}</MutedText> : null}
            <AppText variant="bodyLargeStrong">{tierCard ? tr(panelIncluded(item.code) ? "shop.tier.evergreen_plus.name" : "shop.tier.evergreen.name") : copy(item.nameKey)}</AppText>
            <MutedText>{copy(item.descriptionKey)}</MutedText>
            {tierCard && monthlyOn ? <MutedText>{tr("shop.tier.monthly", { amount: naira(monthlyFramingKobo(quote?.amountDueKobo ?? item.amountKobo)) })}</MutedText> : null}
            {needsStateFor(item) && !blocked ? (
              <View style={{ gap: 6, marginTop: 8 }}>
                <AppText variant="bodyStrong">{beneficiary ? tr("shop.plus.state.label_for", { name: beneficiary.name }) : tr("shop.plus.state.label")}</AppText>
                {plusStatesFailed ? (
                  <View style={{ gap: 6 }}>
                    <ErrorText>{tr("shop.plus.state.error")}</ErrorText>
                    <SecondaryButton title={tr("shop.plus.state.retry")} onPress={() => void refresh()} />
                  </View>
                ) : plusStates !== null && plusStates.length === 0 ? (
                  <MutedText>{tr("shop.plus.state.none")}</MutedText>
                ) : (
                  <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {(plusStates ?? []).map((s) => {
                      const on = collectionState === s.state;
                      return (
                        <Pressable
                          key={s.state}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on }}
                          onPress={() => {
                            // a different state is a different order: never replay the payment started for the old one
                            keys.current.delete("membership_annual");
                            keys.current.delete(UPGRADE_CODE);
                            setCollectionState(s.state);
                          }}
                          style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: on ? colors.ink : colors.muted }}
                        >
                          <Text style={{ color: colors.ink, fontWeight: on ? "700" : "400" }}>{s.displayName}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                <MutedText>{beneficiary ? tr("shop.plus.state.warning_for", { name: beneficiary.name }) : tr("shop.plus.state.warning")}</MutedText>
              </View>
            ) : null}
            <AppText variant="bodyStrong" style={{ marginTop: 8 }}>{tr("shop.included")}</AppText>
            {item.includedKeys.map((k) => (
              <AppText variant="body" key={k}>{`• ${copy(k)}`}</AppText>
            ))}
            {(notIncluded[item.code] ?? []).filter((e) => copy(e.labelKey) !== "").length > 0 ? (
              <View style={{ marginTop: 8 }}>
                <AppText variant="bodyStrong">{tr("notincl.title")}</AppText>
                {(notIncluded[item.code] ?? []).filter((e) => copy(e.labelKey) !== "").map((e) => (
                  <AppText variant="body" key={e.labelKey} accessibilityLabel={e.extraCode !== null && e.amountKobo === null ? tr("notincl.ask_us_label", { name: copy(e.labelKey) }) : undefined}>
                    {e.extraCode === null ? `• ${copy(e.labelKey)}` : `• ${copy(e.labelKey)}: ${e.amountKobo !== null ? naira(e.amountKobo) : tr("notincl.ask_us")}`}
                  </AppText>
                ))}
                {(notIncluded[item.code] ?? []).some((e) => e.extraCode !== null) ? <MutedText>{tr("notincl.sold_separately")}</MutedText> : null}
              </View>
            ) : null}
            {view.mode === "covered" ? (
              <View style={{ gap: 4, marginTop: 8 }} accessible accessibilityLabel={view.sponsorName ? tr("sponsor.covered_by", { name: view.sponsorName }) : tr("sponsor.covered_generic")}>
                <AppText variant="bodyStrong" accessibilityRole="header">
                  {view.sponsorName ? tr("sponsor.covered_by", { name: view.sponsorName }) : tr("sponsor.covered_generic")}
                </AppText>
                <MutedText>{tr("sponsor.no_payment", { name: view.sponsorName ?? tr("sponsor.covered_generic") })}</MutedText>
              </View>
            ) : (
              <View style={{ gap: 4, marginTop: 8 }}>
                {view.partCover ? (
                  <AppText variant="body">{tr("sponsor.part", { name: view.partCover.sponsorName ?? tr("sponsor.covered_generic"), amount: naira(view.partCover.amountKobo) })}</AppText>
                ) : null}
                {view.budgetShort ? <AppText variant="body">{tr("sponsor.budget_short")}</AppText> : null}
                {view.itemised ? (
                  <View style={{ gap: 4 }}>
                    <AppText variant="bodyStrong" accessibilityRole="header">{tr("checkout.itemised.title")}</AppText>
                    {itemisedRows(view.itemised, copy, (amount) => tr("shop.fee.about", { amount })).map((row) => (
                      <View key={row.key} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }} accessible accessibilityLabel={`${row.label}: ${row.amount}`}>
                        <AppText variant="body" style={{ flexShrink: 1 }}>{row.label}</AppText>
                        <AppText variant="body">{row.amount}</AppText>
                      </View>
                    ))}
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }} accessible accessibilityLabel={`${tr("checkout.total")}: ${tr("shop.fee.about", { amount: naira(view.itemised.totalKobo) })}`}>
                      <AppText variant="bodyStrong">{tr("checkout.total")}</AppText>
                      <AppText variant="bodyStrong">{tr("shop.fee.about", { amount: naira(view.itemised.totalKobo) })}</AppText>
                    </View>
                    <MutedText>{tr("checkout.itemised.note")}</MutedText>
                    {view.itemised.international ? (
                      <MutedText>
                        {tr(beneficiary ? "checkout.international.for_someone" : "checkout.international.line", {
                          fee: naira(view.itemised.international.processingKobo), total: naira(view.itemised.international.totalKobo),
                        })}
                      </MutedText>
                    ) : null}
                  </View>
                ) : (
                  <View style={{ gap: 4 }}>
                    <AppText variant="body">{`${tr("pay.fee.price")}: ${naira(view.fallback.priceKobo)}`}</AppText>
                    <AppText variant="body">{`${tr("pay.fee.line")}: ${tr("shop.fee.about", { amount: naira(view.fallback.feeKobo) })}`}</AppText>
                    <AppText variant="bodyStrong">{`${tr("pay.fee.total")}: ${tr("shop.fee.about", { amount: naira(view.fallback.totalKobo) })}`}</AppText>
                    <MutedText>{tr("pay.fee.explain")}</MutedText>
                    <MutedText>{tr("shop.fee.estimate")}</MutedText>
                  </View>
                )}
              </View>
            )}
            {view.mode === "pay" && monthlyOn && monthlyEquivalentKobo(view.fallback.priceKobo, item.durationDays) !== null ? (
              <MutedText>{tr("price.monthly_equivalent", { amount: naira(monthlyEquivalentKobo(view.fallback.priceKobo, item.durationDays) ?? 0) })}</MutedText>
            ) : null}
            {view.mode === "pay" && pointsLine !== null && q?.points && !beneficiary ? (
              <View style={{ gap: 4, marginTop: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <AppText variant="body" style={{ flexShrink: 1 }}>{tr("checkout.points.label")}</AppText>
                  <Switch
                    value={pointsOn} onValueChange={(v) => setUsePoints((m) => ({ ...m, [item.code]: v }))}
                    accessibilityLabel={tr("checkout.points.label")}
                  />
                </View>
                <MutedText>{tr("checkout.points.saves", { points: q.points.pointsApplied, amount: naira(q.points.pointsReductionKobo) })}</MutedText>
                <MutedText>{tr("checkout.points.explain")}</MutedText>
              </View>
            ) : null}
            <RefundRuleBlock kind={item.kind} />
            {canRenewItem(item) ? (
              <View style={{ gap: 4, marginTop: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <AppText variant="body" style={{ flexShrink: 1 }}>{tr("shop.renew.label")}</AppText>
                  <Switch
                    value={renew[item.code] ?? RENEWAL_CONSENT_TICKED_BY_DEFAULT} onValueChange={(v) => setRenew((m) => ({ ...m, [item.code]: v }))}
                    accessibilityLabel={tr("shop.renew.label")}
                  />
                </View>
                <MutedText>{tr("shop.renew.detail", { amount: naira(item.amountKobo) })}</MutedText>
                <MutedText>{tr("shop.renew.card_only")}</MutedText>
              </View>
            ) : (
              <MutedText>{tr("shop.no_renew")}</MutedText>
            )}
            {blocked ? null : (
              <PrimaryButton
                title={view.mode === "covered" ? (busy === item.code ? tr("sponsor.getting") : tr("sponsor.get")) : busy === item.code ? tr("shop.paying") : item.code === UPGRADE_CODE ? tr("shop.tier.upgrade.pay") : tr("shop.pay")}
                onPress={() => confirmGift(item)}
                disabled={busy !== null || (needsStateFor(item) && !collectionState)}
              />
            )}
          </Card>
        );
      })}
      {errorKey ? <ErrorText>{tr(errorKey)}</ErrorText> : null}
      {/* a transfer or USSD payment that has not landed is "waiting for your bank", never a failure (S71, 19.2) */}
      {notice === "shop.return.pending" ? <AppText variant="bodyStrong">{tr("shop.return.pending.title")}</AppText> : null}
      {notice ? <AppText variant="body" tone="textMuted" accessibilityLiveRegion="polite">{tr(notice)}</AppText> : null}
      {notice === "shop.return.pending" && pendingRef !== null ? <SecondaryButton title={tr("shop.return.check_again")} onPress={() => void checkAgain()} disabled={checking} loading={checking} /> : null}
      {notice === "sponsor.done.body" ? <AppText variant="bodyStrong">{tr("sponsor.done.title")}</AppText> : null}
      {beneficiary ? null : <HmoEligibilitySection onChecked={() => void refresh()} />}
      <Card>
        <AppText variant="bodyStrong">{tr("shop.history.title")}</AppText>
        {orders.length === 0 ? <MutedText>{tr("shop.history.empty")}</MutedText> : null}
        {orders.map((o) => (
          <View key={o.orderId} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
            <View>
              <AppText variant="body">{copy(o.nameKey)}</AppText>
              <MutedText>{lagos(o.paidAt ?? o.createdAt)}</MutedText>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <AppText variant="body">{o.amountKobo === 0 && o.sponsorShareKobo > 0 ? (o.sponsorName ? tr("sponsor.history_covered", { name: o.sponsorName }) : tr("sponsor.covered_generic")) : naira(o.totalKobo ?? o.amountKobo)}</AppText>
              <MutedText>{tr(orderStateKey(o.state))}</MutedText>
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}
