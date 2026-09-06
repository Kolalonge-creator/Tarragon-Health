import type { FertilityRecommendedAction } from "@/lib/rules/fertility-assessment";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

const RESULT_COPY: Record<FertilityRecommendedAction, { title: string; description: string }> = {
  education_only: {
    title: "You're just getting started",
    description:
      "It's still early days, so there's nothing to worry about yet. Keep an eye on your cycle, and come back to this check-in any time your situation changes.",
  },
  preconception_advice: {
    title: "You're in a normal range",
    description:
      "Trying for 6-11 months is still well within the normal window. Your care team has some preconception advice (timing, nutrition, and habits that help) to make the most of this stretch.",
  },
  baseline_labs: {
    title: "Worth a closer look",
    description:
      "You've been trying for a little while, so it's worth checking the basics with some baseline lab tests. Your care team will help you get these booked.",
  },
  specialist_referral: {
    title: "Time to bring in a specialist",
    description:
      "Based on what you've told us, it's worth seeing a specialist. We've started that referral and your care team will be in touch.",
  },
};

/**
 * Friendly, plain-language result for a fertility self-assessment (spec
 * §47.9). Never phrased as a diagnosis — always "worth a closer look" or
 * "your care team", never alarming language.
 */
export function FertilityAssessmentResult({
  recommendedAction,
}: {
  recommendedAction: FertilityRecommendedAction;
}) {
  const copy = RESULT_COPY[recommendedAction];
  return (
    <Card variant="soft">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.family className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          {copy.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{copy.description}</p>
      </CardContent>
    </Card>
  );
}
