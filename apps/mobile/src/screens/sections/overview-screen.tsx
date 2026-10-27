import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, RefreshControl, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { lockedHomePins, resolveHomePins, type HomePinKey, type HomePinVitalValue, type HomeValuePinKey } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { useGlucoseDisplayUnit } from "@/lib/glucose-unit";
import { getMeasurementUnits } from "@/lib/measurement-units";
import { loadMonitoredVitals, loadPinnedVitalValues, loadStoredHomePins, saveHomePins } from "@/lib/home-pins";
import { HomePinTiles } from "@/screens/sections/home-pin-tiles";
import { ManageHomePinsSheet } from "@/screens/sections/manage-home-pins-sheet";
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
import { AccountNotices } from "@/screens/sections/account-notices";
import { HowYoureDoingCard } from "@/screens/sections/how-youre-doing-card";
import { TodayPlan } from "@/screens/sections/today-plan";
import { LessonFooter, WeeklyLessonCard } from "@/screens/sections/learning-sections";
import { RecordLessonCardNative } from "@/screens/sections/learning-quality-sections";
import { HomeCheckCard } from "@/screens/sections/home-check-card";
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
  /** The signed-in patient's own organisation; omitted when acting for someone else (the weekly lesson is the person's own). */
  organisationId?: string;
}

export function OverviewScreen({ patientId, patientName, onNavigate, onOpenVideoVisit, organisationId }: OverviewScreenProps) {
  const glucoseUnit = useGlucoseDisplayUnit();
  const uiLanguage = useUiLanguage();
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [careTeam, setCareTeam] = useState<CareTeamInfo | null>(null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [activity, setActivity] = useState<RecentActivityItem[]>([]);
  const [videoVisit, setVideoVisit] = useState<UpcomingVideoVisit | null>(null);
  const [paymentIssue, setPaymentIssue] = useState<PendingPaymentIssue | null>(null);
  // The patient's saved pinned tiles (null = never customised) and the latest value behind each vitals pin.
  const [storedPins, setStoredPins] = useState<string[] | null>(null);
  const [vitalValues, setVitalValues] = useState<Partial<Record<HomeValuePinKey, HomePinVitalValue>>>({});
  const [manageOpen, setManageOpen] = useState(false);
  // A failed layout read shows the defaults but must not offer Customise: saving from them would overwrite a layout we could not see.
  const [pinsReadFailed, setPinsReadFailed] = useState(false);
  // The vitals this patient's programme monitors: their pins cannot be switched off. null = not read (or the read failed).
  const [monitoredVitals, setMonitoredVitals] = useState<string[] | null>(null);
  // A failed vitals read must read as "couldn't load", never "no reading yet".
  const [vitalsFailed, setVitalsFailed] = useState(false);
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
    const [s, ct, sc, act, vv, pi, pinsRes, monitoredRes] = await Promise.all([
      getSummaryStats(patientId),
      getCareTeam(patientId),
      getCareSchedule(patientId),
      getRecentActivity(patientId),
      getUpcomingVideoVisit(patientId),
      getPendingPaymentIssue(patientId),
      loadStoredHomePins(patientId),
      loadMonitoredVitals(patientId),
    ]);
    setStats(s.ok ? s.data : null);
    setStatsError(!s.ok);
    if (ct.ok) setCareTeam(ct.data);
    if (sc.ok) setSchedule(sc.data);
    if (act.ok) setActivity(act.data);
    if (vv.ok) setVideoVisit(vv.data);
    if (pi.ok) setPaymentIssue(pi.data);
    setPartialError(!ct.ok || !sc.ok || !act.ok || !vv.ok || !pi.ok);
    // A failed pins read falls back to the default tiles; it is not worth an error banner.
    const saved = pinsRes.ok ? pinsRes.data : null;
    setStoredPins(saved);
    setPinsReadFailed(!pinsRes.ok);
    const monitored = monitoredRes.ok ? monitoredRes.data : null;
    setMonitoredVitals(monitored);
    const shown = resolveHomePins(saved, { activeMedicationCount: s.ok ? s.data.activeMedicationCount : 0, monitoredVitals: monitored ?? [] });
    const values = await loadPinnedVitalValues(patientId, shown, await getMeasurementUnits());
    setVitalsFailed(!values.ok);
    if (values.ok) setVitalValues(values.data);
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

  const activeMeds = stats?.activeMedicationCount ?? 0;
  const pinContext = { activeMedicationCount: activeMeds, monitoredVitals: monitoredVitals ?? [] };
  const pins = useMemo(
    () => resolveHomePins(storedPins, { activeMedicationCount: activeMeds, monitoredVitals: monitoredVitals ?? [] }),
    [storedPins, activeMeds, monitoredVitals],
  );
  // Only the patient's own account has a layout to change; the organisation id is omitted when acting for someone else.
  // Not offered when the monitored vitals could not be read either: a save would not know what must stay.
  const canCustomise = organisationId !== undefined && !pinsReadFailed && monitoredVitals !== null;

  const savePins = useCallback(
    async (next: HomePinKey[]): Promise<boolean> => {
      if (!organisationId) return false;
      const result = await saveHomePins(patientId, organisationId, next, { activeMedicationCount: activeMeds, monitoredVitals: monitoredVitals ?? [] });
      if (!result.ok) return false;
      setStoredPins(result.data);
      const values = await loadPinnedVitalValues(patientId, result.data, await getMeasurementUnits());
      setVitalsFailed(!values.ok);
      if (values.ok) setVitalValues(values.data);
      return true;
    },
    [patientId, organisationId, activeMeds, monitoredVitals],
  );

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

      {/* Things that need the person's own answer first: a request from someone who wants to help, and the hand-over at 18. Nothing renders when there is none. */}
      <AccountNotices acting={false} />

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
      <TodayPlan patientId={patientId} onNavigate={onNavigate} reloadToken={scoreReloadToken} />
      <HomeCheckCard patientId={patientId} reloadToken={scoreReloadToken} />

      {/* S55: this week's micro-lesson (spec 9.2); draws nothing when there is no in-date lesson. */}
      {organisationId ? <WeeklyLessonCard patientId={patientId} organisationId={organisationId} /> : null}
      {organisationId ? <RecordLessonCardNative patientId={patientId} renderFooter={(code, title) => <LessonFooter code={code} title={title} />} /> : null}

      {showGetStarted ? <GetStartedCard progress={progress} onNavigate={onNavigate} /> : null}

      <View style={{ gap: space.md }}>
        {/* On an empty account these tiles could only read dashes and zeros. The quick actions
            below them stay: those are how a patient puts the first number there. */}
        {firstRun ? null : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <AppText variant="title" heading>
                {tr("home.numbers.heading")}
              </AppText>
              {canCustomise ? (
                <Button
                  title={tr("home.pins.customise")}
                  variant="ghost"
                  fullWidth={false}
                  onPress={() => setManageOpen(true)}
                  accessibilityHint={tr("home.pins.customise_a11y")}
                />
              ) : null}
            </View>
            <HomePinTiles pins={pins} stats={stats} glucoseUnit={glucoseUnit} vitalValues={vitalValues} vitalsFailed={vitalsFailed} onNavigate={onNavigate} />
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

      {canCustomise ? (
        <ManageHomePinsSheet visible={manageOpen} onClose={() => setManageOpen(false)} pins={pins} lockedPins={lockedHomePins(pinContext)} onSave={savePins} />
      ) : null}
    </Screen>
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
