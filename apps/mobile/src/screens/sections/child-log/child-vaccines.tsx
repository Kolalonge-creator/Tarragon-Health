import { useState } from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@tarragon/i18n";
import { buildChildVaccineChecklist, checklistCounts, mayLog, sortByAttention, type ChecklistDose, type ChecklistStatus } from "@tarragon/shared";
import { takeCardPhoto, type CardPhotoOutcome, type ChildDetail, type ChildVaccineData } from "@/lib/child-log";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, SecondaryButton } from "@/ui/legacy-kit";

type IconName = keyof typeof Ionicons.glyphMap;
const STATUS: Record<ChecklistStatus, { key: Parameters<typeof t>[0]; icon: IconName }> = {
  done: { key: "cdl.vax.status_done", icon: "checkmark-circle" },
  due: { key: "cdl.vax.status_due", icon: "alarm" },
  overdue: { key: "cdl.vax.status_overdue", icon: "warning" },
  upcoming: { key: "cdl.vax.status_upcoming", icon: "time-outline" },
};
const TRUST_KEY = { verified: "cdl.vax.trust_verified", waiting: "cdl.vax.trust_waiting", self_reported: "cdl.vax.trust_self_reported", rejected: "cdl.vax.trust_self_reported" } as const;
const PHOTO_KEY: Record<CardPhotoOutcome, Parameters<typeof t>[0] | null> = {
  sent: "cdl.card.sent",
  on_phone: "cdl.card.saved_on_phone",
  not_open: "cdl.log.not_open",
  failed: "cdl.card.failed",
  view_only: "cdl.log.view_only",
  unusable: "cdl.card.failed",
  cancelled: null,
};

const lagosToday = (): string => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
const shortDate = (iso: string): string => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });

/** The vaccine checklist from the NPHCDA schedule data, with the paper-card photo button. Words and icons for every status, never colour alone. */
export function ChildVaccines({ child, data, failed }: { child: ChildDetail; data: ChildVaccineData | null; failed: boolean }) {
  const colors = useLegacyColors();
  const [photo, setPhoto] = useState<CardPhotoOutcome | null>(null);

  const doses: ChecklistDose[] = data && child.dateOfBirth ? sortByAttention(buildChildVaccineChecklist({ dateOfBirth: child.dateOfBirth, sex: child.sex, today: lagosToday(), catalog: data.catalog, records: data.records })) : [];
  const counts = checklistCounts(doses);

  return (
    <Card style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{t("cdl.vax.title")}</Text>
      <MutedText>{t("cdl.vax.intro")}</MutedText>
      {failed && <ErrorText>{t("cdl.log.failed")}</ErrorText>}
      {!child.dateOfBirth && <MutedText>{t("cdl.vax.empty")}</MutedText>}
      {doses.length > 0 && <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>{t("cdl.vax.counts", "en", { done: counts.done, due: counts.due, overdue: counts.overdue })}</Text>}
      {doses.map((d) => {
        const s = STATUS[d.status];
        return (
          <View key={`${d.code}-${d.doseNumber}`} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Ionicons name={s.icon} size={24} color={d.status === "overdue" ? colors.status.critical : d.status === "done" ? colors.brand : colors.muted} accessible={false} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{d.name}, {t("cdl.vax.dose", "en", { dose: d.doseNumber })}</Text>
              <Text style={{ fontSize: 14, color: colors.ink }}>{t(s.key)}  {d.doneOn ? t("cdl.vax.given_on", "en", { date: shortDate(d.doneOn) }) : t("cdl.vax.due_on", "en", { date: shortDate(d.dueDate) })}</Text>
              {d.trust && <Text style={{ fontSize: 12.5, color: colors.muted }}>{t(TRUST_KEY[d.trust])}</Text>}
            </View>
          </View>
        );
      })}
      {mayLog(child) && (
        <View style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{t("cdl.card.title")}</Text>
          <MutedText>{t("cdl.card.help")}</MutedText>
          <SecondaryButton title={t("cdl.card.take")} onPress={() => void takeCardPhoto(child, "").then(setPhoto)} />
          <View accessibilityLiveRegion="polite">{photo && PHOTO_KEY[photo] && <Text style={{ fontSize: 14, color: colors.ink }}>{t(PHOTO_KEY[photo]!)}</Text>}</View>
        </View>
      )}
    </Card>
  );
}
