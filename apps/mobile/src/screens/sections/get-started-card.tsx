import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { SectionId } from "@/lib/sections";
import { type UiLanguage } from "@tarragon/shared";
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
  language = "en",
}: {
  progress: GetStartedProgress;
  onNavigate: (id: SectionId) => void;
  language?: UiLanguage;
}) {
  // Written per-language rather than looked up string-by-string, matching
  // web's get-started-card.tsx. Setup guidance only -- no clinical content,
  // per the boundary in packages/shared/src/ui-language.ts.
  const pidgin = language === "pcm";
  const copy = pidgin
    ? {
        heading: "Three things wey you go set up",
        of: "out of",
        intro:
          "This app dey keep your health record for one place, e dey tell you which check don due, and e dey put your readings for front of a care team wey fit do something about am. These three steps na wetin go turn am on.",
        footer:
          "All of this na free. Na only doctor time you dey ever pay for, and na only when you ask for am.",
        steps: [
          {
            title: "Fill your health profile",
            detail:
              "Na like two minutes. E go build your own screening and vaccination calendar: the checks wey dey keep well person well.",
            cta: "Start am",
          },
          {
            title: "Enter the first reading",
            detail:
              "Blood pressure, blood sugar or weight, from any machine, you fit type am by hand. Na wetin the care team dey look.",
            cta: "Enter a reading",
          },
          {
            title: "Add your medicine",
            detail:
              "Whatever you dey take now. Once dem dey the list, you go dey get reminder for dose and refill.",
            cta: "Add medicine",
          },
        ],
      }
    : {
        heading: "Three things to set up",
        of: "of",
        intro:
          "This app keeps your health record in one place, tells you which checks are due, and puts your readings in front of a care team who can act on them. These three steps switch that on.",
        footer:
          "All of this is free. You are only ever charged for a doctor's time, and only when you ask for it.",
        steps: [
          {
            title: "Fill in the health profile",
            detail:
              "About two minutes. It builds your personal screening and vaccination calendar: the checks that keep well people well.",
            cta: "Start the profile",
          },
          {
            title: "Log the first reading",
            detail:
              "Blood pressure, blood sugar or weight, from any meter, typed in by hand. This is what the care team looks at.",
            cta: "Log a reading",
          },
          {
            title: "Add your medicines",
            detail:
              "Whatever you take now. Once they are on the list, you get dose reminders and refill nudges.",
            cta: "Add a medicine",
          },
        ],
      };
  const targets: SectionId[] = ["prevention", "vitals", "medications"];
  const dones = [progress.hasRiskAssessment, progress.hasAnyVitals, progress.hasMedications];
  const steps: Step[] = copy.steps.map((step, i) => ({
    ...step,
    target: targets[i]!,
    done: dones[i]!,
  }));
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
          {copy.heading}
        </Text>
        <Text style={{ fontSize: typeScale.caption, fontWeight: "600", color: colors.muted }}>
          {doneCount} {copy.of} {steps.length} done
        </Text>
      </View>
      <Text style={{ fontSize: typeScale.body, lineHeight: 20, color: colors.muted }}>
        {copy.intro}
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
        {copy.footer}
      </Text>
    </View>
  );
}
