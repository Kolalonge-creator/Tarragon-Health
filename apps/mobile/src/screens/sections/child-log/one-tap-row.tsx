import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@tarragon/i18n";
import { cleanCaregiverLabel, isAsleepNow, mayLog, type ChildEventKind, type ChildEventRow, type ChildFeedType } from "@tarragon/shared";
import { loadLastLabel, saveLastLabel, tapChildEvent, type ChildDetail, type TapOutcome } from "@/lib/child-log";
import { radius } from "@/ui/theme";
import { placeholderColorFor, useLegacyColors, useTextInputStyle, useTheme } from "@/ui/design";
import { Card, MutedText } from "@/ui/legacy-kit";

type IconName = keyof typeof Ionicons.glyphMap;

interface Tap {
  kind: ChildEventKind;
  feedType: ChildFeedType | null;
  label: string;
  icon: IconName;
}

const OUTCOME_KEY: Record<TapOutcome, Parameters<typeof t>[0]> = {
  sent: "cdl.log.saved",
  on_phone: "cdl.log.saved_on_phone",
  not_open: "cdl.log.not_open",
  failed: "cdl.log.failed",
  view_only: "cdl.log.view_only",
};

/**
 * The one-tap row (S68b): big buttons with a picture AND a word, for a tired person on a shared phone with little signal. Each tap is written
 * to the phone first (the outbox), so the screen can always say "saved on this phone". Sleep is one button that flips between "Asleep" and
 * "Woke up". Nothing here edits or removes an entry: a wrong tap is corrected by tapping the right one.
 */
export function OneTapRow({ userId, child, events, onLogged }: { userId: string; child: ChildDetail; events: readonly ChildEventRow[]; onLogged: (outcome: TapOutcome) => void }) {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const inputStyle = useTextInputStyle();
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<TapOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const asleep = isAsleepNow(events);
  const canLog = mayLog(child);

  useEffect(() => {
    void loadLastLabel(userId).then(setLabel);
  }, [userId]);

  const taps: Tap[] = [
    { kind: "feed", feedType: "breast", label: t("cdl.log.feed_breast"), icon: "heart-outline" },
    { kind: "feed", feedType: "bottle", label: t("cdl.log.feed_bottle"), icon: "cafe-outline" },
    asleep
      ? { kind: "sleep_stop", feedType: null, label: t("cdl.log.sleep_stop"), icon: "sunny-outline" }
      : { kind: "sleep_start", feedType: null, label: t("cdl.log.sleep_start"), icon: "moon-outline" },
    { kind: "nappy_wet", feedType: null, label: t("cdl.log.nappy_wet"), icon: "water-outline" },
    { kind: "nappy_dirty", feedType: null, label: t("cdl.log.nappy_dirty"), icon: "ellipse-outline" },
  ];

  async function tap(item: Tap) {
    if (busy || !canLog) return;
    setBusy(true);
    const outcome = await tapChildEvent(child, item.kind, item.feedType, label);
    await saveLastLabel(userId, cleanCaregiverLabel(label) ?? "");
    setStatus(outcome);
    setBusy(false);
    onLogged(outcome);
  }

  return (
    <Card style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{t("cdl.log.title")}</Text>
      {canLog ? (
        <>
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{t("cdl.logged_by.label")}</Text>
            <TextInput
              accessibilityLabel={t("cdl.logged_by.label")}
              value={label}
              onChangeText={setLabel}
              placeholder={t("cdl.logged_by.placeholder")}
              placeholderTextColor={placeholderColorFor(scheme)}
              maxLength={24}
              autoCapitalize="words"
              style={inputStyle}
            />
            <MutedText>{t("cdl.logged_by.help")}</MutedText>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {taps.map((item) => (
              <Pressable
                key={`${item.kind}-${item.feedType ?? ""}`}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ disabled: busy }}
                onPress={() => void tap(item)}
                style={({ pressed }) => ({
                  width: "48%",
                  minHeight: 84,
                  borderRadius: radius.control,
                  borderWidth: 2,
                  borderColor: colors.brand,
                  backgroundColor: pressed ? colors.border : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  paddingVertical: 10,
                })}
              >
                <Ionicons name={item.icon} size={30} color={colors.brand} />
                <Text style={{ fontSize: 17, fontWeight: "700", color: colors.ink }}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <View accessibilityLiveRegion="polite">
            {status && <Text style={{ fontSize: 14, fontWeight: "600", color: status === "failed" ? colors.status.critical : colors.ink }}>{t(OUTCOME_KEY[status])}</Text>}
          </View>
          <MutedText>{t("cdl.log.undo_note")}</MutedText>
        </>
      ) : (
        <MutedText>{t("cdl.log.view_only")}</MutedText>
      )}
    </Card>
  );
}
