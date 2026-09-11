import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { SectionId } from "@/lib/sections";
import { colors, radius, spacing, typeScale } from "@/ui/theme";

/**
 * The native twin of web's GetStartedCard -- see that file for the full
 * reasoning. Same three steps, same order, same "completed steps stay visible
 * with a tick" behaviour, so a patient who set up on one surface recognises
 * the other.
 *
 * Kept as its own component rather than inlined into OverviewScreen (already
 * ~450 lines) and deliberately not shared with web: the copy is shared, the
 * rendering is not, and a cross-platform card abstraction for one card would
 * cost more than the duplication.
 */
export interface GetStartedProgress {
  hasRiskAssessment: boolean;
  hasAnyVitals: boolean;
  hasMedications: boolean;
}

export function shouldShowGetStarted(p: GetStartedProgress): boolean {
  return !(p.hasRiskAssessment && p.hasAnyVitals && p.hasMedications);
}

/** A genuinely empty account -- a narrower question than the one above,
 * used to suppress the stat tiles that can only render em-dashes. */
export function isFirstRun(p: GetStartedProgress): boolean {
  return !p.hasRiskAssessment && !p.hasAnyVitals && !p.hasMedications;
}

interface Step {
  title: string;
  detail: string;
  cta: string;
  target: SectionId;
  done: boolean;
}

export function GetStartedCard({
  progress,
  onNavigate,
}: {
  progress: GetStartedProgress;
  onNavigate: (id: SectionId) => void;
}) {
  const steps: Step[] = [
    {
      title: "Fill in the health profile",
      detail:
        "About two minutes. It builds your personal screening and vaccination calendar: the checks that keep well people well.",
      cta: "Start the profile",
      target: "prevention",
      done: progress.hasRiskAssessment,
    },
    {
      title: "Log the first reading",
      detail:
        "Blood pressure, blood sugar or weight, from any meter, typed in by hand. This is what the care team looks at.",
      cta: "Log a reading",
      target: "vitals",
      done: progress.hasAnyVitals,
    },
    {
      title: "Add your medicines",
      detail:
        "Whatever you take now. Once they are on the list, you get dose reminders and refill nudges.",
      cta: "Add a medicine",
      target: "medications",
      done: progress.hasMedications,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <View
      accessibilityRole="summary"
      style={{
        backgroundColor: colors.brandTint,
        borderRadius: radius.card,
        padding: spacing.screen,
        gap: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ fontSize: typeScale.title, fontWeight: "700", color: colors.ink, flexShrink: 1 }}>
          Three things to set up
        </Text>
        <Text style={{ fontSize: typeScale.caption, fontWeight: "600", color: colors.muted }}>
          {doneCount} of {steps.length} done
        </Text>
      </View>
      <Text style={{ fontSize: typeScale.body, lineHeight: 20, color: colors.muted }}>
        This app keeps your health record in one place, tells you which checks are due, and puts
        your readings in front of a care team who can act on them. These three steps switch that
        on.
      </Text>

      {steps.map((step, index) => (
        <View
          key={step.target}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 12,
            backgroundColor: colors.card,
            borderRadius: radius.control,
            padding: 14,
            opacity: step.done ? 0.65 : 1,
          }}
        >
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: step.done ? colors.brand : colors.groupBg,
            }}
          >
            {step.done ? (
              <Ionicons name="checkmark" size={15} color="#FFFFFF" />
            ) : (
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>{index + 1}</Text>
            )}
          </View>
          <View style={{ flex: 1, gap: step.done ? 0 : 8 }}>
            <Text
              style={{
                fontSize: typeScale.body,
                fontWeight: "700",
                color: step.done ? colors.muted : colors.ink,
                textDecorationLine: step.done ? "line-through" : "none",
              }}
            >
              {step.title}
            </Text>
            {step.done ? null : (
              <>
                <Text style={{ fontSize: typeScale.caption, lineHeight: 18, color: colors.muted }}>
                  {step.detail}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={step.cta}
                  onPress={() => onNavigate(step.target)}
                  style={{
                    alignSelf: "flex-start",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    backgroundColor: colors.brand,
                    borderRadius: radius.control,
                    // Keeps the whole control above the 44pt tap-target floor.
                    paddingVertical: 11,
                    paddingHorizontal: 16,
                  }}
                >
                  <Text style={{ fontSize: typeScale.body, fontWeight: "700", color: "#FFFFFF" }}>
                    {step.cta}
                  </Text>
                  <Ionicons name="chevron-forward" size={15} color="#FFFFFF" />
                </Pressable>
              </>
            )}
          </View>
        </View>
      ))}

      <Text style={{ fontSize: typeScale.caption, lineHeight: 17, color: colors.faint }}>
        All of this is free. You are only ever charged for a doctor&apos;s time, and only when you
        ask for it.
      </Text>
    </View>
  );
}
