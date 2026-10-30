import { Text, View } from "react-native";
import { childTimelineLine, t } from "@tarragon/i18n";
import type { TimelineItem } from "@tarragon/shared";
import { useLegacyColors } from "@/ui/design";
import { Badge, Card, MutedText } from "@/ui/legacy-kit";

const lagos = (iso: string, withDay: boolean): string =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", ...(withDay ? { day: "numeric", month: "short" } : {}), hour: "2-digit", minute: "2-digit" });

/** The child's timeline: newest first, one line each. The mother's records are not in it and cannot be passed to it (see buildChildTimeline). */
export function ChildTimeline({ items }: { items: readonly TimelineItem[] }) {
  const colors = useLegacyColors();
  return (
    <Card style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{t("cdl.timeline.title")}</Text>
      {items.length === 0 && <MutedText>{t("cdl.timeline.empty")}</MutedText>}
      {items.map((item) => (
        <View key={item.id} style={{ gap: 2, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 15, color: colors.ink }}>{childTimelineLine(item)}</Text>
            {item.pendingOnPhone && <Badge>{t("cdl.log.pending_badge")}</Badge>}
          </View>
          <Text style={{ fontSize: 12.5, color: colors.muted }}>
            {lagos(item.at, true)}
            {item.loggedBy ? `  ${t("cdl.logged_by.by", "en", { name: item.loggedBy })}` : ""}
          </Text>
          {item.reviewedAt && <Text style={{ fontSize: 12.5, color: colors.muted }}>{t("cdl.timeline.reviewed", "en", { date: new Date(item.reviewedAt).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" }) })}</Text>}
        </View>
      ))}
    </Card>
  );
}
