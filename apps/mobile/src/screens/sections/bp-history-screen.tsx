import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { askForCorrection, loadBpHistory, type BpHistoryLoad } from "@/lib/bp-history";
import {
  buildHistory,
  lagosClock,
  lagosDateText,
  type HistoryRow,
  type RequestPhase,
} from "@/lib/bp-history-model";
import { useUiLanguage } from "@/lib/ui-language";
import { space } from "@/ui/design";
import { AppText, Badge, Button, Card, EmptyState, Field, InlineAlert, Sheet, Skeleton, SkeletonGroup, useToast, Screen, type BadgeTone } from "@/ui/kit";
import { SyncBanner } from "@/screens/sync-banner";

interface BpHistoryScreenProps {
  /** Whose readings are shown: the signed-in person, or the person being acted for. */
  patientId: string;
  /** The signed-in person. A correction request is always filed under them. */
  userId: string;
  organisationId: string;
}

const PHASE_KEY: Record<RequestPhase, MessageKey> = {
  open: "history.request.open",
  approved: "history.request.approved",
  applied: "history.request.applied",
  denied: "history.request.denied",
};

/**
 * Own blood pressure readings by day, with whether each reached the care team and
 * where any correction request stands. It grades nothing and edits nothing: a
 * patient can only ask, and the care team decides (see lib/bp-history-model.ts).
 */
export function BpHistoryScreen({ patientId, userId, organisationId }: BpHistoryScreenProps) {
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const toast = useToast();

  const [data, setData] = useState<BpHistoryLoad | null>(null);
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState<HistoryRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadBpHistory(patientId, userId));
    } catch {
      setData({ readings: [], requests: [], corrections: [], canRequest: false, failed: true });
    } finally {
      setLoading(false);
    }
  }, [patientId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(
    () => (data ? buildHistory({ readings: data.readings, requests: data.requests, corrections: data.corrections, canRequest: data.canRequest }) : []),
    [data],
  );
  const own = patientId === userId;

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>
          {tr("history.title")}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {tr("history.subtitle")}
        </AppText>
      </View>

      <SyncBanner />

      <InlineAlert tone="info" message={tr("history.unwell")} />
      {!own ? <InlineAlert tone="info" message={tr("history.ask.own_only")} /> : data && !data.canRequest ? <InlineAlert tone="info" message={tr("history.ask.offline")} /> : null}

      {loading ? (
        <SkeletonGroup label={tr("history.title")}>
          <Skeleton width="100%" height={72} />
          <Skeleton width="100%" height={72} style={{ marginTop: space.sm }} />
          <Skeleton width="100%" height={72} style={{ marginTop: space.sm }} />
        </SkeletonGroup>
      ) : data?.failed ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="title" heading>
            {tr("history.error.title")}
          </AppText>
          <AppText variant="body" tone="textMuted">
            {tr("history.error.body")}
          </AppText>
          <Button title={tr("history.retry")} onPress={() => void load()} variant="secondary" />
        </Card>
      ) : days.length === 0 ? (
        <EmptyState icon="heart" title={tr("history.empty.title")} body={tr("history.empty.body")} />
      ) : (
        days.map((day) => (
          <View key={day.localDate} style={{ gap: space.sm }}>
            <AppText variant="label" tone="textMuted" accessibilityRole="header">
              {tr("history.day", { weekday: tr(`meds.weekday.${day.weekday}` as MessageKey), date: day.dayMonth })}
            </AppText>
            {day.rows.map((row) => (
              <ReadingCard key={row.reading.id} row={row} tr={tr} onAsk={() => setAsking(row)} />
            ))}
          </View>
        ))
      )}

      <AskSheet
        row={asking}
        tr={tr}
        onClose={() => setAsking(null)}
        onSend={async (wrong, change) => {
          if (!asking) return false;
          const res = await askForCorrection(organisationId, userId, asking.reading, wrong, change);
          if (!res.ok) return res.reason === "empty" ? "empty" : "failed";
          toast.show({ message: tr("history.ask.sent"), tone: "success" });
          setAsking(null);
          await load();
          return true;
        }}
      />
    </Screen>
  );
}

function ReadingCard({ row, tr, onAsk }: { row: HistoryRow; tr: (k: MessageKey, p?: Record<string, string | number>) => string; onAsk: () => void }) {
  const { reading, request, correction } = row;
  const ms = Date.parse(reading.takenAt);
  const time = lagosClock(ms);
  const syncTone: BadgeTone = reading.syncState === "sent" ? "positive" : reading.syncState === "on_phone" ? "neutral" : "warn";
  const syncText =
    reading.syncState === "not_accepted"
      ? tr("history.sync.not_accepted", { code: reading.supportCode ?? "" })
      : tr(`history.sync.${reading.syncState}` as MessageKey);

  return (
    <Card style={{ gap: space.sm }}>
      <AppText
        variant="bodyStrong"
        accessibilityLabel={tr("history.a11y.reading", { systolic: reading.systolic, diastolic: reading.diastolic, time })}
      >
        {tr("history.reading", { systolic: reading.systolic, diastolic: reading.diastolic, time })}
      </AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
        <Badge label={tr(`history.source.${reading.source}` as MessageKey)} />
        <Badge label={syncText} tone={syncTone} />
      </View>
      {correction ? (
        <View style={{ gap: space.xs }}>
          <AppText variant="body">{tr("history.corrected", { date: lagosDateText(correction.correctedAt) })}</AppText>
          {correction.before && correction.after ? (
            <AppText variant="body" tone="textMuted">
              {tr("history.corrected.change", { before: correction.before, after: correction.after })}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {request ? (
        <View style={{ gap: space.xs }}>
          <AppText variant="body" tone="textMuted">
            {tr(PHASE_KEY[request.phase])}
          </AppText>
          {request.decisionNote && request.phase === "denied" ? (
            <AppText variant="body" tone="textMuted">
              {tr("history.request.note", { note: request.decisionNote })}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {row.canAsk ? <Button title={request ? tr("history.ask.again") : tr("history.ask")} onPress={onAsk} variant="secondary" fullWidth={false} /> : null}
    </Card>
  );
}

function AskSheet({
  row,
  tr,
  onClose,
  onSend,
}: {
  row: HistoryRow | null;
  tr: (k: MessageKey, p?: Record<string, string | number>) => string;
  onClose: () => void;
  onSend: (wrong: string, change: string) => Promise<true | "empty" | "failed" | false>;
}) {
  const [wrong, setWrong] = useState("");
  const [change, setChange] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh form for each reading.
  const id = row?.reading.id ?? null;
  useEffect(() => {
    setWrong("");
    setChange("");
    setError(null);
  }, [id]);

  const reading = row?.reading;
  const ms = reading ? Date.parse(reading.takenAt) : NaN;

  async function send() {
    setError(null);
    setSending(true);
    const res = await onSend(wrong, change);
    setSending(false);
    if (res === "empty") setError(tr("history.ask.empty"));
    else if (res === "failed") setError(tr("history.ask.failed"));
  }

  return (
    <Sheet visible={!!row} onClose={onClose} title={tr("history.ask.title")}>
      {reading ? (
        <View style={{ gap: space.md }}>
          <AppText variant="bodyStrong">
            {tr("history.ask.reading", {
              systolic: reading.systolic,
              diastolic: reading.diastolic,
              date: lagosDateText(reading.takenAt),
              time: lagosClock(ms),
            })}
          </AppText>
          <AppText variant="body" tone="textMuted">
            {tr("history.ask.intro")}
          </AppText>
          <Field label={tr("history.ask.wrong")} hint={tr("history.ask.wrong.hint")} value={wrong} onChangeText={setWrong} multiline maxLength={1000} error={error} />
          <Field label={tr("history.ask.change")} value={change} onChangeText={setChange} multiline maxLength={1000} />
          <Button title={sending ? tr("history.ask.sending") : tr("history.ask.send")} onPress={() => void send()} loading={sending} />
        </View>
      ) : null}
    </Sheet>
  );
}
