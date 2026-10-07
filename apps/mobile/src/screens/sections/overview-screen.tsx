import { useCallback, useEffect, useState } from "react";
import { Linking, RefreshControl, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { formatGlucose, GLUCOSE_UNIT_LABEL } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { useGlucoseDisplayUnit } from "@/lib/glucose-unit";
import { GetStartedCard, isFirstRun, shouldShowGetStarted } from "@/screens/sections/get-started-card";
import {
  getCareSchedule,
  getCareTeam,
  getRecentActivity,
  getSummaryStats,
  getUpcomingVideoVisit,
  type CareTeamInfo,
  type RecentActivityItem,
  type ScheduleItem,
  type SummaryStats,
  type UpcomingVideoVisit,
} from "@/lib/overview";
import { getPendingPaymentIssue, type PendingPaymentIssue } from "@/lib/services";
import { PaymentIssueCard } from "@/screens/sections/payment-issue-card";
import { HowYoureDoingCard } from "@/screens/sections/how-youre-doing-card";
import { TodayCard } from "@/screens/sections/today-card";
import { ThisWeeksLessonCard } from "@/screens/sections/learn-parts";
import { requestLesson } from "@/lib/learn-intent";
import { todayIsoDate } from "@/lib/medications";
import { agoLine, dueLine, formatVisitTime, heroMetric, nextBestStep, type Line } from "@/lib/home-model";
import { lightPalette, radii, space, useTheme } from "@/ui/design";
import { AppText, Button, Card, Icon, InlineAlert, ListItem, PressableScale, Screen, Skeleton, SkeletonGroup, type IconName } from "@/ui/kit";
import type { SectionId } from "@/lib/sections";

interface OverviewScreenProps {
  patientId: string;
  patientName: string;
  onNavigate: (section: SectionId) => void;
  onOpenVideoVisit: (consultationId: string) => void;
}

export function OverviewScreen({ patientId, patientName, onNavigate, onOpenVideoVisit }: OverviewScreenProps) {
  const glucoseUnit = useGlucoseDisplayUnit();
  const uiLanguage = useUiLanguage();
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [careTeam, setCareTeam] = useState<CareTeamInfo | null>(null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [activity, setActivity] = useState<RecentActivityItem[]>([]);
  const [videoVisit, setVideoVisit] = useState<UpcomingVideoVisit | null>(null);
  const [paymentIssue, setPaymentIssue] = useState<PendingPaymentIssue | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scoreReloadToken, setScoreReloadToken] = useState(0);
  // A failed stats fetch must never render as "Active meds 0" — the screen
  // shows an explicit error state instead (statsError), and a failure in any
  // of the secondary cards shows an inline retry notice (partialError)
  // rather than silently hiding the card as if it were empty.
  const [statsError, setStatsError] = useState(false);
  const [partialError, setPartialError] = useState(false);

  const load = useCallback(async () => {
    const [s, ct, sc, act, vv, pi] = await Promise.all([
      getSummaryStats(patientId),
      getCareTeam(patientId),
      getCareSchedule(patientId),
      getRecentActivity(patientId),
      getUpcomingVideoVisit(patientId),
      getPendingPaymentIssue(patientId),
    ]);
    setStats(s.ok ? s.data : null);
    setStatsError(!s.ok);
    if (ct.ok) setCareTeam(ct.data);
    if (sc.ok) setSchedule(sc.data);
    if (act.ok) setActivity(act.data);
    if (vv.ok) setVideoVisit(vv.data);
    if (pi.ok) setPaymentIssue(pi.data);
    setPartialError(!ct.ok || !sc.ok || !act.ok || !vv.ok || !pi.ok);
  }, [patientId]);

  useEffect(() => {
    load()
      .catch(() => setStatsError(true))
      .finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setScoreReloadToken((n) => n + 1);
    load()
      .catch(() => setStatsError(true))
      .finally(() => setRefreshing(false));
  }, [load]);

  const retry = useCallback(() => {
    setLoading(true);
    setStatsError(false);
    load()
      .catch(() => setStatsError(true))
      .finally(() => setLoading(false));
  }, [load]);

  const { colors } = useTheme();
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, asLocale(uiLanguage), params);
  const line = (l: Line) => tr(l.key, l.params);
  const firstName = patientName.split(/\s+/)[0] ?? patientName;

  if (loading) {
    return (
      <Screen>
        <SkeletonGroup label={tr("home.loading")}>
          <View style={{ gap: space.lg }}>
            <Skeleton height={28} width="60%" />
            <Skeleton height={170} radius={radii.lg} />
            <Skeleton height={80} radius={radii.lg} />
            <Skeleton height={80} radius={radii.lg} />
          </View>
        </SkeletonGroup>
      </Screen>
    );
  }

  if (statsError || !stats) {
    return (
      <Screen>
        <Card style={{ gap: space.md }}>
          <InlineAlert tone="info" message={`${tr("home.error.title")}. ${tr("home.error.body")}`} />
          <Button title={tr("home.error.retry")} variant="secondary" onPress={retry} />
        </Card>
      </Screen>
    );
  }

  // Same two questions as web's Overview: whether to offer the setup steps,
  // and whether the account is empty enough that the stat tiles could only
  // render dashes.
  const progress = {
    hasRiskAssessment: stats.hasRiskAssessment,
    hasAnyVitals: stats.lastVitalTakenAt !== null,
    hasMedications: stats.activeMedicationCount > 0,
  };
  const showGetStarted = shouldShowGetStarted(progress);
  const firstRun = isFirstRun(progress);

  const step = nextBestStep(stats, todayIsoDate());
  const hero = heroMetric(stats, glucoseUnit);
  const dash = "-";

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}>
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>
          {tr("home.title", { name: firstName })}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {tr("home.subtitle")}
        </AppText>
      </View>

      {partialError ? (
        <PressableScale onPress={onRefresh} accessibilityRole="button" accessibilityLabel={tr("home.partial_error")}>
          <InlineAlert tone="info" message={tr("home.partial_error")} />
        </PressableScale>
      ) : null}

      {/* §91.10: an unpaid, abandoned checkout is more urgent than a wellness nudge, so
          it renders above the hero band, same as web's Overview. Nothing when no payment problem. */}
      {paymentIssue ? <PaymentIssueCard key={paymentIssue.id} issue={paymentIssue} onResolved={() => void load().catch(() => {})} /> : null}

      <HowYoureDoingCard patientId={patientId} reloadToken={scoreReloadToken} />

      {/* Hero band: deep brand green with on-brand type only. Clinical status colours never
          sit on this surface, and no fake value ever renders: with no reading of any kind the
          number gives way to a warm prompt. */}
      <View style={{ backgroundColor: colors.brand, borderRadius: radii.lg, padding: space.xl, gap: space.lg }}>
        {hero ? (
          <View style={{ gap: space.xs }}>
            <AppText variant="label" tone="textOnBrand" style={{ opacity: 0.92 }}>
              {tr(hero.label)}
            </AppText>
            <AppText variant="hero" tone="textOnBrand" accessibilityLabel={`${tr(hero.label)}: ${hero.value} ${hero.unit ?? ""}`.trim()}>
              {hero.value}
              {hero.unit ? (
                <AppText variant="bodyLarge" tone="textOnBrand" style={{ opacity: 0.92 }}>
                  {" "}
                  {hero.unit}
                </AppText>
              ) : null}
            </AppText>
          </View>
        ) : (
          <AppText variant="bodyLarge" tone="textOnBrand">
            {tr("home.hero.empty")}
          </AppText>
        )}

        <View style={{ height: 1, backgroundColor: colors.textOnBrand, opacity: 0.25 }} />

        <View style={{ gap: space.xs }}>
          <AppText variant="label" tone="textOnBrand" style={{ opacity: 0.92 }}>
            {tr("home.next.label")}
          </AppText>
          <AppText variant="title" tone="textOnBrand" heading>
            {line(step.title)}
          </AppText>
          <AppText variant="body" tone="textOnBrand">
            {line(step.body)}
          </AppText>
          <PressableScale
            onPress={() => onNavigate(step.target)}
            accessibilityRole="button"
            accessibilityLabel={line(step.cta)}
            style={{ alignSelf: "flex-start", backgroundColor: lightPalette.surface, borderRadius: radii.pill, paddingHorizontal: space.xl, justifyContent: "center", marginTop: space.sm }}
          >
            {/* A white pill on the brand band in both schemes, so its text is the light palette's green. */}
            <AppText variant="bodyStrong" style={{ color: lightPalette.brandText }}>
              {line(step.cta)}
            </AppText>
          </PressableScale>
        </View>
      </View>

      {videoVisit ? (
        <Card style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
            <Icon name="video" size={22} tone="brandText" />
            <View style={{ flex: 1 }}>
              <AppText variant="label" tone="textMuted">
                {tr("home.visit.label")}
              </AppText>
              <AppText variant="bodyStrong">{formatVisitTime(videoVisit.scheduledAt)}</AppText>
            </View>
          </View>
          {videoVisit.joinUrl ? (
            // A standard Zoom join link: Linking.openURL hands off to the native Zoom app if
            // installed, or the Zoom web client otherwise (MOBILE_APP_SPEC.md section 8).
            <Button title={tr("home.visit.join")} onPress={() => void Linking.openURL(videoVisit.joinUrl!).catch(() => {})} />
          ) : (
            <AppText variant="body" tone="textMuted">
              {tr("home.visit.no_link")}
            </AppText>
          )}
          <Button title={tr("home.visit.details")} variant="secondary" onPress={() => onOpenVideoVisit(videoVisit.id)} />
        </Card>
      ) : null}

      {/* After the video visit card: a visit that starts soon must stay near the top. */}
      <TodayCard patientId={patientId} onNavigate={onNavigate} reloadToken={scoreReloadToken} />

      {/* One short lesson for the week (S55, 9.2); nothing when there is none. */}
      <ThisWeeksLessonCard
        onOpen={(code) => {
          requestLesson(code);
          onNavigate("learn");
        }}
      />

      {showGetStarted ? <GetStartedCard progress={progress} onNavigate={onNavigate} /> : null}

      <View style={{ gap: space.md }}>
        {/* On an empty account these tiles could only read dashes and zeros. The quick actions
            below them stay: those are how a patient puts the first number there. */}
        {firstRun ? null : (
          <>
            <AppText variant="title" heading>
              {tr("home.numbers.heading")}
            </AppText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
              <StatTile icon="heart" label={tr("home.stat.bp")} value={stats.latestBp ? `${stats.latestBp.systolic}/${stats.latestBp.diastolic}` : dash} unit="mmHg" />
              <StatTile
                icon="glucose"
                label={tr("home.stat.glucose")}
                value={formatGlucose(stats.latestGlucoseMmolL, glucoseUnit, { withUnit: false }) ?? dash}
                unit={GLUCOSE_UNIT_LABEL[glucoseUnit]}
              />
              <StatTile icon="medication" label={tr("home.stat.meds")} value={String(stats.activeMedicationCount)} />
              <StatTile icon="done" label={tr("home.stat.doses")} value={`${stats.dosesTaken}/${stats.dosesTotal}`} />
            </View>
          </>
        )}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
          <ActionTile icon="vitals" label={tr("home.action.reading")} onPress={() => onNavigate("vitals")} />
          <ActionTile icon="medication" label={tr("home.action.meds")} onPress={() => onNavigate("medications")} />
          <ActionTile icon="messages" label={tr("home.action.messages")} onPress={() => onNavigate("messages")} />
          <ActionTile icon="labs" label={tr("home.action.labs")} onPress={() => onNavigate("labs")} />
        </View>
      </View>

      {/* Where paid-per-service doctor time is bought. Placed after the clinical snapshot
          rather than above it (brand voice: no upsell-first dashboard). */}
      <View style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {tr("home.services.heading")}
        </AppText>
        <Card padded={false}>
          <ListItem icon="card" title={tr("home.services.title")} subtitle={tr("home.services.body")} onPress={() => onNavigate("services")} />
        </Card>
      </View>

      {schedule.length > 0 ? (
        <View style={{ gap: space.md }}>
          <AppText variant="title" heading>
            {tr("home.schedule.heading")}
          </AppText>
          <Card padded={false}>
            {schedule.map((item, index) => (
              <View key={`${item.type}:${item.title}:${item.dueDate}`} style={index > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}>
                <ListItem
                  title={item.title}
                  subtitle={item.type}
                  trailing={
                    <AppText variant="caption" tone="textSubtle">
                      {line(dueLine(item.dueDate))}
                    </AppText>
                  }
                />
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {careTeam ? (
        /* care_team_assignment.clinician_id is internal routing only: deliberately never rendered
           as a named "your doctor" ahead of a review actually happening. A doctor is named only
           once they have reviewed something specific (ReviewedByDoctor's job, not this card's). */
        <Card style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
            <Icon name="person" size={22} tone="brandText" />
            <AppText variant="bodyStrong" style={{ flex: 1 }}>
              {tr("home.team.title")}
            </AppText>
          </View>
          <AppText variant="body" tone="textMuted">
            {tr("home.team.body")}
          </AppText>
          <Button title={tr("home.team.message")} variant="secondary" onPress={() => onNavigate("messages")} accessibilityHint={tr("home.team.message_a11y")} />
        </Card>
      ) : null}

      <View style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {tr("home.activity.heading")}
        </AppText>
        {activity.length === 0 ? (
          <Card>
            <AppText variant="body" tone="textMuted">
              {tr("home.activity.empty")}
            </AppText>
          </Card>
        ) : (
          <>
            <Card padded={false}>
              {activity.map((item, index) => (
                <View key={item.id} style={index > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}>
                  <ListItem title={item.title} subtitle={line(agoLine(item.occurredAt))} />
                </View>
              ))}
            </Card>
            <Button title={tr("home.activity.timeline")} variant="ghost" fullWidth={false} onPress={() => onNavigate("timeline")} />
          </>
        )}
      </View>

      <View style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {tr("home.help.heading")}
        </AppText>
        <Card padded={false}>
          <ListItem icon="messages" title={tr("home.help.chat_title")} subtitle={tr("home.help.chat_body")} onPress={() => onNavigate("messages")} />
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
            <ListItem icon="support" title={tr("home.help.support_title")} subtitle={tr("home.help.support_body")} onPress={() => onNavigate("care")} />
          </View>
        </Card>
      </View>
    </Screen>
  );
}

function StatTile({ icon, label, value, unit }: { icon: IconName; label: string; value: string; unit?: string }) {
  return (
    <View style={{ flexBasis: "47%", flexGrow: 1 }} accessible accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ""}`}>
      <Card style={{ gap: space.sm }}>
        <Icon name={icon} size={18} tone="brandText" />
        <AppText variant="caption" tone="textMuted">
          {label}
        </AppText>
        <AppText variant="stat">
          {value}
          {unit ? (
            <AppText variant="caption" tone="textSubtle">
              {" "}
              {unit}
            </AppText>
          ) : null}
        </AppText>
      </Card>
    </View>
  );
}

function ActionTile({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexBasis: "47%", flexGrow: 1 }}>
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={{ backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.sm }}
      >
        <Icon name={icon} size={22} tone="brandText" />
        <AppText variant="bodyStrong">{label}</AppText>
      </PressableScale>
    </View>
  );
}
