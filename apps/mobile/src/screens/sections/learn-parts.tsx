import { useEffect, useState } from "react";
import { Image, Linking, Share, Text, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import {
  formatLagosDate,
  nextStep,
  parseFaq,
  parseInfographic,
  publicShareUrl,
  reviewCredit,
  type LearningItemFields,
} from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { getContentAudioEngine, isPlayableAudioUrl } from "@/lib/content-audio";
import { loadThisWeeksLesson, type ThisWeekLesson } from "@/lib/health-education";
import { useLegacyColors } from "@/ui/design";
import { Card, MutedText, SecondaryButton } from "@/ui/legacy-kit";
import type { SectionId } from "@/lib/sections";

/** Where the public share page lives (S55, 9.8). Only the content code goes in the link. */
const SITE_ORIGIN = "https://tarragonhealth.ng";

function useTr() {
  const locale = asLocale(useUiLanguage());
  return (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
}

/** Reviewer, review date and sources, null-gated exactly like the web. */
export function ReviewCreditBlock({ item }: { item: LearningItemFields & { creator_name?: string | null } }) {
  const colors = useLegacyColors();
  const tr = useTr();
  const credit = reviewCredit(item);
  const sources = credit?.sources ?? [];
  return (
    <View style={{ gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }} testID="review-credit">
      {item.creator_name ? <MutedText>{`Written by ${item.creator_name}`}</MutedText> : null}
      <MutedText>{credit ? tr("learn.review.by", { name: credit.reviewer, date: formatLagosDate(credit.reviewedAt) }) : tr("learn.review.none")}</MutedText>
      {sources.length > 0 ? (
        <MutedText>{`${tr("learn.review.sources")}: ${sources.join("; ")}`}</MutedText>
      ) : null}
    </View>
  );
}

/** The standard "What can I do next?" footer. */
export function NextStepFooter({
  item,
  onNavigate,
  onOpenLesson,
}: {
  item: LearningItemFields;
  onNavigate?: (section: SectionId) => void;
  onOpenLesson?: (code: string) => void;
}) {
  const colors = useLegacyColors();
  const tr = useTr();
  const step = nextStep(item);
  if (!step) return null;
  const action =
    step.kind === "care_plan_goal" && onNavigate
      ? { title: tr("learn.next.goal"), run: () => onNavigate("lifestyle") }
      : step.kind === "booking" && onNavigate
        ? { title: tr("learn.next.booking"), run: () => onNavigate("appointments") }
        : step.kind === "lesson" && step.targetCode && onOpenLesson
          ? { title: `${tr("learn.next.lesson")}: ${step.targetTitle ?? ""}`.trim(), run: () => onOpenLesson(step.targetCode as string) }
          : null;
  return (
    <View style={{ gap: 6, borderWidth: 1, borderColor: colors.brand, borderRadius: 10, padding: 10 }} testID="next-step-footer" accessibilityRole="summary">
      <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>{tr("learn.next.title")}</Text>
      <Text style={{ fontSize: 13, color: colors.ink, lineHeight: 19 }}>{step.label}</Text>
      {action ? <SecondaryButton title={action.title} onPress={action.run} /> : null}
    </View>
  );
}

export function MembersLock({ creatorName }: { creatorName?: string | null }) {
  const colors = useLegacyColors();
  const tr = useTr();
  return (
    <View style={{ gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 }} testID="members-lock">
      <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>{tr("learn.members.title")}</Text>
      <MutedText>{`${creatorName ? `Written by ${creatorName}. ` : ""}${tr("learn.members.body")}`}</MutedText>
    </View>
  );
}

/**
 * Real play and stop for an item's audio file (9.1). With no audio engine registered (no native build yet), shows the written
 * version's notice and offers the file in the phone's own browser or player instead.
 */
export function ContentAudioPlayer({ url }: { url: string }) {
  const tr = useTr();
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const engine = getContentAudioEngine();

  useEffect(() => () => getContentAudioEngine()?.stop(), []);

  if (!isPlayableAudioUrl(url)) return null;

  if (!engine) {
    return (
      <View style={{ gap: 6 }}>
        <MutedText>{tr("learn.audio.unavailable")}</MutedText>
        <SecondaryButton title={tr("learn.audio.play")} onPress={() => void Linking.openURL(url).catch(() => undefined)} />
      </View>
    );
  }

  async function toggle() {
    if (playing) {
      engine?.stop();
      setPlaying(false);
      return;
    }
    setFailed(false);
    setPlaying(true);
    try {
      await engine?.play(url);
    } catch {
      setFailed(true);
    } finally {
      setPlaying(false);
    }
  }

  return (
    <View style={{ gap: 6 }}>
      <SecondaryButton title={playing ? tr("learn.audio.stop") : tr("learn.audio.play")} onPress={toggle} />
      {failed ? <MutedText>{tr("learn.audio.unavailable")}</MutedText> : null}
    </View>
  );
}

export function FaqBlock({ body }: { body: string }) {
  const colors = useLegacyColors();
  const [open, setOpen] = useState<string | null>(null);
  const entries = parseFaq(body);
  if (!entries) return <Text style={{ fontSize: 13, color: colors.ink, lineHeight: 19 }}>{body}</Text>;
  return (
    <View style={{ gap: 6 }} testID="faq-block">
      {entries.map((e) => (
        <View key={e.question} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, gap: 4 }}>
          <Text accessibilityRole="button" onPress={() => setOpen(open === e.question ? null : e.question)} style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>
            {e.question}
          </Text>
          {open === e.question ? <Text style={{ fontSize: 13, color: colors.ink, lineHeight: 19 }}>{e.answer}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function InfographicBlock({ body }: { body: string }) {
  const colors = useLegacyColors();
  const { imageUrl, alt, text } = parseInfographic(body);
  return (
    <View style={{ gap: 8 }} testID="infographic-block">
      {imageUrl ? <Image source={{ uri: imageUrl }} accessibilityLabel={alt} accessible style={{ width: "100%", height: 240 }} resizeMode="contain" /> : null}
      {text ? <Text style={{ fontSize: 13, color: colors.ink, lineHeight: 19 }}>{text}</Text> : null}
    </View>
  );
}

/** Share by link or email (9.8): the phone's own share sheet offers both. Shown only for an item flagged public. */
export function ShareRow({ code, title }: { code: string; title: string }) {
  const url = publicShareUrl(SITE_ORIGIN, code);
  return (
    <SecondaryButton
      title="Share"
      onPress={() => void Share.share({ title, message: `${title}\n${url}`, url }).catch(() => undefined)}
    />
  );
}

/** "This week's lesson" for Today (S55, 9.2): one short lesson, weekly pacing, nothing when there is none. */
export function ThisWeeksLessonCard({ onOpen }: { onOpen: (code: string) => void }) {
  const colors = useLegacyColors();
  const tr = useTr();
  const [lesson, setLesson] = useState<ThisWeekLesson | null>(null);

  useEffect(() => {
    let live = true;
    loadThisWeeksLesson()
      .then((l) => {
        if (live) setLesson(l);
      })
      .catch(() => {
        if (live) setLesson(null);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!lesson) return null;
  return (
    <Card style={{ gap: 6 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>
        {lesson.is_current_week ? tr("learn.week.title") : tr("learn.week.catch_up")}
        {lesson.estimated_minutes ? `  ·  ${tr("learn.week.minutes", { minutes: lesson.estimated_minutes })}` : ""}
      </Text>
      <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{lesson.title}</Text>
      {lesson.summary ? <MutedText>{lesson.summary}</MutedText> : null}
      <SecondaryButton title={tr("learn.week.start")} onPress={() => onOpen(lesson.code)} />
    </Card>
  );
}
