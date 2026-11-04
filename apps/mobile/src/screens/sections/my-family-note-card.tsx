import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { loadMyFamilyNotes, setFamilyNoteShared } from "@/lib/care-circle/api";
import { familyNoteAuthor, type MyFamilyNote } from "@/lib/care-circle/parse";
import { radii, space, useTheme } from "@/ui/design";
import { AppText } from "@/ui/kit/AppText";
import { Badge } from "@/ui/kit/Badge";
import { Button } from "@/ui/kit/Button";
import { Card } from "@/ui/kit/Card";
import { InlineAlert } from "@/ui/kit/InlineAlert";
import { Skeleton, SkeletonGroup } from "@/ui/kit/Skeleton";

function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/**
 * The patient's own card (mobile twin of the web MyFamilyNoteCard, patient-first release): every line a doctor writes for the family
 * reaches the patient first; family sees it only after the patient taps "Share with my Care Circle", and the patient can stop sharing.
 * "Don't share" is remembered. A failed read shows nothing, which shares nothing. No animation is used.
 */
export function MyFamilyNoteCard() {
  const locale = asLocale(useUiLanguage());
  const { colors } = useTheme();
  const [notes, setNotes] = useState<MyFamilyNote[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"familynote.mine.shared_done" | "familynote.mine.unshared_done" | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => setNotes(await loadMyFamilyNotes()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (notes === null) {
    return (
      <SkeletonGroup label={t("familynote.mine.loading", locale)}>
        <Skeleton height={20} width="50%" />
        <Skeleton height={72} />
      </SkeletonGroup>
    );
  }
  const latest = notes[0];
  if (!latest) return null;
  const earlierShared = latest.shared ? undefined : notes.slice(1).find((n) => n.shared);

  async function decide(note: MyFamilyNote, share: boolean) {
    setBusy(true);
    setFailed(false);
    setNotice(null);
    const r = await setFamilyNoteShared(note.noteId, share);
    setBusy(false);
    if (r === null) {
      setFailed(true);
      return;
    }
    setNotice(r ? "familynote.mine.shared_done" : "familynote.mine.unshared_done");
    await refresh();
  }
  const from = (n: MyFamilyNote) => {
    const named = familyNoteAuthor(n);
    return named ? t("familynote.view.from", locale, { name: named }) : t("familynote.view.from_team", locale);
  };

  return (
    <Card style={{ gap: space.md }}>
      <View style={{ gap: space.sm }}>
        <AppText variant="title" heading>{t("familynote.mine.title", locale)}</AppText>
        <Badge label={latest.shared ? t("familynote.mine.shared", locale) : t("familynote.mine.private", locale)} tone={latest.shared ? "positive" : "neutral"} />
        <AppText variant="body" tone="textMuted">{t("familynote.mine.intro", locale)}</AppText>
      </View>
      <View style={{ gap: space.sm, padding: space.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }}>
        <View style={{ borderLeftWidth: 4, borderLeftColor: colors.brand, paddingLeft: space.md }}>
          <AppText variant="bodyLarge">{latest.body}</AppText>
        </View>
        <AppText variant="bodyStrong">{from(latest)}</AppText>
        <AppText variant="caption" tone="textMuted">{t("familynote.view.written", locale, { date: lagosDate(latest.writtenAt) })}</AppText>
      </View>
      <AppText variant="body" tone="textMuted">{t("familynote.mine.who", locale)}</AppText>
      {latest.shared ? (
        <Button title={t("familynote.mine.stop", locale)} variant="secondary" disabled={busy} onPress={() => void decide(latest, false)} />
      ) : (
        <View style={{ gap: space.sm }}>
          <Button title={t("familynote.mine.share", locale)} loading={busy} onPress={() => void decide(latest, true)} />
          {!latest.decided ? <Button title={t("familynote.mine.dont_share", locale)} variant="ghost" disabled={busy} onPress={() => void decide(latest, false)} /> : null}
        </View>
      )}
      {notice ? <AppText variant="body" accessibilityLiveRegion="polite">{t(notice, locale)}</AppText> : null}
      {failed ? <InlineAlert tone="danger" message={t("familynote.mine.error", locale)} /> : null}
      {earlierShared ? (
        <View style={{ gap: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
          <AppText variant="bodyStrong" heading>{t("familynote.mine.earlier", locale)}</AppText>
          <AppText variant="body">{earlierShared.body}</AppText>
          <AppText variant="caption" tone="textMuted">{from(earlierShared)}</AppText>
          <Button title={t("familynote.mine.stop", locale)} variant="secondary" disabled={busy} onPress={() => void decide(earlierShared, false)} />
        </View>
      ) : null}
    </Card>
  );
}
