import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * Shown where a patient has reached something that costs a doctor's time.
 *
 * The Prevent/Essential/Complete packs were retired when the platform moved to
 * a free app plus pay-per-service: every feature with no marginal clinician
 * cost — the education library, lifestyle/weight/activity/nutrition, the AI
 * Coach, the quarterly report, the screening calendar, lab-request
 * coordination and refill tracking — is now free to every patient, and its
 * gate is gone rather than being re-pointed at a new product.
 *
 * What remains here is only the six things that ARE a doctor's time. Each is
 * reachable two ways: the 12-week doctor-supported chronic programme, or a
 * one-off credit bought for that single piece of work. So this prompt names a
 * price and a specific service, never a plan tier — there are no tiers left to
 * upgrade to. Keep it that way: copy naming "Essential Care" or "Complete
 * Care" is describing products that no longer exist.
 */
const FEATURE_COPY: Record<string, { title: string; body: string }> = {
  clinician_review: {
    title: "A doctor-set care plan is a paid service",
    body: "Your readings are checked against care protocols whatever you pay, and a dangerous one gets you clear guidance and a specific next step right away. What a doctor adds is a care plan set for your condition and reviewed on a schedule. That comes with the 12-week doctor-supported programme. Whenever a doctor does review something of yours, you'll see who reviewed it and when.",
  },
  doctor_checkin: {
    title: "Doctor check-ins are a paid service",
    body: "Scheduled check-ins on your condition, and messaging your care team directly, come with the 12-week doctor-supported programme.",
  },
  result_document_review: {
    title: "A doctor reading your result is a paid service",
    body: "You can upload any result and keep it on your record for free, and it stays yours. Having a doctor read it back to you in plain language, with next steps, is either part of the 12-week doctor-supported programme or a one-off Result Interpretation Session.",
  },
  async_doctor_visit: {
    title: "Asking a doctor is a paid service",
    body: "Send a written question and get a doctor's answer in the app, usually within 72 hours. Buy it as a one-off Ask a Doctor credit, or get it as part of the 12-week doctor-supported programme.",
  },
  multi_condition_review: {
    title: "A review across all your conditions is a paid service",
    body: "Nothing urgent is ever held back for this: a dangerous reading reaches a doctor exactly as it always would. What this adds is one doctor looking at every condition you're managing together and writing a single plan. Available as a Senior Case Review, or with the 12-week doctor-supported programme.",
  },
  vitals_red_flag_doctor_escalation: {
    title: "Having a doctor paged on a dangerous reading is a paid service",
    body: "A dangerous reading always gets you the full emergency safety net: immediate guidance to get to a hospital, your emergency contact notified, and a check-in afterwards. None of that depends on anyone paying. What the 12-week doctor-supported programme adds is a Tarragon doctor being alerted to it as well, and following up with you.",
  },
};

const DEFAULT_COPY = {
  title: "This is a paid service",
  body: "This one costs a doctor's time. You can buy it on its own, or get it as part of the 12-week doctor-supported programme.",
};

export function UpgradePrompt({ feature }: { feature: string }) {
  const copy = FEATURE_COPY[feature] ?? DEFAULT_COPY;
  const Icon = SEMANTIC_ICON.upgrade;

  return (
    <Card className="border-dashed">
      <CardContent className="flex items-start gap-3 py-4">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" aria-hidden />
        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium text-charcoal-ink">{copy.title}</p>
            <p className="text-sm text-charcoal-ink/70">{copy.body}</p>
          </div>
          <Button asChild size="sm">
            <Link href="/patient/subscription">See what this costs</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
