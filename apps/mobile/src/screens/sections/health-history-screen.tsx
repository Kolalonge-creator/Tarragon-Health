import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { FAMILY_RELATIONSHIPS } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import {
  addFamilyHistory,
  addProcedure,
  loadHistory,
  procedureWhen,
  relativeLabel,
  removeHistoryItem,
  type FamilyItem,
  type HistoryData,
  type ProcedureItem,
  type WriteResult,
} from "@/lib/health-history";
import { space, useTheme } from "@/ui/design";
import { AppText, Button, Card, Chip, Field, InlineAlert, Screen } from "@/ui/kit";
import { LoadFailed, PassportHeader, StaleNotice } from "@/screens/sections/passport-parts";

interface Props {
  /** The person whose history is shown (a supporter may be looking at someone they support). */
  subjectId: string;
  /** The signed-in person. Only they may add or remove entries. */
  userId: string;
  organisationId: string;
}

function writeMessage(r: Extract<WriteResult, { ok: false }>): string {
  if (r.reason === "offline") return t("mpass.needs_connection");
  if (r.reason === "failed") return t("mpass.save_failed");
  return t(`mpass.history.err.${r.reason}` as MessageKey);
}

function ItemRow({ title, detail, removeLabel, onRemove, disabled }: { title: string; detail: string; removeLabel: string | null; onRemove: () => void; disabled: boolean }) {
  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="bodyStrong">{title}</AppText>
      <AppText variant="caption" tone="textMuted">
        {detail}
      </AppText>
      {removeLabel ? <Button title={t("healthhistory.remove")} accessibilityLabel={removeLabel} variant="secondary" fullWidth={false} disabled={disabled} onPress={onRemove} /> : null}
    </Card>
  );
}

export function HealthHistoryScreen({ subjectId, userId, organisationId }: Props) {
  const { colors } = useTheme();
  const canEdit = subjectId === userId;
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "failed"; offline: boolean } | { kind: "ready"; data: HistoryData; stale: { offline: boolean; savedAt: string } | null }
  >({ kind: "loading" });
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [pName, setPName] = useState("");
  const [pYear, setPYear] = useState("");
  const [pWhere, setPWhere] = useState("");
  const [fCondition, setFCondition] = useState("");
  const [fRelative, setFRelative] = useState<string>("mother");
  const [fOnset, setFOnset] = useState("");

  // `quiet` refreshes in place after a write: the lists, the scroll position and the screen reader's place are kept.
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setState({ kind: "loading" });
      const r = await loadHistory(subjectId, canEdit);
      if (!r.ok) setState({ kind: "failed", offline: r.offline });
      else setState({ kind: "ready", data: r.data, stale: r.stale ? { offline: r.offline, savedAt: r.savedAt } : null });
    },
    [subjectId, canEdit]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A write only runs on a live read: while showing a saved copy the screen is read-only, and says why.
  const live = state.kind === "ready" && state.stale === null;

  async function run(action: () => Promise<WriteResult>, done: MessageKey, reset?: () => void) {
    setMessage(null);
    setNotice(null);
    setBusy(true);
    const r = await action();
    setBusy(false);
    if (!r.ok) {
      setMessage(writeMessage(r));
      return;
    }
    reset?.();
    await load(true);
    setNotice(t(done));
  }

  const confirmRemove = (kind: "procedure" | "family_history", id: string) =>
    Alert.alert(t("mpass.history.remove_title"), t("mpass.history.remove_body"), [
      { text: t("mpass.history.keep"), style: "cancel" },
      { text: t("healthhistory.remove"), style: "destructive", onPress: () => void run(() => removeHistoryItem(kind, id), "healthhistory.removed") },
    ]);

  const verified = (v: boolean) => (v ? t("healthhistory.verified") : t("healthhistory.not_verified"));

  const procedureDetail = (p: ProcedureItem) => [procedureWhen(p), p.facility, verified(p.verified_by_clinician)].filter(Boolean).join(" · ");
  const familyDetail = (f: FamilyItem) =>
    [
      relativeLabel(f.relationship),
      f.age_of_onset_years ? t("mpass.history.from_age", "en", { age: String(f.age_of_onset_years) }) : "",
      verified(f.verified_by_clinician),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <Screen edges={[]}>
      <PassportHeader title={t("healthhistory.title")} description={t("healthhistory.description")} />

      {state.kind === "loading" ? <ActivityIndicator color={colors.brand} accessibilityLabel={t("mpass.loading")} /> : null}
      {state.kind === "failed" ? <LoadFailed offline={state.offline} onRetry={() => void load()} /> : null}

      {state.kind === "ready" ? (
        <>
          {state.stale ? <StaleNotice offline={state.stale.offline} savedAt={state.stale.savedAt} /> : null}
          {!canEdit ? <InlineAlert tone="info" message={t("mpass.history.read_only")} /> : null}
          {message ? <InlineAlert tone="danger" message={message} /> : null}
          {notice ? <InlineAlert tone="info" message={notice} /> : null}

          <AppText variant="title" heading>
            {t("healthhistory.procedures_title")}
          </AppText>
          {state.data.procedures.length === 0 ? (
            <AppText tone="textMuted">{t("healthhistory.none")}</AppText>
          ) : (
            state.data.procedures.map((p) => (
              <ItemRow
                key={p.id}
                title={p.name}
                detail={procedureDetail(p)}
                removeLabel={canEdit ? t("mpass.history.remove_aria", "en", { name: p.name }) : null}
                disabled={busy || !live}
                onRemove={() => confirmRemove("procedure", p.id)}
              />
            ))
          )}
          {canEdit ? (
            <Card style={{ gap: space.md }}>
              <AppText variant="bodyStrong">{t("mpass.history.add_procedure")}</AppText>
              <Field label={t("healthhistory.name_label")} value={pName} onChangeText={setPName} maxLength={200} />
              <Field label={t("healthhistory.year_label")} value={pYear} onChangeText={(v) => setPYear(v.replace(/\D/g, ""))} maxLength={4} keyboardType="number-pad" />
              <Field label={t("healthhistory.facility_label")} value={pWhere} onChangeText={setPWhere} maxLength={200} />
              <Button
                title={t("healthhistory.add")}
                loading={busy}
                disabled={!live || !pName.trim()}
                onPress={() =>
                  void run(
                    () => addProcedure({ name: pName, year: pYear, facility: pWhere }, { userId, organisationId }),
                    "mpass.history.added",
                    () => {
                      setPName("");
                      setPYear("");
                      setPWhere("");
                    }
                  )
                }
              />
            </Card>
          ) : null}

          {canEdit ? (
            <>
            <AppText variant="title" heading>
              {t("healthhistory.family_title")}
            </AppText>
            {state.data.family.length === 0 ? (
              <AppText tone="textMuted">{t("healthhistory.none")}</AppText>
            ) : (
              state.data.family.map((f) => (
                <ItemRow
                  key={f.id}
                  title={f.condition_name}
                  detail={familyDetail(f)}
                  removeLabel={canEdit ? t("mpass.history.remove_aria", "en", { name: f.condition_name }) : null}
                  disabled={busy || !live}
                  onRemove={() => confirmRemove("family_history", f.id)}
                />
              ))
            )}
            {canEdit ? (
              <Card style={{ gap: space.md }}>
                <AppText variant="bodyStrong">{t("mpass.history.add_family")}</AppText>
                <Field label={t("healthhistory.condition_label")} value={fCondition} onChangeText={setFCondition} maxLength={120} />
                <AppText variant="label" tone="textMuted">
                  {t("healthhistory.relationship_label")}
                </AppText>
                <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  {FAMILY_RELATIONSHIPS.map((r) => (
                    <Chip key={r} label={t(`mpass.relative.${r}` as MessageKey)} selected={fRelative === r} onPress={() => setFRelative(r)} />
                  ))}
                </View>
                <Field label={t("healthhistory.onset_label")} value={fOnset} onChangeText={(v) => setFOnset(v.replace(/\D/g, ""))} maxLength={3} keyboardType="number-pad" />
                <Button
                  title={t("healthhistory.add")}
                  loading={busy}
                  disabled={!live || !fCondition.trim()}
                  onPress={() =>
                    void run(
                      () => addFamilyHistory({ condition: fCondition, relationship: fRelative, onsetAge: fOnset }, { userId, organisationId }),
                      "mpass.history.added",
                      () => {
                        setFCondition("");
                        setFOnset("");
                      }
                    )
                  }
                />
              </Card>
            ) : null}
            </>
          ) : (
            <>
              <AppText variant="title" heading>
                {t("healthhistory.family_title")}
              </AppText>
              <AppText tone="textMuted">{t("mpass.history.family_private")}</AppText>
            </>
          )}
          {canEdit && !live ? <InlineAlert tone="info" message={t("mpass.needs_connection")} /> : null}
        </>
      ) : null}
    </Screen>
  );
}
