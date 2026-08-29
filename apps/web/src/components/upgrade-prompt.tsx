import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

/** Copy per gated feature — pricing.ts's Free-tier footnote is the source
 * for exactly which capabilities this ever fires for. Keep in sync with
 * the feature codes seeded onto subscription_plans/add_ons.features[] in
 * supabase/seed/seed.sql.
 *
 * Superseded 2026-08-29: Prevent/Essential/Complete are retired, replaced
 * by Care Pass — ONE paid plan carrying every feature below, so this copy
 * no longer differentiates by tier ("on Essential Care or higher" /
 * "included in Complete Care"), it just names Care Pass. */
const FEATURE_COPY: Record<string, { title: string; body: string }> = {
  clinician_review: {
    title: "A doctor-set care plan is part of Care Pass",
    body: "Your readings are checked against care protocols on every plan, including Free, and a dangerous one gets you clear guidance and a specific next step right away. What's different on Care Pass is that a dangerous reading also reaches a doctor, and a doctor sets your care plan and checks in on your condition on a schedule, not just when something is flagged. Whenever a doctor does review something of yours, flagged or scheduled, you'll see who reviewed it and when.",
  },
  doctor_checkin: {
    title: "Doctor check-ins are part of Care Pass",
    body: "Message your care team directly and get a scheduled doctor check-in on Care Pass.",
  },
  lab_coordination: {
    title: "Lab test requests are part of Care Pass",
    body: "On Care Pass, message your care team for any lab test you need and they'll write you a request to take to a lab of your choice. You pay the lab directly; we take nothing on it.",
  },
  medication_refills: {
    title: "Refill-date tracking is part of Care Pass",
    body: "On Care Pass, we track your refill dates and remind you before one's due. You still buy from whichever pharmacy suits you.",
  },
  annual_review: {
    title: "The Annual Doctor Review is part of Care Pass",
    body: "Get a once-a-year whole-body workup (general bloods, heart and other screening) plus a video consult with your Tarragon doctor to talk through your whole year. Included on Care Pass.",
  },
  lifestyle_coaching: {
    title: "Lifestyle coaching is part of Care Pass",
    body: "Get guided diet, exercise, weight, sleep and stress coaching with progress reviews from your care team, included on Care Pass, or add it on separately if Care Pass isn't for you yet.",
  },
  async_doctor_visit: {
    title: "Ask a doctor is part of Care Pass",
    body: "Send a written question and get a doctor's answer in the app within 72 hours. Included on Care Pass.",
  },
  health_education: {
    title: "Personalised health education is part of Care Pass",
    body: "Get clinician-reviewed learning built around your own conditions, with short knowledge checks. Included on Care Pass.",
  },
  prevention_coordination: {
    title: "Screening booking is part of Care Pass",
    body: "Your screening calendar is free to see. To book screenings when they come due (with reminders and results tracking), get Care Pass, or the Prevention Screening add-on. The one-off Annual Health Check stays available to everyone.",
  },
  multi_condition_review: {
    title: "A scheduled review for this condition is part of Care Pass",
    body: "This condition is being managed alongside another one you're already on a plan for. Nothing urgent is ever held back for this: a dangerous reading still reaches a doctor the same as always. What Care Pass adds is a proactive, scheduled review for this condition too, not just your first one.",
  },
};

const DEFAULT_COPY = {
  title: "This is part of a paid plan",
  body: "Upgrade to unlock this for your account.",
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
            <Link href="/patient/subscription">See plans</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
