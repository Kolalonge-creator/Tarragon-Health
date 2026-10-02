import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import {
  discardRejectedRow,
  flushOutbox,
  getOutboxSummary,
  listOutbox,
  retryRow,
  type OutboxItem,
  type OutboxSummary,
} from "@/lib/outbox";
import { useUiLanguage } from "@/lib/ui-language";
import { colors, radius } from "@/ui/theme";
import { SecondaryButton } from "@/ui/components";

/**
 * One banner for everything the outbox is holding (S06): waiting, stuck (past
 * the notice time, so the patient is told it has not reached the care team),
 * rejected (kept, with a support code and Retry or an explicit Remove) and
 * held for another account. Renders nothing when the outbox is empty, so a
 * healthy phone shows no banner at all.
 */
const REFRESH_MS = 15_000;

export function SyncBanner() {
  const locale = asLocale(useUiLanguage());
  const [summary, setSummary] = useState<OutboxSummary | null>(null);
  const [rejected, setRejected] = useState<OutboxItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [s, items] = await Promise.all([getOutboxSummary(), listOutbox()]);
      setSummary(s);
      setRejected(items.filter((i) => i.state === "rejected"));
    } catch {
      // A failed read of the local queue must not blank the screen.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!summary) return null;
  const stuckWaiting = Math.max(0, summary.stuck - summary.rejected);
  const quietlyWaiting = Math.max(0, summary.waiting - stuckWaiting);
  if (summary.waiting + summary.rejected + summary.heldForOtherAccount === 0) return null;

  async function retryOne(item: OutboxItem) {
    await retryRow(item.clientId);
    await flushOutbox();
    await refresh();
  }

  function confirmRemove(item: OutboxItem) {
    Alert.alert(t("outbox.remove", locale), t("outbox.remove_confirm", locale), [
      { text: t("common.cancel", locale), style: "cancel" },
      {
        text: t("outbox.remove", locale),
        style: "destructive",
        onPress: () => void discardRejectedRow(item.clientId).then(refresh),
      },
    ]);
  }

  const box = {
    backgroundColor: colors.groupBg,
    borderRadius: radius.control,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 6,
  } as const;
  const line = { fontSize: 12.5, color: colors.muted } as const;

  return (
    <View style={{ gap: 8 }} accessibilityLiveRegion="polite">
      {quietlyWaiting > 0 ? (
        <View style={box}>
          <Text style={line}>{t("outbox.waiting", locale, { count: quietlyWaiting })}</Text>
        </View>
      ) : null}
      {stuckWaiting > 0 ? (
        <View style={box}>
          <Text style={[line, { color: colors.ink }]}>{t("outbox.stuck", locale, { count: stuckWaiting })}</Text>
          <SecondaryButton title={t("outbox.retry", locale)} onPress={() => void flushOutbox().then(refresh)} />
        </View>
      ) : null}
      {rejected.map((item) => (
        <View key={item.clientId} style={box}>
          <Text style={[line, { color: colors.ink }]}>
            {t("outbox.rejected", locale, { count: 1, code: item.supportCode })}
          </Text>
          <SecondaryButton title={t("outbox.retry", locale)} onPress={() => void retryOne(item)} />
          <SecondaryButton title={t("outbox.remove", locale)} onPress={() => confirmRemove(item)} />
        </View>
      ))}
      {summary.heldForOtherAccount > 0 ? (
        <View style={box}>
          <Text style={line}>{t("outbox.held", locale, { count: summary.heldForOtherAccount })}</Text>
        </View>
      ) : null}
    </View>
  );
}
