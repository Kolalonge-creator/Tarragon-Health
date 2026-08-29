"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { NGN_TIERS, USD_TIERS, type PricingTier } from "../_content/pricing";

type Who = "me" | "someone-else";
type Health = "none" | "one" | "multiple";
type From = "nigeria" | "abroad";

type Recommendation = {
  plan: string;
  price: string;
  why: string;
  secondary?: string;
};

function tierById(tiers: PricingTier[], id: string): PricingTier {
  const tier = tiers.find((t) => t.id === id);
  if (!tier) throw new Error(`plan-finder: no pricing tier with id "${id}"`);
  return tier;
}

/** NGN tiers price per month directly in `priceMain` (e.g. "₦5,000"); USD
 * tiers price per YEAR in `priceMain`, with the monthly equivalent in
 * `priceSecondary` (e.g. "or $4.03/month") since the diaspora tab leads with
 * annual billing. Both are normalised to a single "<amount>/month" string. */
function monthlyPrice(tier: PricingTier): string {
  if (tier.priceSecondary?.includes("/month")) {
    return tier.priceSecondary.replace(/^or\s+/, "");
  }
  return `${tier.priceMain}/month`;
}

/**
 * Maps the answers to a single recommended plan. Pure and exhaustive so the
 * mapping is testable and every combination has a deliberate answer. Prices
 * and plan names are read live from _content/pricing.ts's NGN_TIERS/
 * USD_TIERS (the pricing page's own source of truth) rather than duplicated
 * here, so this can never drift out of sync with the pricing table shown
 * right below it on the same page (that drift happened once already, see
 * 2026-08-12 marketing-site audit).
 *
 * Superseded 2026-08-29: Prevent/Essential/Complete are retired, replaced by
 * Care Pass, ONE product covering every condition count — so `health` no
 * longer changes WHICH plan is recommended in Nigeria, only the "why" copy.
 * It's kept as a question because it's still the one people arrive with, and
 * a plan-your-visit-shaped answer is more useful than a generic one.
 *
 * `from === "abroad"` routes to Family Watch (E1, diaspora) — funding a
 * relative's care in Nigeria from abroad, not a self-serve plan for the
 * answering person themselves (see the "who=me" secondary copy below,
 * which says so plainly rather than mis-selling a solo-abroad product
 * Tarragon can't actually deliver).
 *
 * Since removal 4 (2026-07-29) there is no household plan to route to, so
 * "who" doesn't change which Nigeria plan is recommended; it changes whose
 * plan it is. Everyone enrols individually, so the answer for someone
 * looking after a parent is the plan that suits that parent, on that
 * parent's own account, funded by whoever is paying for it. Their lab tests
 * stay paid straight to the laboratory, never through Tarragon, even for a
 * next-of-kin relationship.
 */
export function recommendPlan(who: Who, health: Health, from: From): Recommendation {
  const forSomeoneElse =
    "They hold their own Tarragon account and their own subscription. Name each other as next of kin and you can follow their care and fund their plan; their lab tests are still paid straight to the laboratory.";

  if (from === "abroad") {
    const familyWatch = tierById(USD_TIERS, "family_watch");
    return {
      plan: familyWatch.name,
      price: monthlyPrice(familyWatch),
      why: "Tarragon's care is delivered in Nigeria. Family Watch funds continuous monitoring for a relative there: a doctor-set care plan, defined escalation, and a written monthly update sent to you.",
      secondary:
        who === "someone-else"
          ? forSomeoneElse
          : "Care for yourself while you're outside Nigeria isn't available yet — Family Watch is for funding someone else's care there, not your own.",
    };
  }

  const whyByHealth: Record<Health, string> = {
    none: "A screening and vaccination calendar built around them, with reminders when checks come due, plus personalised health education, so small things get caught before they become conditions.",
    one: "A doctor-set care plan for one condition — hypertension, diabetes, or weight management — with a scheduled review, regular check-ins, and medication follow-up.",
    multiple:
      "A scheduled review for each condition you manage, with hypertension, diabetes, and weight all handled together on one care plan, and priority escalation when something needs attention.",
  };

  const carePass = tierById(NGN_TIERS, "care_pass_12mo");
  const rec: Recommendation = {
    plan: carePass.name,
    // Care Pass is a one-off term, not a recurring monthly/yearly charge —
    // monthlyPrice() (below) assumes the latter and would mislabel it, so
    // this reads priceMain/pricePeriod directly instead.
    price: `${carePass.priceMain} ${carePass.pricePeriod ?? ""}`.trim(),
    why: whyByHealth[health],
    secondary:
      "Just want to self-track for now? Tarragon Free is ₦0 forever, and Care Pass covers the Annual Health Check review too: we say which tests are worth doing and a doctor reads whatever you upload.",
  };

  if (who === "someone-else") {
    return { ...rec, secondary: forSomeoneElse };
  }
  return rec;
}

const QUESTIONS: {
  key: "who" | "health" | "from";
  label: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "who",
    label: "Who needs care?",
    options: [
      { value: "me", label: "Just me" },
      { value: "someone-else", label: "Someone I look after" },
    ],
  },
  {
    key: "health",
    label: "What best describes their health situation?",
    options: [
      { value: "none", label: "No diagnosed condition, staying ahead" },
      { value: "one", label: "One condition: hypertension, diabetes, or weight management" },
      { value: "multiple", label: "More than one of these, or higher risk" },
    ],
  },
  {
    key: "from",
    label: "Where are you paying from?",
    options: [
      { value: "nigeria", label: "Nigeria (₦)" },
      { value: "abroad", label: "Abroad ($)" },
    ],
  },
];

/** Three questions, one recommendation; cuts the tier-choice overload. */
export function PlanFinder() {
  const [answers, setAnswers] = useState<{ who?: Who; health?: Health; from?: From }>({});
  const done = answers.who && answers.health && answers.from;
  const rec = done ? recommendPlan(answers.who!, answers.health!, answers.from!) : null;

  return (
    <div className="mx-auto mb-12 max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
      <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
        Not sure which plan? Answer three questions.
      </h3>
      <div className="mt-4 space-y-4">
        {QUESTIONS.map((q) => (
          <fieldset key={q.key}>
            <legend className="text-sm font-medium text-charcoal-ink">{q.label}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {q.options.map((opt) => {
                const selected = answers[q.key] === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setAnswers((a) => ({ ...a, [q.key]: opt.value }))}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
                      selected
                        ? "border-brand-green bg-brand-green/10 font-medium text-deep-forest"
                        : "border-charcoal-ink/15 text-charcoal-ink/70 hover:border-charcoal-ink/30 hover:text-charcoal-ink"
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      {rec ? (
        <div className="mt-6 rounded-xl bg-soft-sage p-5" role="status">
          <p className="text-xs font-semibold uppercase tracking-wide text-deep-forest">
            Our suggestion
          </p>
          <p className="mt-1 font-heading text-xl font-semibold text-charcoal-ink">
            {rec.plan} <span className="text-base font-normal text-charcoal-ink/70">· {rec.price}</span>
          </p>
          <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/75">{rec.why}</p>
          {rec.secondary ? (
            <p className="mt-2 text-xs leading-relaxed text-charcoal-ink/60">{rec.secondary}</p>
          ) : null}
          <p className="mt-3 text-xs text-charcoal-ink/60">
            This is a suggestion, not a commitment; every plan is listed in full below, and you can
            change or cancel at any time.
          </p>
        </div>
      ) : (
        <p className="mt-6 text-sm text-charcoal-ink/60">
          Pick one answer for each question and we&apos;ll point you at the right plan.
        </p>
      )}
    </div>
  );
}
