import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { asLocale, en, t, type MessageKey } from "@tarragon/i18n";
import { entitlementLines, entitlementSource, type EntitlementView, type WordingLine } from "@tarragon/commerce";
import { useUiLanguage } from "@/lib/ui-language";
import { loadEntitlements } from "@/lib/commerce/api";
import { useLegacyColors } from "@/ui/design";
import { Badge, Card, MutedText } from "@/ui/legacy-kit";

const isKey = (k: string): k is MessageKey => Object.hasOwn(en, k);
const STATE_KEY = { active: "entitlement.state.active", expired: "entitlement.state.expired", used: "entitlement.state.used", revoked: "entitlement.state.revoked" } as const;

/**
 * What the person has (S72, 19.12), the same words as the web: "3 consultations remaining", "valid for 60 more days", and where it came from (bought, a
 * supporter, a sponsor, the Community Access Fund). Plain text only, so it stays light on a slow connection. Never money (INV-09).
 */
export function EntitlementsSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [rows, setRows] = useState<EntitlementView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const say = useCallback((l: WordingLine) => (isKey(l.key) ? t(l.key, locale, { ...l.params }) : ""), [locale]);

  useEffect(() => {
    let live = true;
    void loadEntitlements().then((r) => {
      if (!live) return;
      if (r.ok) setRows(r.data);
      setLoaded(true);
    });
    return () => { live = false; };
  }, [refreshKey]);

  if (!loaded) return null;
  return (
    <Card>
      <Text accessibilityRole="header" style={{ fontWeight: "700", color: colors.ink }}>{t("entitlement.title", locale)}</Text>
      {rows.length === 0 ? <MutedText>{t("entitlement.empty", locale)}</MutedText> : null}
      {rows.map((e) => {
        const nameKey = e.nameKey;
        return (
          <View key={e.id} style={{ paddingVertical: 8, gap: 2 }} accessible accessibilityLabel={`${isKey(nameKey) ? t(nameKey, locale) : e.kind}`}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: colors.ink, fontWeight: "600", flexShrink: 1 }}>{isKey(nameKey) ? t(nameKey, locale) : e.kind}</Text>
              <Badge tone={e.state === "active" ? "brand" : "neutral"}>{t(STATE_KEY[e.state], locale)}</Badge>
            </View>
            {entitlementLines(e).filter((l) => !l.key.startsWith("entitlement.state.")).map((l) => (<MutedText key={l.key}>{say(l)}</MutedText>))}
            <MutedText>{say(entitlementSource(e))}</MutedText>
            {e.partCovered ? <MutedText>{t("entitlement.part_covered", locale)}</MutedText> : null}
          </View>
        );
      })}
    </Card>
  );
}
