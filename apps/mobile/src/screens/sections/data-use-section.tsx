import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { useLegacyColors } from "@/ui/design";
import { Card, GroupedList, GroupedListRow, MutedText, SectionLabel } from "@/ui/legacy-kit";
import { PLATFORM_URL } from "@/lib/platform-url";
import { getUsageFigures } from "@/lib/data-usage";
import { buildDataCostView, type DataCostView } from "@/lib/data-cost-view";
import { loadDataCostConfig, type DataCostConfig } from "@/lib/data-cost-config";
import { readWifiOnly, writeWifiOnly } from "@/lib/wifi-only";

/**
 * Settings: what syncing costs on mobile data, in naira, and the choice to sync ordinary entries on Wi-Fi
 * only (S06z). The figure is an estimate and says so. The Wi-Fi choice never holds anything urgent; the
 * words say that plainly because a patient must be able to trust it before they turn it on.
 */
const REFRESH_MS = 15_000;

export function DataUseSection() {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [view, setView] = useState<DataCostView | null>(null);
  const [wifiOnly, setWifiOnly] = useState(false);
  // A configuration that cannot be read must never take Settings down: the section then simply does not show.
  const config = useMemo<DataCostConfig | null>(() => {
    try {
      return loadDataCostConfig();
    } catch {
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!config) return;
    const usage = await getUsageFigures();
    setView(buildDataCostView(usage, config, locale));
  }, [config, locale]);

  useEffect(() => {
    void refresh();
    readWifiOnly()
      .then(setWifiOnly)
      .catch(() => {});
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function toggleWifiOnly() {
    const next = !wifiOnly;
    setWifiOnly(next);
    try {
      await writeWifiOnly(next);
    } catch {
      // Not saved: show what actually stuck rather than a choice that will not survive a restart.
      readWifiOnly()
        .then(setWifiOnly)
        .catch(() => {});
    }
  }

  if (!config) return null;
  const hours = Math.round(config.maxHoldMs / 3_600_000);

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>{t("datacost.title", locale)}</SectionLabel>
      <Card style={{ gap: 6 }}>
        <MutedText>{view?.monthLine ?? t("datacost.month_none", locale)}</MutedText>
        <MutedText>{view?.lastSyncLine ?? t("datacost.last_sync_none", locale)}</MutedText>
        {view?.unplacedLine ? <MutedText>{view.unplacedLine}</MutedText> : null}
        <MutedText>{view?.estimateNote ?? ""}</MutedText>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("datacost.how_we_count", locale)}
          onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/support`).catch(() => {})}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <MutedText>{t("datacost.how_we_count", locale)}</MutedText>
        </Pressable>
      </Card>
      <GroupedList>
        <GroupedListRow
          title={t("datacost.wifi_only.title", locale)}
          subtitle={t("datacost.wifi_only.subtitle", locale)}
          onPress={() => void toggleWifiOnly()}
          trailing={
            <View
              accessible
              accessibilityRole="switch"
              accessibilityLabel={t("datacost.wifi_only.title", locale)}
              accessibilityState={{ checked: wifiOnly }}
              style={{
                width: 46,
                height: 28,
                borderRadius: 999,
                padding: 2,
                backgroundColor: wifiOnly ? colors.brand : colors.border,
              }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: "#fff",
                  marginLeft: wifiOnly ? 18 : 0,
                }}
              />
            </View>
          }
        />
      </GroupedList>
      <MutedText>{t("datacost.wifi_only.body", locale, { hours })}</MutedText>
      <SectionLabel>{t("datacost.use_less_title", locale)}</SectionLabel>
      <MutedText>{t("datacost.use_less_lowdata", locale)}</MutedText>
      <MutedText>{t("datacost.use_less_wifi", locale)}</MutedText>
      <MutedText>{t("datacost.use_less_media", locale)}</MutedText>
    </View>
  );
}
