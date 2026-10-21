import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { assessFreshness, freshnessCopy, loadFreshnessConfig, type FreshnessConfig } from "@/lib/freshness";
import { useUiLanguage } from "@/lib/ui-language";
import { space } from "@/ui/design";
import { AppText, InlineAlert } from "@/ui/kit";

const REFRESH_MS = 60_000;

/** A malformed config must never crash the screen this sits on (the emergency card is one): treat the time as unknown instead. */
function safeConfig(): FreshnessConfig | null {
  try {
    return loadFreshnessConfig();
  } catch {
    return null;
  }
}

/**
 * Says how old the copy kept on the phone is (S06y). Shown only where the screen is showing that saved copy.
 * Calm by design: a plain caption with the time, and past the proposed threshold one quiet information note. No colour
 * alone, no urgency words. Cheap: one 60 second timer while mounted, no images, no extra dependencies. Never throws.
 */
export function FreshnessNote({ lastUpdatedAt, nowMs }: { lastUpdatedAt: string | null | undefined; nowMs?: number }) {
  const language = asLocale(useUiLanguage());
  const config = useMemo(safeConfig, []);
  // The age is re-read once a minute while the screen is open, so a copy that crosses the threshold gets its note.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (nowMs !== undefined) return;
    const timer = setInterval(() => setTick(Date.now()), REFRESH_MS);
    return () => clearInterval(timer);
  }, [nowMs]);
  const copy = useMemo(
    () =>
      freshnessCopy(
        // No usable config: say the age cannot be told rather than guess a threshold.
        assessFreshness(config ? lastUpdatedAt : null, nowMs ?? tick, config ?? { version: 0, staleAfterMs: Number.POSITIVE_INFINITY }),
        (key, params) => t(key, language, params)
      ),
    [lastUpdatedAt, nowMs, tick, config, language]
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
