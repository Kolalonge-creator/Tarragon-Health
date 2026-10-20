import { useMemo } from "react";
import { View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { assessFreshness, freshnessCopy, loadFreshnessConfig } from "@/lib/freshness";
import { useUiLanguage } from "@/lib/ui-language";
import { space } from "@/ui/design";
import { AppText, InlineAlert } from "@/ui/kit";

/**
 * Says how old the copy kept on the phone is (S06y). Shown only where the screen is showing that saved copy.
 * Calm by design: a plain caption with the time, and past the proposed threshold one quiet information note. No colour
 * alone, no urgency words. Cheap: no images, no timers, no extra dependencies.
 */
export function FreshnessNote({ lastUpdatedAt, nowMs }: { lastUpdatedAt: string | null | undefined; nowMs?: number }) {
  const language = asLocale(useUiLanguage());
  const config = useMemo(() => loadFreshnessConfig(), []);
  const copy = useMemo(
    () => freshnessCopy(assessFreshness(lastUpdatedAt, nowMs ?? Date.now(), config), (key, params) => t(key, language, params)),
    [lastUpdatedAt, nowMs, config, language]
  );
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="caption" tone="textMuted" accessibilityLabel={copy.labelA11y}>
        {copy.label}
      </AppText>
      {copy.notice ? <InlineAlert tone="info" message={copy.notice} /> : null}
    </View>
  );
}
