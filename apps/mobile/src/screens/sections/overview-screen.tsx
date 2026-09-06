import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  getCareSchedule,
  getCareTeam,
  getRecentActivity,
  getSummaryStats,
  getUpcomingVideoVisit,
  daysLabel,
  type CareTeamInfo,
  type RecentActivityItem,
  type ScheduleItem,
  type SummaryStats,
  type UpcomingVideoVisit,
} from "@/lib/overview";
import { todayIsoDate } from "@/lib/medications";
import { colors, radius, spacing, typeScale } from "@/ui/theme";
import {
  Card,
  CalloutCard,
  GroupedList,
  GroupedListRow,
  MutedText,
  PrimaryButton,
  QuickActionButton,
  QuickActionGrid,
  SectionLabel,
} from "@/ui/components";
import type { SectionId } from "@/lib/sections";
import { relativeTime } from "@/lib/notifications";

interface OverviewScreenProps {
  patientId: string;
  patientName: string;
  onNavigate: (section: SectionId) => void;
}

interface NextBestStep {
  title: string;
  body: string;
  ctaLabel: string;
  target: SectionId;
}

/** Derived from the stats already loaded, so the card stays honest rather
 * than always saying "log a reading" to a patient who already has: doses
 * still open today come first, then a missing reading, then a calm default. */
function nextBestStep(stats: SummaryStats): NextBestStep {
  const dosesRemaining = stats.dosesTotal - stats.dosesTaken;
  if (dosesRemaining > 0) {
    return {
      title: dosesRemaining === 1 ? "One dose still to log today" : `${dosesRemaining} doses still to log today`,
      body: "Marking each dose as you take it helps your care team see how your treatment is really going.",
      ctaLabel: "Open medications",
      target: "medications",
    };
  }
  const lastReadingDay = stats.lastVitalTakenAt
    ? new Date(stats.lastVitalTakenAt).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" })
    : null;
  if (lastReadingDay !== todayIsoDate()) {
    return {
      title: "Log a reading today",
      body: "A fresh reading keeps your care team's picture of you current. It takes under a minute.",
      ctaLabel: "Log a reading",
      target: "vitals",
    };
  }
  return {
    title: "You're on track today",
    body: "Your doses are logged and a fresh reading is on file. Add another reading any time you like.",
    ctaLabel: "Log another reading",
    target: "vitals",
  };
}

interface HeroMetric {
  label: string;
  value: string;
  unit?: string;
}

/** The one display-scale number at the top of the hero band — picked from
 * the stats the screen already loads (no extra fetch), most clinically
 * relevant first: a real BP reading beats glucose beats today's dose count.
 * Null means no reading of any kind exists yet; the hero shows a warm
 * prompt instead — never a fake or zeroed value. */
function heroMetric(stats: SummaryStats): HeroMetric | null {
  if (stats.latestBp) {
    return {
      label: "Latest blood pressure",
      value: `${stats.latestBp.systolic}/${stats.latestBp.diastolic}`,
      unit: "mmHg",
    };
  }
  if (stats.latestGlucoseMmolL !== null) {
    return { label: "Latest glucose", value: String(stats.latestGlucoseMmolL), unit: "mmol/L" };
  }
  if (stats.dosesTotal > 0) {
    return { label: "Doses taken today", value: `${stats.dosesTaken}/${stats.dosesTotal}` };
  }
  return null;
}

/** "Tue, 14:00" reads as this coming Tuesday, which is wrong for a visit
 * weeks out — include the date whenever it isn't within the next 6 days. */
function formatVisitTime(iso: string): string {
  const when = new Date(iso);
  const withinSixDays = when.getTime() - Date.now() < 6 * 86_400_000;
  return when.toLocaleString(
    [],
    withinSixDays
      ? { weekday: "short", hour: "2-digit", minute: "2-digit" }
      : { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
  );
}

export function OverviewScreen({ patientId, patientName, onNavigate }: OverviewScreenProps) {
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [careTeam, setCareTeam] = useState<CareTeamInfo | null>(null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [activity, setActivity] = useState<RecentActivityItem[]>([]);
  const [videoVisit, setVideoVisit] = useState<UpcomingVideoVisit | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // A failed stats fetch must never render as "Active meds 0" — the screen
  // shows an explicit error state instead (statsError), and a failure in any
  // of the secondary cards shows an inline retry notice (partialError)
  // rather than silently hiding the card as if it were empty.
  const [statsError, setStatsError] = useState(false);
  const [partialError, setPartialError] = useState(false);

  const load = useCallback(async () => {
    const [s, ct, sc, act, vv] = await Promise.all([
      getSummaryStats(patientId),
      getCareTeam(patientId),
      getCareSchedule(patientId),
      getRecentActivity(patientId),
      getUpcomingVideoVisit(patientId),
    ]);
    setStats(s.ok ? s.data : null);
    setStatsError(!s.ok);
    if (ct.ok) setCareTeam(ct.data);
    if (sc.ok) setSchedule(sc.data);
    if (act.ok) setActivity(act.data);
    if (vv.ok) setVideoVisit(vv.data);
    setPartialError(!ct.ok || !sc.ok || !act.ok || !vv.ok);
  }, [patientId]);

  useEffect(() => {
    load()
      .catch(() => setStatsError(true))
      .finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
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

  const firstName = patientName.split(/\s+/)[0] ?? patientName;

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (statsError || !stats) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: spacing.screen,
          gap: 12,
          backgroundColor: colors.background,
        }}
      >
        <Ionicons name="cloud-offline-outline" size={28} color={colors.faint} />
        <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }}>
          We couldn&apos;t load this right now
        </Text>
        <MutedText>Your record is safe. Check your connection and try again.</MutedText>
        <PrimaryButton title="Tap to retry" onPress={retry} />
      </View>
    );
  }

  const step = nextBestStep(stats);
  const hero = heroMetric(stats);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 14 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
    >
      <View>
        <Text style={{ fontSize: typeScale.title, fontWeight: "700", color: colors.ink }}>{firstName}&apos;s overview</Text>
        <MutedText>Today at a glance: your numbers, your care team, and recent activity.</MutedText>
      </View>

      {partialError ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Some of this page could not load. Tap to retry."
          onPress={onRefresh}
        >
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Ionicons name="refresh-outline" size={18} color={colors.muted} />
            <MutedText>Some of this page couldn&apos;t load right now. Tap to retry.</MutedText>
          </Card>
        </Pressable>
      ) : null}

      {/* Hero band: the one place the screen answers "how am I doing, and
          what should I do next" at full volume. Deep brand green with white
          type only — clinical status colours never sit on this surface (they
          stay on white/card surfaces), and no fake value ever renders: with
          no reading of any kind the number gives way to a warm prompt. */}
      <View
        style={{
          backgroundColor: colors.brand,
          borderRadius: radius.card,
          padding: spacing.screen,
          gap: spacing.card,
        }}
      >
        {hero ? (
          <View>
            <Text
              style={{
                fontSize: typeScale.caption,
                fontWeight: "700",
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.75)",
              }}
            >
              {hero.label}
            </Text>
            <Text style={{ fontSize: typeScale.hero, fontWeight: "700", color: "#FFFFFF", marginTop: 2 }}>
              {hero.value}
              {hero.unit ? (
                <Text style={{ fontSize: typeScale.body, fontWeight: "500", color: "rgba(255,255,255,0.75)" }}>
                  {" "}
                  {hero.unit}
                </Text>
              ) : null}
            </Text>
          </View>
        ) : (
          <Text style={{ fontSize: typeScale.body, lineHeight: 20, color: "rgba(255,255,255,0.92)" }}>
            Your numbers will appear here once you log your first reading.
          </Text>
        )}

        <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.22)" }} />

        <View style={{ gap: 4 }}>
          <Text
            style={{
              fontSize: typeScale.caption,
              fontWeight: "700",
              letterSpacing: 0.5,
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.75)",
            }}
          >
            Next best step
          </Text>
          <Text style={{ fontSize: typeScale.title, fontWeight: "700", color: "#FFFFFF" }}>{step.title}</Text>
          <Text style={{ fontSize: typeScale.body, lineHeight: 20, color: "rgba(255,255,255,0.85)" }}>
            {step.body}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={step.ctaLabel}
            onPress={() => onNavigate(step.target)}
            hitSlop={8}
            style={({ pressed }) => ({
              alignSelf: "flex-start",
              backgroundColor: pressed ? "rgba(255,255,255,0.85)" : colors.card,
              borderRadius: 999,
              paddingVertical: 8,
              paddingHorizontal: 16,
              marginTop: 6,
            })}
          >
            <Text style={{ fontSize: typeScale.body, fontWeight: "700", color: colors.brandPressed }}>
              {step.ctaLabel}
            </Text>
          </Pressable>
        </View>
      </View>

      {videoVisit ? (
        <Card style={{ gap: 8, borderColor: "rgba(18,50,75,0.25)", backgroundColor: "rgba(18,50,75,0.04)" }}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <Ionicons name="videocam-outline" size={20} color={colors.navy} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: typeScale.caption, fontWeight: "700", color: colors.navy, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Video visit
              </Text>
              <Text style={{ fontSize: typeScale.body, fontWeight: "600", color: colors.ink, marginTop: 2 }}>
                {formatVisitTime(videoVisit.scheduledAt)}
              </Text>
            </View>
          </View>
          {videoVisit.joinUrl ? (
            // A standard Zoom join link (Universal/App Link) — Linking.openURL
            // hands off to the native Zoom app if installed, or the Zoom web
            // client otherwise. Same handoff the Care & support WebView
            // already does for this link; surfaced here too since Overview is
            // the screen a patient opens most (MOBILE_APP_SPEC.md §8).
            <PrimaryButton
              title="Join call"
              onPress={() => void Linking.openURL(videoVisit.joinUrl!).catch(() => {})}
            />
          ) : (
            <MutedText>Your join link will appear here once your doctor confirms the time.</MutedText>
          )}
        </Card>
      ) : null}

      <View style={{ gap: 10 }}>
        <SectionLabel>Your numbers</SectionLabel>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <StatTile icon="heart-outline" label="Latest BP" value={stats.latestBp ? `${stats.latestBp.systolic}/${stats.latestBp.diastolic}` : "—"} unit="mmHg" />
          <StatTile icon="water-outline" label="Latest glucose" value={stats.latestGlucoseMmolL !== null ? String(stats.latestGlucoseMmolL) : "—"} unit="mmol/L" />
          <StatTile icon="medkit-outline" label="Active meds" value={String(stats.activeMedicationCount)} />
          <StatTile icon="checkmark-circle-outline" label="Doses today" value={`${stats.dosesTaken}/${stats.dosesTotal}`} />
        </View>
        <QuickActionGrid>
          <QuickActionButton icon="pulse-outline" label="Log a reading" onPress={() => onNavigate("vitals")} />
          <QuickActionButton icon="medkit-outline" label="Medications" onPress={() => onNavigate("medications")} />
          <QuickActionButton icon="chatbox-ellipses-outline" label="Messages" onPress={() => onNavigate("messages")} />
          <QuickActionButton icon="flask-outline" label="Labs" onPress={() => onNavigate("labs")} />
        </QuickActionGrid>
      </View>

      {schedule.length > 0 ? (
        <View style={{ gap: 10 }}>
          <SectionLabel>What&apos;s coming up</SectionLabel>
          <GroupedList>
            {schedule.map((item) => (
              <GroupedListRow
                key={`${item.type}:${item.title}:${item.dueDate}`}
                title={item.title}
                subtitle={`${item.type.charAt(0).toUpperCase()}${item.type.slice(1)}`}
                trailing={<Text style={{ fontSize: 12, color: colors.faint }}>{daysLabel(item.dueDate)}</Text>}
              />
            ))}
          </GroupedList>
        </View>
      ) : null}

      {careTeam ? (
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="people-outline" size={18} color="#fff" />
          </View>
          {/* care_team_assignment.clinician_id is internal routing/rota only —
              mirrors your-care-team.tsx (web): deliberately never rendered as
              a named "your doctor" ahead of a review actually happening. A
              doctor is named only once they've reviewed something specific
              (ReviewedByDoctor's job, not this card's). */}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Your care team</Text>
            <MutedText>
              Your readings are followed by a team of doctors, and whoever reviews one is named
              on that note rather than assigned to you ahead of time.
            </MutedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Message your care team"
            onPress={() => onNavigate("messages")}
            hitSlop={10}
            style={{ paddingVertical: 8, paddingHorizontal: 4 }}
          >
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.brand }}>Message</Text>
          </Pressable>
        </Card>
      ) : null}

      <View style={{ gap: 10 }}>
        <SectionLabel>Recent activity</SectionLabel>
        {activity.length === 0 ? (
          <Card>
            <MutedText>No activity yet. Readings, medications and results will appear here.</MutedText>
          </Card>
        ) : (
          <GroupedList>
            {activity.map((item) => (
              <GroupedListRow
                key={item.id}
                title={item.title}
                subtitle={relativeTime(item.occurredAt)}
                trailing="none"
              />
            ))}
          </GroupedList>
        )}
      </View>

      <View style={{ gap: 10 }}>
        <SectionLabel>Help &amp; contact</SectionLabel>
        <CalloutCard
          icon="chatbox-ellipses-outline"
          title="Message your care team"
          subtitle="Ask a question and hear back from the doctors reviewing your case."
          ctaLabel="Open chat"
          onPress={() => onNavigate("messages")}
        />
        <CalloutCard
          icon="help-buoy-outline"
          title="Care & support"
          subtitle="Useful links, common questions, and how to reach us."
          ctaLabel="Open"
          onPress={() => onNavigate("care")}
        />
      </View>
    </ScrollView>
  );
}

function StatTile({
  icon,
  label,
  value,
  unit,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <View style={{ flexBasis: "47%", flexGrow: 1 }}>
      <Card style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTint, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={icon} size={16} color={colors.brandPressed} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: typeScale.caption, color: colors.muted }}>{label}</Text>
          <Text style={{ fontSize: typeScale.stat, fontWeight: "600", color: colors.ink }}>
            {value} {unit ? <Text style={{ fontSize: typeScale.caption, fontWeight: "400", color: colors.faint }}>{unit}</Text> : null}
          </Text>
        </View>
      </Card>
    </View>
  );
}
