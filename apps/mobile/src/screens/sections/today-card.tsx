import { useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import type { Line } from "@/lib/home-model";
import type { SectionId } from "@/lib/sections";
import { loadToday, type TodayLoad } from "@/lib/today";
import type { TodayItem } from "@/lib/today-model";
import { space, radii } from "@/ui/design";
import { AppText, Badge, Button, Card, InlineAlert, ListItem, Skeleton, SkeletonGroup, type IconName } from "@/ui/kit";

const ICON_FOR_KIND: Record<TodayItem["kind"], IconName> = {
  log_bp: "vitals",
  take_medicine: "medication",
  book_test: "labs",
  join_consultation: "appointment",
  read_lesson: "info",
  other: "info",
};

/**
 * What is waiting today: the patient's own tasks and today's doses (lib/today.ts).
 * It loads itself, so it never holds up the rest of Home, and it shows nothing at
 * all when there is nothing to show (an empty list is not worth a card). A
 * source that fails is reported as a calm note, never as an empty list passed off
 * as fact. Status is carried by words and an icon, never colour alone, and there
 * is no streak, score or comparison here.
 */
export function TodayCard({
  patientId,
  onNavigate,
  reloadToken,
}: {
  patientId: string;
  onNavigate: (section: SectionId) => void;
  reloadToken: number;
}) {
  const language = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, language, params);
  const line = (l: Line) => tr(l.key, l.params);
  const [state, setState] = useState<TodayLoad | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    loadToday(patientId)
      .then((res) => alive && setState(res))
      .catch(() => alive && setState(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [patientId, reloadToken]);

  if (loading) {
    return (
      <SkeletonGroup label={tr("today.loading")}>
        <Skeleton height={110} radius={radii.lg} />
      </SkeletonGroup>
    );
  }
  if (!state || (state.list.total === 0 && !state.partial)) return null;

  const { list } = state;
  const rowTitle = (i: TodayItem) => ("text" in i.title ? i.title.text : line(i.title.line));

  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ gap: 2 }}>
        <AppText variant="title" heading>
          {tr("today.title")}
        </AppText>
        {list.total > 0 ? (
          <AppText variant="caption" tone="textMuted">
            {tr("today.summary", { done: list.done.length, total: list.total })}
          </AppText>
        ) : null}
      </View>

      <View>
        {list.shownOpen.map((i) => (
          <ListItem
            key={i.id}
            icon={ICON_FOR_KIND[i.kind]}
            title={rowTitle(i)}
            subtitle={line(i.due)}
            trailing={i.status === "overdue" ? <Badge label={tr("today.due.overdue")} tone="warn" /> : "chevron"}
            onPress={() => onNavigate(i.target)}
          />
        ))}
        {list.done.map((i) => (
          <ListItem
            key={i.id}
            icon="done"
            title={rowTitle(i)}
            subtitle={line(i.due)}
            trailing={<Badge label={tr("today.due.done")} tone="positive" />}
            onPress={() => onNavigate(i.target)}
          />
        ))}
      </View>

      {list.moreCount > 0 ? (
        <Button
          title={`${tr("today.more", { count: list.moreCount })}. ${tr("today.view_all")}`}
          variant="ghost"
          onPress={() => onNavigate("myActions")}
        />
      ) : null}
      {state.partial ? <InlineAlert tone="info" message={tr("today.partial")} /> : null}
    </Card>
  );
}
