import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import {
  DIARY_GLUCOSE_CONTEXTS,
  HELD_READING_COPY,
  applySaveAnswer,
  isBlankRow,
  diaryLimits,
  diaryTodayLagos,
  emptyDiaryRow,
  summarise,
  validateDiaryRow,
  type DiaryDraftRow,
  type DiaryKind,
  type DiaryProblem,
  type RowFeedback,
} from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { classifyVitalOffline } from "@/lib/vitals";
import { postDiaryRead, postDiarySave } from "@/lib/diary-api";
import type { VitalReadingPayload } from "@/lib/api";
import { space } from "@/ui/design";
import { AppText, Button, Card, Chip, Field, InlineAlert, Screen } from "@/ui/kit";
import { EmergencyGuidanceModal } from "@/screens/emergency-guidance-modal";
import type { EmergencyContact } from "@/lib/emergency";
import { TickRow } from "@/screens/sections/provenance-extras";

const LIMITS = diaryLimits();
const newKey = (): string => Crypto.randomUUID();

/** Lagos is UTC+1 all year: the date n days before today, as the YYYY-MM-DD the sheet uses. */
function daysAgo(nowMs: number, n: number): string {
  return diaryTodayLagos(nowMs - n * 86_400_000);
}

interface GuidanceState {
  detail: string;
  synced: boolean;
}

/**
 * The paper diary sheet on the phone (S07y). The same rules as the web sheet, from the same pure module (@tarragon/shared diary-import and diary-sheet): rows
 * the person types work with no model; a photo (only while the reader's guard is open) SUGGESTS rows that start unchecked and are never saved until the person
 * ticks that they match the diary; a row with a problem says why in words; a failed save keeps every row.
 *
 * Saving needs a connection (a diary row is dated inside a bounded window and kept only if it is inside that window when it arrives, so it is never queued).
 * A dangerous value gets the same on-device emergency guidance as a reading logged now, shown BEFORE the save is sent, and the server runs the same red-flag
 * engines on it. No model is consulted for any of that (INV-01).
 */
export function DiarySheet({
  readerOpen,
  beneficiaryProfileId,
  emergencyContact,
  doctorReview,
}: {
  readerOpen: boolean;
  beneficiaryProfileId?: string;
  emergencyContact: EmergencyContact | null;
  doctorReview: boolean | null;
}) {
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const [rows, setRows] = useState<DiaryDraftRow[]>(() => [emptyDiaryRow(newKey())]);
  const [feedback, setFeedback] = useState<Record<string, RowFeedback>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [banner, setBanner] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<GuidanceState | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const summary = useMemo(() => summarise(rows, nowMs), [rows, nowMs]);

  function update(key: string, patch: Partial<DiaryDraftRow>) {
    setRows((current) =>
      current.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // editing a suggested row means the person has to check it again
        if (r.suggested && !("confirmed" in patch)) next.confirmed = false;
        return next;
      })
    );
    setTouched((c) => ({ ...c, [key]: true }));
    setFeedback((c) => {
      if (!(key in c)) return c;
      const { [key]: _gone, ...rest } = c;
      void _gone;
      return rest;
    });
    setSavedNote(null);
  }

  async function readPhoto() {
    setBanner(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setBanner({ tone: "info", text: tr("diary.photo.unavailable") });
        return;
      }
      const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7, exif: false });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      setReading(true);
      const result = await postDiaryRead({ uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg", fileName: asset.fileName ?? "diary.jpg" });
      if (!result.ok) {
        setBanner({ tone: "danger", text: tr("diary.photo.failed") });
        return;
      }
      const a = result.answer;
      if (a.status === "suggested") {
        setRows((current) => [...current.filter((r) => !isBlankRow(r)), ...a.rows]);
        setBanner({
          tone: "info",
          text:
            a.skipped > 0
              ? `${tr("diary.photo.found", { count: a.rows.length })} ${tr("diary.photo.skipped", { count: LIMITS.maxRows })}`
              : tr("diary.photo.found", { count: a.rows.length }),
        });
      } else if (a.status === "unreadable") setBanner({ tone: "info", text: tr("diary.photo.unreadable") });
      else if (a.status === "bad_file") setBanner({ tone: "danger", text: a.reason === "too_big" ? tr("diary.photo.too_big") : tr("diary.photo.not_image") });
      else if (a.status === "not_open") setBanner({ tone: "info", text: tr("diary.photo.not_open") });
      else if (a.status === "rate_limited") setBanner({ tone: "info", text: tr("diary.photo.rate_limited") });
      else setBanner({ tone: "info", text: tr("diary.photo.unavailable") });
    } catch {
      setBanner({ tone: "danger", text: tr("diary.photo.failed") });
    } finally {
      setReading(false);
    }
  }

  /** The same on-device check a reading logged now gets (BP and glucose; pulse is checked by the server). No model. */
  async function dangerOf(sent: readonly DiaryDraftRow[]): Promise<string | null> {
    for (const row of sent) {
      const v = validateDiaryRow(row, nowMs, LIMITS);
      if (!v.ok) continue;
      const r = v.reading;
      const payload: VitalReadingPayload | null =
        r.vitalType === "blood_pressure" && r.systolic !== undefined && r.diastolic !== undefined
          ? { vital_type: "blood_pressure", systolic: r.systolic, diastolic: r.diastolic }
          : r.vitalType === "glucose" && r.glucoseMmolL !== undefined && r.glucoseContext
            ? { vital_type: "glucose", glucose_value: r.glucoseMmolL, glucose_unit: "mmol_l", glucose_context: r.glucoseContext }
            : null;
      if (!payload) continue;
      const flag = await classifyVitalOffline(payload).catch(() => null);
      if (flag?.severity === "emergency") return flag.detail;
    }
    return null;
  }

  async function save() {
    if (saving || summary.ready.length === 0 || summary.tooMany) return;
    setSaving(true);
    setBanner(null);
    setSavedNote(null);
    const sent = summary.ready;
    const sentKeys = new Set(sent.map((r) => r.key));
    // The emergency guidance appears first, from the phone, and never waits on the network (INV-06).
    const danger = await dangerOf(sent);
    if (danger) setGuidance({ detail: danger, synced: false });
    const result = await postDiarySave(sent, beneficiaryProfileId);
    setSaving(false);
    if (!result.ok) {
      setBanner({ tone: "danger", text: result.closed ? tr("diary.not_open_save") : result.offline ? tr("diary.offline") : result.denied ? tr("diary.denied") : tr("diary.save_failed") });
      return;
    }
    const answer = result.answer;
    if (answer.tooMany) {
      setBanner({ tone: "danger", text: tr("diary.too_many", { max: LIMITS.maxRows }) });
      return;
    }
    const applied = applySaveAnswer(rows, sentKeys, answer);
    // only the rows the server says are in the record leave the sheet; edits made while the save was in flight are kept
    const gone = new Set(rows.filter((r) => !applied.rows.some((a) => a.key === r.key)).map((r) => r.key));
    setRows((cur) => {
      const next = cur.filter((r) => !gone.has(r.key));
      return next.length === 0 ? [emptyDiaryRow(newKey())] : next;
    });
    setFeedback(applied.feedback);
    if (danger && applied.saved > 0) setGuidance((g) => (g ? { ...g, synced: true } : g));
    const matched = applied.matched > 0 ? ` ${tr("diary.matched", { count: applied.matched })}` : "";
    if (answer.safetyAssessmentFailed) setSavedNote(`${tr("diary.saved", { count: applied.saved })} ${tr("diary.safety_unfinished")}${matched}`);
    else if (applied.saved > 0) setSavedNote(`${applied.notSaved > 0 ? tr("diary.saved_partial", { saved: applied.saved, failed: applied.notSaved }) : tr("diary.saved", { count: applied.saved })}${matched}`);
    else if (applied.matched > 0 && applied.notSaved === 0) setSavedNote(tr("diary.matched", { count: applied.matched }));
    else if (applied.notSaved > 0) setBanner({ tone: "danger", text: tr("diary.save_failed") });
  }

  const problemText = (p: DiaryProblem) => tr(`diary.problem.${p}` as MessageKey, { days: LIMITS.windowDays });

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>
          {tr("diary.title")}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {tr("diary.intro")}
        </AppText>
        <AppText variant="caption" tone="textMuted">
          {tr("diary.window_note", { days: LIMITS.windowDays })}
        </AppText>
      </View>

      {readerOpen ? (
        <Card style={{ gap: space.sm }}>
          <Button title={reading ? tr("diary.photo.reading") : tr("diary.photo.button")} variant="secondary" loading={reading} onPress={() => void readPhoto()} />
          <AppText variant="caption" tone="textMuted">
            {tr("diary.photo.hint")}
          </AppText>
        </Card>
      ) : (
        <AppText variant="caption" tone="textMuted">
          {tr("diary.photo.not_open")}
        </AppText>
      )}

      {banner ? <InlineAlert tone={banner.tone} message={banner.text} /> : null}

      {rows.map((row, index) => {
        const v = validateDiaryRow(row, nowMs, LIMITS);
        const problems = !v.ok ? v.problems.filter((p) => p !== "not_confirmed") : [];
        const fb = feedback[row.key];
        const showProblems = (touched[row.key] || row.suggested) && problems.length > 0;
        return (
          <Card key={row.key} style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
              <AppText variant="bodyStrong" style={{ flex: 1 }}>
                {tr("diary.row.number", { n: index + 1 })} · {tr(`diary.kind.${row.kind}` as MessageKey)}
              </AppText>
              <Button
                title={tr("diary.row.remove")}
                variant="secondary"
                fullWidth={false}
                onPress={() => setRows((cur) => (cur.length <= 1 ? [emptyDiaryRow(newKey())] : cur.filter((r) => r.key !== row.key)))}
              />
            </View>
            {row.suggested ? (
              <AppText variant="caption" tone="textMuted">
                {tr("diary.photo.suggested")}
              </AppText>
            ) : null}
            <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
              <Chip label={tr("diary.today")} selected={row.date === diaryTodayLagos(nowMs)} onPress={() => update(row.key, { date: diaryTodayLagos(nowMs) })} />
              <Chip label={tr("diary.yesterday")} selected={row.date === daysAgo(nowMs, 1)} onPress={() => update(row.key, { date: daysAgo(nowMs, 1) })} />
            </View>
            <View style={{ flexDirection: "row", gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Field label={tr("diary.field.date_format")} value={row.date} onChangeText={(x) => update(row.key, { date: x.trim() })} keyboardType="numbers-and-punctuation" maxLength={10} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={tr("diary.field.time_format")} value={row.time} onChangeText={(x) => update(row.key, { time: x.trim() })} keyboardType="numbers-and-punctuation" maxLength={5} />
              </View>
            </View>
            {row.kind === "blood_pressure" ? (
              <>
                <View style={{ flexDirection: "row", gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Field label={tr("diary.field.systolic")} value={row.systolic} onChangeText={(x) => update(row.key, { systolic: x })} keyboardType="number-pad" maxLength={3} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label={tr("diary.field.diastolic")} value={row.diastolic} onChangeText={(x) => update(row.key, { diastolic: x })} keyboardType="number-pad" maxLength={3} />
                  </View>
                </View>
                <Field label={tr("diary.field.pulse")} value={row.pulse} onChangeText={(x) => update(row.key, { pulse: x })} keyboardType="number-pad" maxLength={3} />
              </>
            ) : (
              <>
                <Field label={tr("diary.field.glucose")} value={row.glucose} onChangeText={(x) => update(row.key, { glucose: x })} keyboardType="decimal-pad" maxLength={6} />
                <AppText variant="label" tone="textMuted">
                  {tr("diary.field.unit")}
                </AppText>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Chip label="mmol/L" selected={row.glucoseUnit === "mmol_l"} onPress={() => update(row.key, { glucoseUnit: "mmol_l" })} />
                  <Chip label="mg/dL" selected={row.glucoseUnit === "mg_dl"} onPress={() => update(row.key, { glucoseUnit: "mg_dl" })} />
                </View>
                <AppText variant="label" tone="textMuted">
                  {tr("diary.field.context")}
                </AppText>
                <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                  {DIARY_GLUCOSE_CONTEXTS.map((c) => (
                    <Chip key={c} label={tr(`diary.context.${c}` as MessageKey)} selected={row.glucoseContext === c} onPress={() => update(row.key, { glucoseContext: c })} />
                  ))}
                </View>
              </>
            )}

            {row.suggested ? <TickRow label={tr("diary.row.confirm")} checked={row.confirmed} onToggle={() => update(row.key, { confirmed: !row.confirmed })} /> : null}

            {showProblems ? problems.map((p) => <InlineAlert key={p} tone="danger" message={problemText(p)} />) : null}
            {fb?.kind === "problems" && !showProblems ? fb.problems.map((p) => <InlineAlert key={p} tone="danger" message={problemText(p)} />) : null}
            {fb?.kind === "held" ? <InlineAlert tone="danger" message={HELD_READING_COPY.body} /> : null}
            {fb?.kind === "failed" ? <InlineAlert tone="danger" message={tr("diary.save_failed")} /> : null}
            {fb?.kind === "closed" ? <InlineAlert tone="danger" message={tr("diary.not_open_save")} /> : null}
          </Card>
        );
      })}

      <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
        <Button title={tr("diary.add_bp")} variant="secondary" fullWidth={false} onPress={() => setRows((cur) => [...cur, emptyDiaryRow(newKey(), "blood_pressure" as DiaryKind)])} />
        <Button title={tr("diary.add_glucose")} variant="secondary" fullWidth={false} onPress={() => setRows((cur) => [...cur, emptyDiaryRow(newKey(), "glucose" as DiaryKind)])} />
      </View>

      {summary.unconfirmed > 0 ? <AppText variant="body">{tr("diary.unconfirmed", { count: summary.unconfirmed })}</AppText> : null}
      {summary.blocked.length > 0 ? <AppText variant="body">{tr("diary.fix_first", { count: summary.blocked.length })}</AppText> : null}
      {summary.tooMany ? <InlineAlert tone="danger" message={tr("diary.too_many", { max: LIMITS.maxRows })} /> : null}
      {savedNote ? <InlineAlert tone="info" message={savedNote} /> : null}

      <Button
        title={saving ? tr("diary.saving") : summary.ready.length === 0 ? tr("diary.save_none") : tr("diary.save", { count: summary.ready.length })}
        loading={saving}
        disabled={summary.ready.length === 0 || summary.tooMany}
        onPress={() => void save()}
      />

      <EmergencyGuidanceModal
        visible={guidance !== null}
        detail={guidance?.detail ?? ""}
        synced={guidance?.synced ?? false}
        emergencyContact={emergencyContact}
        doctorReview={doctorReview}
        onDismiss={() => setGuidance(null)}
      />
    </Screen>
  );
}
