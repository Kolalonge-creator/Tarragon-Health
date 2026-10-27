import { View } from "react-native";
import { t } from "@tarragon/i18n";
import type { CyclePrediction, PeriodInProgress } from "@tarragon/shared";
import { confidenceSentence, statusSentence, statusTone } from "@/lib/cycle-ui";
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Card, Icon, type IconName } from "@/ui/kit";
import { ConfidenceDots, CycleListen } from "@/ui/cycle-parts";

/**
 * The top of the cycle screen: one plain sentence for where the person is, an icon and a tint that never mean danger (green, amber
 * for "a little later than the estimate", grey for "nothing yet"), and how sure the estimate is in words plus three dots.
 */
export function CycleStatusCard({ prediction, inProgress, children }: { prediction: CyclePrediction; inProgress?: PeriodInProgress | null; children?: React.ReactNode }) {
  const { colors } = useTheme();
  const tone = statusTone(prediction, inProgress);
  const fill = tone === "amber" ? colors.warnBg : tone === "grey" ? colors.surfaceMuted : colors.brandTint;
  const icon: IconName = tone === "amber" ? "time" : tone === "grey" ? "info" : "appointment";
  const textTone = tone === "amber" ? "warnText" : tone === "grey" ? "textMuted" : "brandText";
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
        <AppText variant="title" heading style={{ flex: 1 }}>
          {t("cycle.status.listen_title")}
        </AppText>
        <CycleListen card="status" />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: fill, borderRadius: radii.md, padding: space.md }}>
        <Icon name={icon} size={24} tone={textTone} />
        <AppText variant="bodyLarge" tone={textTone} style={{ flex: 1, fontWeight: "600" }} accessibilityLiveRegion="polite">
          {statusSentence(prediction, inProgress)}
        </AppText>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <ConfidenceDots confidence={prediction.confidence} />
        <AppText variant="body" tone="textMuted" style={{ flex: 1 }}>
          {confidenceSentence(prediction.confidence)}
        </AppText>
      </View>
      {prediction.confidenceReason ? (
        <AppText variant="body" tone="textMuted">
          {prediction.confidenceReason}
        </AppText>
      ) : null}
      {children}
    </Card>
  );
}
