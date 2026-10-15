import { useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import { activeEmergencyPack, emergencyFacilitiesForState, type PackLike } from "@tarragon/clinical";
import { directionsHref, getProposedConfig } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { colors, radius } from "@/ui/theme";

/**
 * The bundled emergency pack, offline (S65, INV-06, spec 15.13 and 15.14). Everything comes from the pack compiled into the app: no network call,
 * no database read. It shows the fixed first line, the step-by-step cards ONLY once the CMO has signed the pack, and the emergency hospitals for
 * the chosen state with the date each was last checked, or a plain "none checked yet". It shows no telephone number of any kind (CMO decision Q18).
 */
const PACK = getProposedConfig("emergency.pack").value as unknown as PackLike;

export function EmergencyPackView() {
  const pack = activeEmergencyPack(PACK);
  const [stateCode, setStateCode] = useState<string | null>(null);
  const result = stateCode ? emergencyFacilitiesForState(PACK, stateCode) : null;
  const platform = Platform.OS === "ios" ? "ios" : "android";

  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}>{pack.firstLine}</Text>

      {pack.isDraft ? (
        <Text style={{ fontSize: 13, color: colors.subtle }}>{t("emergency.draft_note", "en")}</Text>
      ) : (
        pack.topics.map((topic) => (
          <View key={topic.key} style={{ gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{topic.title}</Text>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{t("emergency.signs", "en")}</Text>
            {topic.signs.map((s) => <Text key={s} style={{ fontSize: 14, color: colors.ink }}>{`• ${s}`}</Text>)}
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{t("emergency.steps", "en")}</Text>
            {topic.steps.map((s) => <Text key={s} style={{ fontSize: 14, color: colors.ink }}>{`• ${s}`}</Text>)}
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{t("emergency.never", "en")}</Text>
            {topic.never.map((s) => <Text key={s} style={{ fontSize: 14, color: colors.ink }}>{`• ${s}`}</Text>)}
          </View>
        ))
      )}

      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{t("emergency.facilities.title", "en")}</Text>
      <Text style={{ fontSize: 13, color: colors.subtle }}>{t("emergency.facilities.state", "en")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {pack.states.map((s) => (
          <Pressable
            key={s.code}
            accessibilityRole="button"
            accessibilityState={{ selected: stateCode === s.code }}
            onPress={() => setStateCode(s.code)}
            style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderWidth: 1, borderColor: stateCode === s.code ? colors.ink : colors.border, borderRadius: radius.control }}
          >
            <Text style={{ fontSize: 13.5, color: colors.ink }}>{s.name}</Text>
          </Pressable>
        ))}
      </View>
      {result?.noneListed ? <Text style={{ fontSize: 14, color: colors.ink }}>{t("emergency.facilities.none", "en")}</Text> : null}
      {result?.facilities.map((f) => {
        const href = directionsHref({ latitude: f.latitude, longitude: f.longitude, name: f.name, address: f.address }, platform);
        return (
          <View key={f.name} style={{ gap: 2 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>{f.name}</Text>
            <Text style={{ fontSize: 13.5, color: colors.ink }}>{f.address}</Text>
            <Text style={{ fontSize: 12.5, color: colors.subtle }}>{t("emergency.facilities.verified", "en", { date: f.last_verified_on })}</Text>
            {href ? (
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(href)} style={{ minHeight: 44, justifyContent: "center" }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>{t("emergency.facilities.directions", "en")}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
