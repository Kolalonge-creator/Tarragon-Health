import { View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { familyNoteAuthor, type DoctorNote } from "@/lib/care-circle/parse";
import { radii, space, useTheme } from "@/ui/design";
import { AppText } from "@/ui/kit/AppText";
import { Card } from "@/ui/kit/Card";

function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

/**
 * The doctor's line for the family (2026-11-03), mobile twin of the web FamilyDoctorNoteCard. `note === null` is the calm empty state.
 * The doctor's name is null-gated (familyNoteAuthor: only when the database sent the author's id AND name); otherwise "your care team".
 */
export function FamilyDoctorNoteCard({ note }: { note: DoctorNote | null }) {
  const locale = asLocale(useUiLanguage());
  const { colors } = useTheme();
  const named = note ? familyNoteAuthor(note) : null;
  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="bodyLargeStrong" heading>{t("familynote.view.title", locale)}</AppText>
      {note ? (
        <>
          <View style={{ borderLeftWidth: 4, borderLeftColor: colors.brand, paddingLeft: space.md }}>
            <AppText variant="bodyLarge">{note.body}</AppText>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            {named ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.brandTint, alignItems: "center", justifyContent: "center" }}
              >
                <AppText variant="label" tone="brandText">{initials(named)}</AppText>
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">{named ? t("familynote.view.from", locale, { name: named }) : t("familynote.view.from_team", locale)}</AppText>
              <AppText variant="caption" tone="textMuted">{t("familynote.view.written", locale, { date: lagosDate(note.writtenAt) })}</AppText>
            </View>
          </View>
        </>
      ) : (
        <AppText variant="body" tone="textMuted">{t("familynote.view.none", locale)}</AppText>
      )}
    </Card>
  );
}
