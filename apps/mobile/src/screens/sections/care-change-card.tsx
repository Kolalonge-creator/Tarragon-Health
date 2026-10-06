import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, buildChangeSentences, historyLine, outcomeMessageKey, signedLine, splitCareChanges, t, type CareChange, type MessageKey } from "@tarragon/i18n";
import { confirmCareChange, declineCareChange, formatChangeDate, loadCareChanges } from "@/lib/care-changes";
import { useUiLanguage } from "@/lib/ui-language";
import { space } from "@/ui/design";
import { AppText, Button, Card, InlineAlert } from "@/ui/kit";

/**
 * "Your care team has a change for you" (S24) on the Medicines tab. Two buttons of equal weight (same variant),
 * no countdown, nothing pre-ticked, and nothing changes until the patient says yes. Answering needs a connection:
 * offline shows a plain message and nothing is queued.
 */
export function CareChangeCard() {
  const locale = asLocale(useUiLanguage());
  const tr = useCallback((key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params), [locale]);
  const [changes, setChanges] = useState<CareChange[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, MessageKey>>({});

  const load = useCallback(async () => {
    const result = await loadCareChanges();
    if (result.ok) {
      setChanges(result.changes);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function answer(change: CareChange, yes: boolean) {
    if (busyId) return;
    setBusyId(change.id);
    setMessages((prev) => {
      const next = { ...prev };
      delete next[change.id];
      return next;
    });
    try {
      let key: MessageKey;
      let answered = false;
      if (yes) {
        const result = await confirmCareChange(change.id);
        answered = result.ok;
        key = result.ok ? outcomeMessageKey(result.outcome, change.kind, true) : result.key;
      } else {
        const result = await declineCareChange(change.id);
        answered = result.ok;
        key = result.key;
      }
      setMessages((prev) => ({ ...prev, [change.id]: key }));
      if (answered) await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loadFailed && changes === null) {
    return (
      <Card style={{ gap: space.sm }}>
        <AppText variant="bodyStrong">{tr("careChange.title")}</AppText>
        <InlineAlert tone="info" message={tr("careChange.outcome.error")} />
      </Card>
    );
  }
  if (!changes) return null;
  const { waiting, history } = splitCareChanges(changes);
  const lines = history
    .map((c) => ({ id: c.id, line: historyLine(c, formatChangeDate, tr) }))
    .filter((h): h is { id: string; line: string } => h.line !== null);
  // A change that was just answered leaves the waiting list on reload; keep its message visible until then.
  const answeredMessages = Object.entries(messages).filter(([id]) => !waiting.some((w) => w.id === id));
  if (waiting.length === 0 && lines.length === 0 && answeredMessages.length === 0) return null;

  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title" heading>
        {tr("careChange.title")}
      </AppText>

      {waiting.map((change) => {
        const sentences = buildChangeSentences(change, tr);
        const signed = signedLine(change, formatChangeDate, tr);
        const message = messages[change.id];
        return (
          <View key={change.id} style={{ gap: space.sm }}>
            <AppText variant="bodyStrong">{sentences.heading}</AppText>
            <AppText variant="caption" tone="textMuted">
              {tr("careChange.what")}
            </AppText>
            {sentences.before !== null ? <AppText variant="body">{`${tr("careChange.before")}: ${sentences.before}`}</AppText> : null}
            {sentences.after !== null ? <AppText variant="body">{`${tr("careChange.after")}: ${sentences.after}`}</AppText> : null}
            {change.summary ? (
              <View style={{ gap: space.xs }}>
                <AppText variant="caption" tone="textMuted">
                  {tr("careChange.why")}
                </AppText>
                <AppText variant="body">{change.summary}</AppText>
              </View>
            ) : null}
            {signed ? (
              <AppText variant="caption" tone="textMuted">
                {signed}
              </AppText>
            ) : null}
            <AppText variant="body">{tr("careChange.promise")}</AppText>
            <Button title={tr("careChange.yes")} variant="secondary" disabled={busyId !== null} loading={busyId === change.id} onPress={() => void answer(change, true)} />
            <Button title={tr("careChange.no")} variant="secondary" disabled={busyId !== null} onPress={() => void answer(change, false)} />
            {message ? <InlineAlert tone="info" message={tr(message)} /> : null}
          </View>
        );
      })}

      {answeredMessages.map(([id, key]) => (
        <InlineAlert key={id} tone="info" message={tr(key)} />
      ))}

      {lines.length > 0 ? (
        <View style={{ gap: space.xs }}>
          <AppText variant="caption" tone="textMuted">
            {tr("careChange.history.title")}
          </AppText>
          {lines.map((h) => (
            <AppText key={h.id} variant="caption" tone="textMuted">
              {h.line}
            </AppText>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
