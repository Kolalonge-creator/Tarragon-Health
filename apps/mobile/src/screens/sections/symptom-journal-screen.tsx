import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";
import { t, type MessageKey } from "@tarragon/i18n";
import { journalLabel, loadJournal, type JournalLoad, type JournalRow } from "@/lib/symptom-journal";
import { formatPassportDateTime } from "@/lib/passport-format";
import type { SectionId } from "@/lib/sections";
import { space, useTheme } from "@/ui/design";
import { AppText, Button, Card, EmptyState, InlineAlert, Screen } from "@/ui/kit";
import { LoadFailed, PassportHeader, StaleNotice } from "@/screens/sections/passport-parts";

interface Props {
  subjectId: string;
  /** While acting for someone else the journal (keyed on who is signed in) is not shown: it would be the helper's own entries under another name. */
  acting: boolean;
  onNavigate: (section: SectionId) => void;
}

function EntryCard({ row }: { row: JournalRow }) {
  return (
    <Card style={{ gap: space.xs }}>
      <AppText variant="bodyStrong" accessibilityRole="header">
        {journalLabel(row.symptomType)}
      </AppText>
      <AppText variant="caption" tone="textMuted">
        {formatPassportDateTime(row.reportedAt)}
      </AppText>
      {row.freeText ? <AppText>{row.freeText}</AppText> : null}
      {row.severity !== null ? (
        <AppText variant="caption" tone="textMuted">
          {t("mpass.journal.severity", "en", { value: String(row.severity) })}
        </AppText>
      ) : null}
      {row.fromCheck ? (
        <AppText variant="caption" tone="textMuted">
          {t("journal.from_check")}
        </AppText>
      ) : null}
      {row.triageGrade ? (
        <AppText variant="caption" tone="textMuted">
          {t(`journal.grade.${row.triageGrade}` as MessageKey)}
        </AppText>
      ) : null}
      {row.waiting ? (
        <AppText variant="caption" tone="warnText">
          {t("mpass.journal.waiting")}
        </AppText>
      ) : null}
    </Card>
  );
}

export function SymptomJournalScreen({ subjectId, acting, onNavigate }: Props) {
  const { colors } = useTheme();
  const [state, setState] = useState<JournalLoad | "loading">("loading");

  const load = useCallback(async () => {
    setState("loading");
    setState(await loadJournal(subjectId));
  }, [subjectId]);

  useEffect(() => {
    if (!acting) void load();
  }, [acting, load]);

  return (
    <Screen edges={[]}>
      <PassportHeader title={t("passport.nav.journal")} description={t("journal.description")} />
      {acting ? (
        <InlineAlert tone="info" message={t("journal.own_only")} />
      ) : (
        <>
          <Button title={t("mpass.journal.log")} variant="secondary" onPress={() => onNavigate("vitals")} />
          {state === "loading" ? <ActivityIndicator color={colors.brand} accessibilityLabel={t("mpass.loading")} /> : null}
          {state !== "loading" && !state.ok ? <LoadFailed offline={state.offline} onRetry={() => void load()} /> : null}
          {state !== "loading" && state.ok ? (
            <>
              {state.stale ? <StaleNotice offline={state.offline} savedAt={state.savedAt} /> : null}
              {state.stale && state.savedAt === null ? <InlineAlert tone="info" message={t("mpass.journal.mirror_note")} /> : null}
              {state.rows.length === 0 ? (
                <EmptyState icon="vitals" title={t("journal.none")} />
              ) : (
                state.rows.map((row) => <EntryCard key={row.id} row={row} />)
              )}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
