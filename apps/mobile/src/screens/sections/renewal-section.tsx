import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { formatNaira } from "@tarragon/commerce";
import { useUiLanguage } from "@/lib/ui-language";
import { cancelRenewal, loadMyRenewal } from "@/lib/commerce/api";
import type { RenewalState } from "@/lib/commerce/parse";
import { Card, ErrorText, MutedText, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

const lagos = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });

/**
 * Where a Member sees, and stops, automatic renewal (the same card as the web Membership page). Shown only to someone with a Membership, and
 * only while the renewal switch is on or they are already on it, so a person is never shown a promise that is not running. One tap to
 * cancel: it keeps the year already paid for, stops the next charge and deletes the saved card.
 */
export function RenewalSection({ refreshKey }: { refreshKey: number }) {
  const locale = asLocale(useUiLanguage());
  const tr = useCallback((key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params), [locale]);
  const [state, setState] = useState<RenewalState | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void loadMyRenewal().then((r) => {
      if (live) setState(r.ok ? r.data : null);
    });
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (!state || !state.hasMembership || (!state.enabled && !state.autoRenew && !done)) return null;
  const date = state.endsAt ? lagos(state.endsAt) : "";

  async function stop() {
    setBusy(true);
    setFailed(false);
    const ok = await cancelRenewal();
    setBusy(false);
    if (ok) setDone(true);
    else setFailed(true);
  }

  return (
    <Card>
      <AppText variant="bodyStrong" accessibilityRole="header">{tr("renewal.title")}</AppText>
      {done || !state.autoRenew ? (
        <>
          <AppText variant="body" accessibilityLiveRegion="polite">{done ? tr("renewal.cancelled", { date }) : tr("renewal.off", { date })}</AppText>
          {done ? null : <MutedText>{tr("renewal.off_how")}</MutedText>}
        </>
      ) : (
        <>
          <AppText variant="body">
            {state.amountKobo !== null
              ? tr("renewal.on", { date, last4: state.cardLast4 ?? "", amount: `₦${formatNaira(state.amountKobo)}` })
              : tr("renewal.on_no_amount", { date, last4: state.cardLast4 ?? "" })}
          </AppText>
          <MutedText>{tr("renewal.cancel_keeps", { date })}</MutedText>
          <View style={{ marginTop: 8 }}>
            <SecondaryButton title={busy ? tr("renewal.cancelling") : tr("renewal.cancel")} onPress={() => void stop()} disabled={busy} loading={busy} />
          </View>
        </>
      )}
      {failed ? <ErrorText>{tr("renewal.error")}</ErrorText> : null}
    </Card>
  );
}
