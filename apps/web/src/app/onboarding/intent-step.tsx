"use client";

export type OnboardingIntent = "manage" | "prevent" | "unsure";

const INTENT_OPTIONS: {
  value: OnboardingIntent;
  label: string;
  description: string;
}[] = [
  {
    value: "manage",
    label: "I'm managing a condition",
    description: "Blood pressure, diabetes, or something else you're already dealing with.",
  },
  {
    value: "prevent",
    label: "I want to stay ahead of problems",
    description: "Screenings, vaccinations, and catching anything early.",
  },
  {
    value: "unsure",
    label: "I'm not sure yet",
    description: "That's fine. We'll ask a few questions and go from there.",
  },
];

/**
 * Step 1 of onboarding, new: what brought this person here, asked before
 * anything else. Not a consent, not health data, and not stored anywhere —
 * it never gates finishing onboarding and resets on a page refresh, the
 * same way it would cost nothing to skip. Its only job is to pick which
 * section of the risk assessment opens first (see RiskAssessmentForm's
 * initialStep), so the very next thing after agreeing to the terms is a
 * question that is actually relevant to why they signed up, rather than the
 * same fixed family-history-first order for everyone.
 */
export function IntentStep({ onComplete }: { onComplete: (intent: OnboardingIntent) => void }) {
  return (
    <div className="space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
          What brings you here?
        </h2>
        <p className="mt-1 text-sm text-charcoal-ink/60">
          Helps us ask the right questions first. You can change your mind at any point.
        </p>
      </div>
      <div className="space-y-2">
        {INTENT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onComplete(option.value)}
            className="w-full rounded-xl border border-charcoal-ink/10 p-4 text-left transition-colors hover:border-brand-green/40 hover:bg-brand-green/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
          >
            <span className="block text-sm font-semibold text-charcoal-ink">{option.label}</span>
            <span className="mt-0.5 block text-xs text-charcoal-ink/60">{option.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
