import { useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CRISIS_CARD_OFFLINE, normaliseCrisisCard, type CrisisCardData } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { supabase } from "@/lib/supabase";
import { radius } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Card } from "@/ui/legacy-kit";

/**
 * The crisis card (function 10.3) on the phone. Same screen, no navigation, no model (INV-01), and it works with no signal (INV-06):
 * the emergency number and every sentence are bundled in the app (CRISIS_CARD_OFFLINE and the i18n catalogue) and the last server copy
 * is cached on the device. Founder decision 2026-10-07: there are no usable crisis helplines in Nigeria, so the card shows NO helpline
 * number; it says go to the nearest hospital now and shows the emergency number (112, wording awaiting CMO approval). Helplines can be
 * added later with their own verified-only gate; normaliseCrisisCard ignores any helpline an old cached copy still carries.
 */
const CACHE_KEY = "tarragon.crisisCard.v1";

export function CrisisCard({ told = false }: { told?: boolean }) {
  const colors = useLegacyColors();
  const [card, setCard] = useState<CrisisCardData>({ ...CRISIS_CARD_OFFLINE, helplines: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw && !cancelled) setCard(normaliseCrisisCard(JSON.parse(raw)));
      } catch { /* bundled card stays */ }
      try {
        const { data, error } = await supabase.rpc("get_crisis_card");
        if (error || cancelled) return;
        setCard(normaliseCrisisCard(data));
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data)).catch(() => {});
      } catch { /* offline: the bundled or cached card stays */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const link = (label: string, url: string, strong = false) => (
    <Text
      accessibilityRole="link"
      onPress={() => void Linking.openURL(url)}
      style={{ fontSize: 14, fontWeight: strong ? "700" : "600", color: strong ? "#FFFFFF" : colors.brand, backgroundColor: strong ? colors.status.critical : "transparent", paddingVertical: strong ? 12 : 4, paddingHorizontal: strong ? 14 : 0, borderRadius: radius.control, overflow: "hidden", alignSelf: "flex-start" }}
    >
      {label}
    </Text>
  );

  return (
    <Card style={{ gap: 12, borderWidth: 1, borderColor: colors.status.critical }}>
      <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{t("crisis.title")}</Text>
      <Text style={{ fontSize: 13.5, color: colors.ink }}>{t("crisis.lead")}</Text>
      {told && <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{t("crisis.care_team_told")}</Text>}
      {told && card.callbackSlaMinutes !== null && (
        <Text style={{ fontSize: 13.5, color: colors.ink }}>{t("crisis.care_team_sla", "en", { minutes: card.callbackSlaMinutes })}</Text>
      )}
      <View style={{ gap: 4 }}>
        {link(t("crisis.call", "en", { number: card.emergencyNumber }), `tel:${card.emergencyNumber}`, true)}
        <Text style={{ fontSize: 12, color: colors.muted }}>{t("crisis.call_note")}</Text>
      </View>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{t("crisis.hospital")}</Text>
        {link(t("crisis.hospital_map"), "https://www.google.com/maps/search/?api=1&query=nearest+hospital+emergency")}
        <Text style={{ fontSize: 12, color: colors.muted }}>{t("crisis.hospital_offline")}</Text>
      </View>
      <Text style={{ fontSize: 12, color: colors.muted }}>{t("crisis.stay_with_someone")}</Text>
    </Card>
  );
}
