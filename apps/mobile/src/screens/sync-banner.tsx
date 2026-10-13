import { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
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
import { dismissStoreNotice, listStoreNotices, type StoreNotice } from "@/lib/store-notices";
import { formatBytes, getMonthlyDataUsage } from "@/lib/data-usage";
import { loadOfflineTrustConfig } from "@/lib/offline-trust-config";
import { space } from "@/ui/design";
import { AppText, Button, Card, Icon } from "@/ui/kit";

/**
 * One banner for everything the outbox is holding (S06): waiting, stuck (past the
 * notice time, so the patient is told it has not reached the care team), rejected
 * (kept, with a support code and Retry or an explicit Remove) and held for another
 * account. Renders nothing when the outbox is empty, so a healthy phone shows no
 * banner at all. Built on the design kit (Phase 1).
 */
const REFRESH_MS = 15_000;

export function SyncBanner() {
  const locale = asLocale(useUiLanguage());
  const [summary, setSummary] = useState<OutboxSummary | null>(null);
  const [rejected, setRejected] = useState<OutboxItem[]>([]);
  const [notices, setNotices] = useState<StoreNotice[]>([]);
  const [usage, setUsage] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [s, items] = await Promise.all([getOutboxSummary(), listOutbox()]);
      setSummary(s);
      setRejected(items.filter((i) => i.state === "rejected"));
      setNotices(await listStoreNotices());
      setUsage(await getMonthlyDataUsage());
    } catch {
      // A failed read of the local queue must not blank the screen.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!summary && notices.length === 0) return null;
  const stuckWaiting = summary ? Math.max(0, summary.stuck - summary.rejected) : 0;
  const quietlyWaiting = summary ? Math.max(0, summary.waiting - stuckWaiting) : 0;
  const nothingHeld = !summary || summary.waiting + summary.rejected + summary.heldForOtherAccount === 0;
  if (nothingHeld && notices.length === 0) return null;

  async function retryOne(item: OutboxItem) {
    await retryRow(item.clientId);
    await flushOutbox();
    await refresh();
  }

  function confirmRemove(item: OutboxItem) {
    Alert.alert(t("outbox.remove", locale), t("outbox.remove_confirm", locale), [
      { text: t("common.cancel", locale), style: "cancel" },
      { text: t("outbox.remove", locale), style: "destructive", onPress: () => void discardRejectedRow(item.clientId).then(refresh) },
    ]);
  }

  function noticeText(n: StoreNotice): string {
    switch (n.kind) {
      case "key_lost":
        return t("store.key_lost", locale, { code: n.code });
      case "wiped":
        return n.reason === "lease_expired"
          ? t("store.wiped.lease_expired", locale, { count: n.unsent, days: loadOfflineTrustConfig().deviceLeaseDays })
          : t(`store.wiped.${n.reason}`, locale, { count: n.unsent });
      case "migration_held":
        return t("store.migration_held", locale, { code: n.code });
      case "not_encrypted":
        return t("store.not_encrypted", locale);
    }
  }

  return (
    <View style={{ gap: space.sm }} accessibilityLiveRegion="polite">
      {notices.map((n) => (
        <Card key={n.id} level={0} style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Icon name="private" size={18} tone="warnText" />
            <AppText variant="body" tone="warnText" style={{ flex: 1 }}>
              {noticeText(n)}
            </AppText>
          </View>
          <Button title={t("store.dismiss", locale)} variant="ghost" onPress={() => void dismissStoreNotice(n.id).then(refresh)} />
        </Card>
      ))}
      {summary && quietlyWaiting > 0 ? (
        <Card level={0} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Icon name="sending" size={18} tone="textMuted" />
          <AppText variant="caption" tone="textMuted" style={{ flex: 1 }}>
            {t("outbox.waiting", locale, { count: quietlyWaiting })}
          </AppText>
        </Card>
      ) : null}
      {stuckWaiting > 0 ? (
        <Card level={0} style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Icon name="offline" size={18} tone="warnText" />
            <AppText variant="body" tone="warnText" style={{ flex: 1 }}>
              {t("outbox.stuck", locale, { count: stuckWaiting })}
            </AppText>
          </View>
          <Button title={t("outbox.retry", locale)} variant="secondary" onPress={() => void flushOutbox().then(refresh)} />
        </Card>
      ) : null}
      {rejected.map((item) => (
        <Card key={item.clientId} level={0} style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Icon name="alert" size={18} tone="dangerText" />
            <AppText variant="body" tone="dangerText" style={{ flex: 1 }}>
              {t("outbox.rejected", locale, { count: 1, code: item.supportCode })}
            </AppText>
          </View>
          <Button title={t("outbox.retry", locale)} variant="secondary" onPress={() => void retryOne(item)} />
          <Button title={t("outbox.remove", locale)} variant="ghost" onPress={() => confirmRemove(item)} />
        </Card>
      ))}
      {summary && summary.heldForOtherAccount > 0 ? (
        <Card level={0} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Icon name="private" size={18} tone="textMuted" />
          <AppText variant="caption" tone="textMuted" style={{ flex: 1 }}>
            {t("outbox.held", locale, { count: summary.heldForOtherAccount })}
          </AppText>
        </Card>
      ) : null}
      {usage > 0 && !nothingHeld ? (
        <AppText variant="caption" tone="textMuted">
          {t("usage.month", locale, { amount: formatBytes(usage) })}
        </AppText>
      ) : null}
    </View>
  );
}
