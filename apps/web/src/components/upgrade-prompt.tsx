import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

/** Copy per gated feature — pricing.ts's Free-tier footnote is the source
 * for exactly which 5 capabilities this ever fires for. Keep in sync with
 * the feature codes seeded onto subscription_plans/add_ons.features[] in
 * supabase/seed/seed.sql. */
const FEATURE_COPY: Record<string, { title: string; body: string }> = {
  clinician_review: {
    title: "Doctor review is part of a paid plan",
    body: "On Tarragon Free, no doctor reviews your readings. Upgrade to Essential Care or higher to get a named doctor following your numbers.",
  },
  doctor_checkin: {
    title: "Doctor check-ins are part of a paid plan",
    body: "Message your care team directly and get a scheduled doctor check-in on Essential Care or higher.",
  },
  lab_coordination: {
    title: "Lab test coordination is part of a paid plan",
    body: "Your doctor books and coordinates lab tests for you on Essential Care or higher.",
  },
  medication_refills: {
    title: "Medication refill coordination is part of a paid plan",
    body: "Upgrade to have your doctor coordinate refills through partner pharmacies for you.",
  },
  family_dashboard: {
    title: "The family dashboard is part of the Family Plan",
    body: "See every family member's care in one shared view, one combined bill, on the Family Plan.",
  },
  annual_review: {
    title: "The Annual Doctor Review is part of a paid plan",
    body: "Get a once-a-year whole-body workup — general bloods, heart and other screening — plus a video consult with your Tarragon doctor to talk through your whole year. Included on Complete Care, Family and ParentCare plans.",
  },
  lifestyle_coaching: {
    title: "Lifestyle coaching is part of a paid plan",
    body: "Get guided diet, exercise, weight, sleep and stress coaching with progress reviews from your care team — included in Complete, Family and ParentCare, or add it on to Essential.",
  },
  async_doctor_visit: {
    title: "Ask a doctor is part of a paid plan",
    body: "Send a written question and get a doctor's answer in the app within 24 hours. Included on Complete Care, Family and ParentCare plans.",
  },
  health_education: {
    title: "Personalised health education is part of a paid plan",
    body: "Get clinician-reviewed learning built around your own conditions, with short knowledge checks. Included on Complete Care and above, or add it to Essential Care.",
  },
  prevention_coordination: {
    title: "Screening booking is part of Tarragon Prevent",
    body: "Your screening calendar is free to see. To book screenings when they come due — with reminders and results tracking — join Tarragon Prevent, the stay-healthy plan, or the Prevention Screening add-on. The one-off Annual Health Check stays available to everyone.",
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
