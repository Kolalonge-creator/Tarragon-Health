import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Modal, ScrollView, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  loadLifestyleState,
  loadPastLifestyleGoals,
  type LifestyleEnrollment,
  type LpeConditionKey,
  type PastLifestyleGoal,
} from "@/lib/weight-management";
import { EnrollCta, EnrollmentCard, when } from "@/screens/sections/lifestyle-shared";
import type { SectionId } from "@/lib/sections";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, spacing } from "@/ui/theme";
import { Badge, CalloutCard, Card, ErrorText, MutedText, ScreenTitle, SecondaryButton } from "@/ui/components";

const STARTABLE: { key: LpeConditionKey; title: string; description: string }[] = [
  {
    key: "obesity",
    title: "Weight & metabolic health",
    description: "A structured programme with goals you set, weekly check-ins, and doctor review, at your pace.",
  },
  {
    key: "htn",
    title: "Blood pressure",
    description: "Lifestyle support alongside your blood pressure care: goals, check-ins, and doctor review.",
  },
  {
    key: "diabetes",
    title: "Diabetes",
    description: "Lifestyle support alongside your diabetes care: goals, check-ins, and doctor review.",
  },
];

/** Now native screens, not browser hand-offs. See tracker-screens.tsx. */
const NATIVE_TRACKERS: {
  label: string;
  section: SectionId;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { label: "Sleep", section: "sleep", icon: "moon-outline" },
  { label: "Movement", section: "activity", icon: "walk-outline" },
  { label: "Smoking", section: "smoking", icon: "flame-outline" },
  { label: "Alcohol", section: "alcohol", icon: "wine-outline" },
];

/** Still web, for now: meals and exercise programmes have no native screen
 * yet. Listed separately rather than mixed in with the four above, so the
 * "opens in your browser" caption sits only on the ones it is true of. */
const WEB_TRACKERS: { label: string; path: string }[] = [
  { label: "Meals", path: "/patient/nutrition" },
  { label: "Exercise programmes", path: "/patient/exercise" },
];

interface LifestyleScreenProps {
  patientId: string;
  onNavigate: (section: SectionId) => void;
}

/**
 * "Lifestyle coaching" — every enrolled condition's programme (obesity, blood
 * pressure, diabetes) in one place, mirroring
 * apps/web/.../patient/lifestyle/lifestyle-client.tsx's orchestration layer.
 * Enrolment/check-in/goal UI is shared with weight-management-screen.tsx via
 * lifestyle-shared.tsx, so obesity behaves identically whichever screen a
 * patient reaches it from. Weight management and Wellness rewards already
 * have their own native homes (link-outs, not rebuilds); the five
 * standalone trackers below (meals, exercise, sleep, smoking, alcohol) have
 * no native home yet, so tapping one hands off to the equivalent web page in
 * the system browser (expo-web-browser) — never an embedded WebView, so the
 * app never re-wraps a section it just went native on.
 */
export function LifestyleScreen({ patientId, onNavigate }: LifestyleScreenProps) {
  const [loading, setLoading] = useState(true);
  const [enrollments, setEnrollments] = useState<LifestyleEnrollment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pastGoalsOpen, setPastGoalsOpen] = useState(false);

  const refresh = useCallback(async () => {
    const result = await loadLifestyleState(patientId);
    if (result.ok) {
      setEnrollments(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [patientId]);

  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refresh]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (!enrollments) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.screen }}>
        <ErrorText>{error ?? "Could not load your lifestyle programmes just now."}</ErrorText>
      </View>
    );
  }

  const byCondition = new Map(enrollments.filter((e) => e.conditionKey).map((e) => [e.conditionKey as LpeConditionKey, e]));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <ScreenTitle>Lifestyle coaching</ScreenTitle>
          <MutedText>Small, steady changes, logged here, supported by your care team.</MutedText>
        </View>
        <Text onPress={() => setPastGoalsOpen(true)} style={{ fontSize: 13, fontWeight: "600", color: colors.brand, paddingTop: 4 }}>
          Past goals
        </Text>
      </View>

      {STARTABLE.map(({ key, title, description }) => {
        const enrollment = byCondition.get(key);
        return enrollment ? (
          <EnrollmentCard key={key} enrollment={enrollment} onChanged={refresh} />
        ) : (
          <EnrollCta key={key} conditionKey={key} title={title} description={description} onEnrolled={refresh} />
        );
      })}

      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <SecondaryButton title="Weight management" onPress={() => onNavigate("weightManagement")} />
        </View>
        <View style={{ flex: 1 }}>
          <SecondaryButton title="Wellness rewards" onPress={() => onNavigate("wellness")} />
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>More ways to track</Text>
        {NATIVE_TRACKERS.map((tracker) => (
          <CalloutCard
            key={tracker.section}
            icon={tracker.icon}
            title={tracker.label}
            subtitle="Log it here, in the app."
            ctaLabel="Open"
            onPress={() => onNavigate(tracker.section)}
          />
        ))}
        {WEB_TRACKERS.map((tracker) => (
          <CalloutCard
            key={tracker.path}
            icon="leaf-outline"
            title={tracker.label}
            subtitle="Opens in your browser, signed in as you."
            ctaLabel="Open"
            onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}${tracker.path}`)}
          />
        ))}
      </View>

      <Modal visible={pastGoalsOpen} animationType="slide" onRequestClose={() => setPastGoalsOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setPastGoalsOpen(false)} />
          </View>
          <PastGoalsList patientId={patientId} />
        </View>
      </Modal>
    </ScrollView>
  );
}

/** "View past goals" — mirrors the Past goals tab in
 * apps/web/.../lifestyle/goals-dialog.tsx's PastGoalsList: every goal a
 * patient has marked achieved or let go of, most recent first. Loaded lazily
 * inside the modal rather than up front on the main screen, since it's a
 * look-back list nobody needs on first paint. */
function PastGoalsList({ patientId }: { patientId: string }) {
  const [loading, setLoading] = useState(true);
  const [goals, setGoals] = useState<PastLifestyleGoal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPastLifestyleGoals(patientId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setGoals(result.data);
        else setError(result.error);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingTop: 0, gap: 10 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}>Past goals</Text>
      {error ? (
        <ErrorText>{error}</ErrorText>
      ) : !goals || goals.length === 0 ? (
        <MutedText>No past goals yet, goals you complete or let go of will show up here.</MutedText>
      ) : (
        goals.map((g) => (
          <Card key={g.id} style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>{g.title}</Text>
              <MutedText>
                {g.conditionLabel} · {when(g.updatedAt)}
              </MutedText>
            </View>
            <Badge tone={g.status === "achieved" ? "brand" : "neutral"}>{g.status}</Badge>
          </Card>
        ))
      )}
    </ScrollView>
  );
}
