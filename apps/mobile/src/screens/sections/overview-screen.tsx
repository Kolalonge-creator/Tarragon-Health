import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, RefreshControl, ScrollView, Text, View } from "react-native";
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
import { colors, spacing } from "@/ui/theme";
import { Card, MutedText, PrimaryButton } from "@/ui/components";
import type { SectionId } from "@/lib/sections";
import { relativeTime } from "@/lib/notifications";

interface OverviewScreenProps {
  patientId: string;
  patientName: string;
  onNavigate: (section: SectionId) => void;
}

export function OverviewScreen({ patientId, patientName, onNavigate }: OverviewScreenProps) {
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [careTeam, setCareTeam] = useState<CareTeamInfo | null>(null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [activity, setActivity] = useState<RecentActivityItem[]>([]);
  const [videoVisit, setVideoVisit] = useState<UpcomingVideoVisit | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [s, ct, sc, act, vv] = await Promise.all([
      getSummaryStats(patientId),
      getCareTeam(patientId),
      getCareSchedule(patientId),
      getRecentActivity(patientId),
      getUpcomingVideoVisit(patientId),
    ]);
    setStats(s);
    setCareTeam(ct);
    setSchedule(sc);
    setActivity(act);
    setVideoVisit(vv);
  }, [patientId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const firstName = patientName.split(/\s+/)[0] ?? patientName;

  if (loading || !stats) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 14 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
    >
      <View>
        <Text style={{ fontSize: 21, fontWeight: "700", color: colors.ink }}>{firstName}&apos;s overview</Text>
        <MutedText>Today at a glance: your numbers, your care team, and recent activity.</MutedText>
      </View>

      <Card style={{ gap: 4, borderColor: "rgba(14,124,82,0.3)", backgroundColor: "rgba(14,124,82,0.04)" }}>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.brand} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.brandPressed, textTransform: "uppercase" }}>
              Next best step
            </Text>
            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink, marginTop: 2 }}>
              Log a reading today
            </Text>
            <Text style={{ fontSize: 13, color: "rgba(23,23,23,0.7)", marginTop: 2 }}>
              A fresh reading keeps your care team&apos;s picture of you current — it takes under a minute.
            </Text>
            <Text
              onPress={() => onNavigate("vitals")}
              style={{ fontSize: 13, fontWeight: "600", color: colors.brand, marginTop: 4 }}
            >
              Log a reading →
            </Text>
          </View>
        </View>
      </Card>

      {videoVisit ? (
        <Card style={{ gap: 8, borderColor: "rgba(18,50,75,0.25)", backgroundColor: "rgba(18,50,75,0.04)" }}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <Ionicons name="videocam-outline" size={20} color={colors.navy} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: colors.navy, textTransform: "uppercase" }}>
                Video visit
              </Text>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink, marginTop: 2 }}>
                {new Date(videoVisit.scheduledAt).toLocaleString([], {
                  weekday: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </View>
          </View>
          {videoVisit.joinUrl ? (
            // A standard Zoom join link (Universal/App Link) — Linking.openURL
            // hands off to the native Zoom app if installed, or the Zoom web
            // client otherwise. Same handoff the Care & support WebView
            // already does for this link; surfaced here too since Overview is
            // the screen a patient opens most (MOBILE_APP_SPEC.md §8).
            <PrimaryButton title="Join call" onPress={() => void Linking.openURL(videoVisit.joinUrl!)} />
          ) : (
            <MutedText>Your join link will appear here once your doctor confirms the time.</MutedText>
          )}
        </Card>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <StatTile icon="heart-outline" label="Latest BP" value={stats.latestBp ? `${stats.latestBp.systolic}/${stats.latestBp.diastolic}` : "—"} unit="mmHg" />
        <StatTile icon="water-outline" label="Latest glucose" value={stats.latestGlucoseMmolL !== null ? String(stats.latestGlucoseMmolL) : "—"} unit="mmol/L" />
        <StatTile icon="medkit-outline" label="Active meds" value={String(stats.activeMedicationCount)} />
        <StatTile icon="checkmark-circle-outline" label="Doses today" value={`${stats.dosesTaken}/${stats.dosesTotal}`} />
      </View>

      {schedule.length > 0 ? (
        <Card style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>What&apos;s coming up</Text>
          {schedule.map((item, i) => (
            <View key={i} style={{ paddingVertical: 6, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
              <Text style={{ fontSize: 10.5, fontWeight: "600", color: colors.faint, textTransform: "uppercase" }}>
                {item.type}
              </Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ fontSize: 13, color: colors.ink, flex: 1 }}>{item.title}</Text>
                <Text style={{ fontSize: 12, color: colors.faint }}>{daysLabel(item.dueDate)}</Text>
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {careTeam ? (
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>
              {careTeam.clinicianName.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Dr. {careTeam.clinicianName}</Text>
            <MutedText>Your clinician{careTeam.credential ? ` · ${careTeam.credential}` : ""}</MutedText>
          </View>
          <Text onPress={() => onNavigate("messages")} style={{ fontSize: 12.5, fontWeight: "600", color: colors.brand }}>
            Message
          </Text>
        </Card>
      ) : null}

      <Card style={{ gap: 6 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink, marginBottom: 2 }}>Recent activity</Text>
        {activity.length === 0 ? (
          <MutedText>No activity yet. Readings, medications and results will appear here.</MutedText>
        ) : (
          activity.map((item) => (
            <View key={item.id} style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brand, marginTop: 6 }} />
              <Text style={{ fontSize: 12.5, color: "rgba(23,23,23,0.75)", flex: 1 }}>
                {item.title} <Text style={{ color: colors.faint }}>· {relativeTime(item.occurredAt)}</Text>
              </Text>
            </View>
          ))
        )}
      </Card>
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
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#E7EEE7", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={icon} size={16} color={colors.brandPressed} />
        </View>
        <View>
          <Text style={{ fontSize: 11, color: colors.muted }}>{label}</Text>
          <Text style={{ fontSize: 19, fontWeight: "700", color: colors.ink }}>
            {value} {unit ? <Text style={{ fontSize: 11, fontWeight: "400", color: colors.faint }}>{unit}</Text> : null}
          </Text>
        </View>
      </Card>
    </View>
  );
}
