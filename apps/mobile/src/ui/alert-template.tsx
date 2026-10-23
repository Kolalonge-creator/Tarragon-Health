import { Text, View } from "react-native";
import { t } from "@tarragon/i18n";
import { useLegacyColors } from "@/ui/design";
import { Card, MutedText, SecondaryButton } from "@/ui/legacy-kit";
import { CardListen } from "@/ui/kit/CardListen";

/** Red is for a true clinical alert only. Everything else uses the brand green. */
const CLINICAL_RED = "#DC2626";
const BRAND_GREEN = "#0E7C52";

interface AlertTemplateProps {
  /** What we noticed: one short sentence, shown as the card title. */
  noticed: string;
  /** What it may mean, in one line. */
  meaning: string;
  /** One step to take. */
  step: string;
  /** True only for a real clinical alert (a danger sign). A reminder, a device state or a tip is never clinical. */
  clinical?: boolean;
  /**
   * True for "go now" cards: the step comes first, larger and bold, and there is no message button beside it. The emergency instruction
   * stays the most prominent thing on the card.
   */
  urgent?: boolean;
  /** When given (and not urgent), the card ends with a "Message your care team" button. */
  onMessageCareTeam?: () => void;
  /** A recorded clip for the title, if one exists. With none, the words are all there is. */
  listenClipId?: string | null;
}

/**
 * The standard alert card (UI-C change 12): what we noticed, what it may mean, one step, and a button to message your care team.
 * No exclamation marks, no "WARNING", no fear words; the alert-tone lint holds that. The words carry the meaning, not the colour.
 */
export function AlertTemplate({ noticed, meaning, step, clinical = false, urgent = false, onMessageCareTeam, listenClipId }: AlertTemplateProps) {
  const colors = useLegacyColors();
  return (
    <Card style={{ borderLeftWidth: 4, borderLeftColor: clinical ? CLINICAL_RED : BRAND_GREEN, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Text accessibilityRole={clinical ? "alert" : "header"} style={{ fontSize: 16, fontWeight: "700", color: colors.ink, flex: 1 }}>
          {noticed}
        </Text>
        <CardListen clipId={listenClipId} />
      </View>
      {urgent ? <Text style={{ fontSize: 18, fontWeight: "800", color: colors.ink }}>{step}</Text> : null}
      <View style={{ gap: 2 }}>
        <MutedText>{t("alerttpl.label.meaning")}</MutedText>
        <Text style={{ fontSize: 14, color: colors.ink }}>{meaning}</Text>
      </View>
      {urgent ? null : (
        <View style={{ gap: 2 }}>
          <MutedText>{t("alerttpl.label.step")}</MutedText>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>{step}</Text>
        </View>
      )}
      {onMessageCareTeam && !urgent ? <SecondaryButton title={t("alerttpl.message_care_team")} onPress={onMessageCareTeam} /> : null}
    </Card>
  );
}
