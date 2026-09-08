import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, View } from "react-native";
import { loadLifestyleState, type LifestyleEnrollment, type LpeConditionKey } from "@/lib/weight-management";
import { EnrollCta, EnrollmentCard } from "@/screens/sections/lifestyle-shared";
import type { SectionId } from "@/lib/sections";
import { WebViewScreen } from "@/screens/webview-screen";
import { colors, spacing } from "@/ui/theme";
import { CalloutCard, ErrorText, MutedText, ScreenTitle, SecondaryButton } from "@/ui/components";

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

const MORE_TRACKERS: { label: string; path: string }[] = [
  { label: "Meals", path: "/patient/nutrition" },
  { label: "Exercise programmes", path: "/patient/exercise" },
  { label: "Sleep", path: "/patient/sleep" },
  { label: "Smoking", path: "/patient/smoking" },
  { label: "Alcohol", path: "/patient/alcohol" },
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
 * no native home yet, so they open the equivalent web page in a WebView
 * modal — same pattern as Health Check's lab-booking card.
 */
export function LifestyleScreen({ patientId, onNavigate }: LifestyleScreenProps) {
  const [loading, setLoading] = useState(true);
  const [enrollments, setEnrollments] = useState<LifestyleEnrollment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackerPath, setTrackerPath] = useState<string | null>(null);

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
      <View>
        <ScreenTitle>Lifestyle coaching</ScreenTitle>
        <MutedText>Small, steady changes, logged here, supported by your care team.</MutedText>
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
        {MORE_TRACKERS.map((tracker) => (
          <CalloutCard
            key={tracker.path}
            icon="leaf-outline"
            title={tracker.label}
            subtitle="Log this in the full patient app."
            ctaLabel="Open"
            onPress={() => setTrackerPath(tracker.path)}
          />
        ))}
      </View>

      <Modal visible={!!trackerPath} animationType="slide" onRequestClose={() => setTrackerPath(null)}>
        <View style={{ flex: 1 }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setTrackerPath(null)} />
          </View>
          {trackerPath && <WebViewScreen path={trackerPath} />}
        </View>
      </Modal>
    </ScrollView>
  );
}
