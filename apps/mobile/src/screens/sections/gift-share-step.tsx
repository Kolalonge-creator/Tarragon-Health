import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { dismissGiftPayer, loadGiftPayers, shareWithGiftPayer } from "@/lib/care-circle/api";
import { GIFT_SHARE_PERMISSIONS, GIFT_SHARE_USUAL, mergeKeepingShown, permissionKey, type GiftPayer, type GiftSharePermission } from "@/lib/care-circle/parse";
import { MIN_TARGET, radii, space, useTheme } from "@/ui/design";
import { AppText } from "@/ui/kit/AppText";
import { Button } from "@/ui/kit/Button";
import { Card } from "@/ui/kit/Card";
import { InlineAlert } from "@/ui/kit/InlineAlert";
import { Skeleton, SkeletonGroup } from "@/ui/kit/Skeleton";

/** shared: an invitation the payer must accept (P1, D3). widened: an existing member now sees more, at once. */
type Outcome = "shared" | "widened" | "not_now";

/**
 * The next step after a patient accepts a gift someone else paid for (2026-11-03), the mobile twin of the web GiftShareStep:
 * "Would you like [first name] to see how you are doing?". Every switch starts OFF; "Share the usual" only turns on the usual set and the
 * monthly report (the patient still presses Share, so they see exactly what goes); "Not now" shares nothing. No animation is used, so
 * nothing moves for a person who asked for reduced motion.
 */
export function GiftShareStep({ payer }: { payer: GiftPayer }) {
  const locale = asLocale(useUiLanguage());
  const { colors } = useTheme();
  const [ticked, setTicked] = useState<GiftSharePermission[]>([]);
  const [monthly, setMonthly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"nothing" | "full" | "failed" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const name = payer.firstName ?? t("giftshare.someone", locale);

  if (outcome) {
    return (
      <Card style={{ gap: space.sm }}>
        <AppText variant="body" accessibilityLiveRegion="polite">
          {outcome === "shared"
            ? t("giftshare.done", locale, { name })
            : outcome === "widened"
              ? t("giftshare.done_member", locale, { name })
              : t("giftshare.not_now_done", locale)}
        </AppText>
      </Card>
    );
  }

  function toggle(p: GiftSharePermission) {
    setProblem(null);
    setTicked((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }
  async function submit() {
    if (ticked.length === 0) {
      setProblem("nothing");
      return;
    }
    setBusy(true);
    setProblem(null);
    const r = await shareWithGiftPayer(payer.payerId, ticked, monthly);
    setBusy(false);
    if (r.ok) setOutcome(r.offered ? "shared" : "widened");
    else setProblem(r.reason === "full" ? "full" : "failed");
  }

  const row = (key: string, label: string, on: boolean, onToggle: () => void) => (
    <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: MIN_TARGET }}>
      <Switch accessibilityLabel={label} value={on} onValueChange={onToggle} disabled={busy} />
      <AppText variant="body" style={{ flex: 1 }}>{label}</AppText>
    </View>
  );

  return (
    <Card style={{ gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        <AppText variant="title" heading>{t("giftshare.title", locale, { name })}</AppText>
        <AppText variant="body" tone="textMuted">{t("giftshare.intro", locale, { name })}</AppText>
      </View>
      <View style={{ gap: space.md, padding: space.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }}>
        <AppText variant="body" tone="textMuted">{t("giftshare.usual_hint", locale)}</AppText>
        <Button
          title={t("giftshare.usual", locale)}
          variant="secondary"
          disabled={busy}
          onPress={() => {
            setProblem(null);
            setTicked((cur) => [...new Set([...cur, ...GIFT_SHARE_USUAL])]);
            setMonthly(true);
          }}
        />
      </View>
      <View style={{ gap: space.xs }}>
        <AppText variant="label" heading>{t("giftshare.legend", locale)}</AppText>
        {GIFT_SHARE_PERMISSIONS.map((p) => row(p, t(permissionKey(p), locale), ticked.includes(p), () => toggle(p)))}
        {row("monthly", t("giftshare.monthly", locale), monthly, () => { setProblem(null); setMonthly((m) => !m); })}
      </View>
      {problem ? (
        <InlineAlert tone="danger" message={problem === "nothing" ? t("giftshare.nothing_ticked", locale) : problem === "full" ? t("giftshare.error_full", locale) : t("giftshare.error", locale)} />
      ) : null}
      <View style={{ gap: space.sm }}>
        <Button title={busy ? t("giftshare.saving", locale) : t("giftshare.share", locale)} loading={busy} onPress={() => void submit()} />
        <Button title={t("giftshare.not_now", locale)} variant="ghost" disabled={busy} onPress={() => {
            // remembered for this payer (never asked again); a failed save shares nothing either way
            void dismissGiftPayer(payer.payerId);
            setOutcome("not_now");
          }} />
      </View>
    </Card>
  );
}

/**
 * Payers of accepted gifts who see nothing yet. The payer of the gift the patient JUST accepted gets the step open at once; anyone else
 * is one tap away. `refreshKey` re-reads after a gift is answered. A failed read shows nothing (an offer, never a required step).
 */
export function GiftPayerOffers({ justAccepted, refreshKey }: { justAccepted: string | null; refreshKey: number }) {
  const locale = asLocale(useUiLanguage());
  const [payers, setPayers] = useState<GiftPayer[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadGiftPayers().then((p) => {
      if (live) setPayers((cur) => (cur === null ? p : mergeKeepingShown(cur, p)));
    });
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (payers === null) {
    return (
      <SkeletonGroup label={t("giftshare.loading", locale)}>
        <Skeleton height={20} width="60%" />
        <Skeleton height={80} />
      </SkeletonGroup>
    );
  }
  const fresh = justAccepted ? payers.find((p) => p.entitlementIds.includes(justAccepted)) ?? null : null;
  const others = payers.filter((p) => p.payerId !== fresh?.payerId);
  if (!fresh && others.length === 0) return null;
  return (
    <View style={{ gap: space.md }}>
      {fresh ? <GiftShareStep payer={fresh} /> : null}
      {others.length > 0 ? (
        <Card style={{ gap: space.sm }}>
          <AppText variant="bodyStrong" heading>{t("giftshare.later_title", locale)}</AppText>
          <AppText variant="body" tone="textMuted">{t("giftshare.later_body", locale)}</AppText>
          {others.map((p) =>
            p.offerPending ? (
              // P1 (D3): already asked; they see nothing until they say yes. The patient can withdraw it under "Waiting for a reply".
              <AppText key={p.payerId} variant="body" tone="textMuted">{t("giftshare.waiting", locale, { name: p.firstName ?? t("giftshare.someone", locale) })}</AppText>
            ) : open === p.payerId ? (
              <GiftShareStep key={p.payerId} payer={p} />
            ) : (
              <Button key={p.payerId} variant="secondary" title={t("giftshare.later_open", locale, { name: p.firstName ?? t("giftshare.someone", locale) })} onPress={() => setOpen(p.payerId)} />
            ),
          )}
        </Card>
      ) : null}
    </View>
  );
}
