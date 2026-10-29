import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { asLocale, AVS_URGENT_KEY, avsItemLabel, t, type MessageKey } from "@tarragon/i18n";
import { visitFollowUpOpen } from "@tarragon/shared";
import { addVisitItemToTasks, loadVisitSummaries, recordVisitSummaryOpened, setVisitItemDone } from "@/lib/visit-summary";
import type { VisitSummary, VisitSummaryItem } from "@/lib/visit-summary/parse";
import { useUiLanguage } from "@/lib/ui-language";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/**
 * "After your visit" (AVS). Plain words from your care team, then a short "what happens next" list to tick off.
 * Only an approved summary is ever returned by the database, so a draft cannot show here. Ticking works with no
 * signal for a moment and no notification at all: the list is the interface. The urgent-care block is the app's existing
 * emergency wording, shown on every summary. Not run on a real device.
 */
export function VisitSummarySection({ onOpenMessages }: { onOpenMessages?: () => void } = {}) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const tr: Translate = useCallback((key, params) => t(key, locale, params), [locale]);
  const [summaries, setSummaries] = useState<VisitSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    const res = await loadVisitSummaries();
    if (res.ok) {
      setSummaries(res.data);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Once per summary per mount; a failure never blocks reading.
  const noted = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const s of summaries) {
      if (noted.current.has(s.id)) continue;
      noted.current.add(s.id);
      void recordVisitSummaryOpened(s.id);
    }
  }, [summaries]);

  if (loading) return <ActivityIndicator color={colors.brand} />;
  if (!failed && summaries.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
        {tr("avs.title")}
      </Text>
      <MutedText>{tr("avs.intro")}</MutedText>
      {failed ? <ErrorText>{tr("avs.error.generic")}</ErrorText> : null}
      {summaries.map((s) => (
        <SummaryCard key={s.id} summary={s} tr={tr} locale={locale} onChanged={refresh} onOpenMessages={onOpenMessages} />
      ))}
    </View>
  );
}

function SummaryCard({
  summary,
  tr,
  locale,
  onChanged,
  onOpenMessages,
}: {
  summary: VisitSummary;
  tr: Translate;
  locale: ReturnType<typeof asLocale>;
  onChanged: () => Promise<void>;
  onOpenMessages?: () => void;
}) {
  const colors = useLegacyColors();
  const [error, setError] = useState(false);

  async function toggle(item: VisitSummaryItem) {
    setError(false);
    const res = await setVisitItemDone(item.id, item.doneAt === null);
    if (!res.ok) {
      setError(true);
      return;
    }
    await onChanged();
  }

  async function addTask(item: VisitSummaryItem) {
    setError(false);
    const res = await addVisitItemToTasks(item.id);
    if (!res.ok) {
      setError(true);
      return;
    }
    await onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      {summary.approvedAt ? (
        <AppText variant="label">
          {summary.approvedByName
            ? tr("avs.checked_by", { name: summary.approvedByName, date: lagosDate(summary.approvedAt) })
            : tr("avs.checked_on", { date: lagosDate(summary.approvedAt) })}
        </AppText>
      ) : null}
      <Text style={{ fontSize: 14, lineHeight: 21, color: colors.ink }}>{summary.summaryText}</Text>

      <AppText variant="bodyStrong" accessibilityRole="header">
        {tr("avs.what_next")}
      </AppText>
      {summary.items.length === 0 ? <MutedText>{tr("avs.what_next.empty")}</MutedText> : null}
      {summary.items.map((item) => {
        const done = item.doneAt !== null;
        return (
          <View key={item.id} style={{ gap: 6 }}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done }}
              accessibilityLabel={done ? tr("avs.item.mark_undone") : tr("avs.item.mark_done")}
              onPress={() => void toggle(item)}
              style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", minHeight: 44 }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  borderWidth: 2,
                  borderColor: colors.brand,
                  backgroundColor: done ? colors.brand : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {done ? <Text style={{ color: "#fff", fontWeight: "700" }}>{"✓"}</Text> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, lineHeight: 20, color: colors.ink, textDecorationLine: done ? "line-through" : "none" }}>
                  {avsItemLabel({ kind: item.kind, params: item.params, customText: item.customText }, locale)}
                </Text>
                {item.dueOn ? <MutedText>{tr("avs.item.due", { date: lagosDate(item.dueOn) })}</MutedText> : null}
              </View>
            </Pressable>
            {item.taskId ? (
              <MutedText>{tr("avs.item.task_added")}</MutedText>
            ) : (
              <SecondaryButton title={tr("avs.item.add_task")} onPress={() => void addTask(item)} />
            )}
          </View>
        );
      })}
      {error ? <ErrorText>{tr("avs.error.generic")}</ErrorText> : null}

      {/* A prompt only (visit.follow_up_prompt): it makes the existing conversation easy to find; it adds no entitlement and promises no reply time. */}
      {onOpenMessages && summary.approvedAt && visitFollowUpOpen(summary.approvedAt, Date.now()) ? (
        <View style={{ gap: 6 }}>
          <AppText variant="bodyStrong" accessibilityRole="header">
            {tr("avs.followup.title")}
          </AppText>
          <MutedText>{tr("avs.followup.body", { date: lagosDate(summary.approvedAt) })}</MutedText>
          <SecondaryButton title={tr("avs.followup.cta")} onPress={onOpenMessages} />
        </View>
      ) : null}

      <View accessibilityRole="summary" style={{ gap: 4, padding: 12, borderRadius: 10, backgroundColor: colors.border }}>
        <AppText variant="bodyStrong">{tr("avs.urgent.title")}</AppText>
        <Text style={{ fontSize: 14, lineHeight: 20, color: colors.ink }}>{tr(AVS_URGENT_KEY)}</Text>
      </View>
    </Card>
  );
}
