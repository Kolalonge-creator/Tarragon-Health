import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * Copy per gated feature. Episodic-fee rebuild: the subscription tiers this
 * copy used to name (Prevent/Essential/Complete) no longer exist — every one
 * of these is now bundled into an active Care Programme purchase (a flat,
 * one-time fee for a bounded window, e.g. 12 weeks of Hypertension care)
 * instead of a recurring plan. lab_coordination/medication_refills/
 * prevention_coordination were retired outright (unconditional for every
 * patient now — see labs/page.tsx) and no longer need an entry here.
 */
const FEATURE_COPY: Record<string, { title: string; body: string }> = {
  clinician_review: {
    title: "A doctor-set care plan is part of an active Care Programme",
    body: "Your readings are checked against care protocols on every account, including a free one, and a dangerous one gets you clear guidance and a specific next step right away. What an active Care Programme adds is that a dangerous reading also reaches a doctor, and a doctor sets your care plan and checks in on your condition on a schedule, not just when something is flagged. Whenever a doctor does review something of yours, flagged or scheduled, you'll see who reviewed it and when.",
  },
  doctor_checkin: {
    title: "Doctor check-ins are part of an active Care Programme",
    body: "Message your care team directly and get a scheduled doctor check-in while your Care Programme is active.",
  },
  annual_review: {
    title: "The Annual Doctor Review is part of an active Care Programme",
    body: "Get a once-a-year whole-body workup (general bloods, heart and other screening) plus a video consult with your Tarragon doctor to talk through your whole year.",
  },
  lifestyle_coaching: {
    title: "Lifestyle coaching is part of an active Care Programme",
    body: "Get guided diet, exercise, weight, sleep and stress coaching with progress reviews from your care team while your Care Programme is active.",
  },
  async_doctor_visit: {
    title: "Ask a doctor is part of an active Care Programme",
    body: "Send a written question and get a doctor's answer in the app within 72 hours while your Care Programme is active.",
  },
  health_education: {
    title: "Personalised health education is part of an active Care Programme",
    body: "Get clinician-reviewed learning built around your own conditions, with short knowledge checks, while your Care Programme is active.",
  },
  multi_condition_review: {
    title: "A scheduled review for this condition needs its own Care Programme",
    body: "Nothing urgent is ever held back for this: a dangerous reading still reaches a doctor the same as always. A proactive, scheduled review for this condition needs its own active Care Programme purchase, same as any other condition.",
  },
};

const DEFAULT_COPY = {
  title: "This is part of an active Care Programme",
  body: "Start a Care Programme to unlock this for your account.",
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
            <Link href="/patient/care-programmes">See Care Programmes</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
