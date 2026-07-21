"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type Who = "me" | "family" | "parents";
type Health = "none" | "one" | "multiple";
type From = "nigeria" | "abroad";

type Recommendation = {
  plan: string;
  price: string;
  why: string;
  secondary?: string;
};

/**
 * Maps the three answers to a single recommended plan. Pure and exhaustive so
 * the mapping is testable and every combination has a deliberate answer —
 * pricing decisions live in _content/pricing.ts; this only routes to them.
 */
export function recommendPlan(who: Who, health: Health, from: From): Recommendation {
  if (who === "parents") {
    return from === "abroad"
      ? {
          plan: "ParentCare (Diaspora)",
          price: "£119/month for up to 2 parents",
          why: "A named doctor coordinator, scheduled reviews of their readings, and a quarterly report you can read from anywhere.",
          secondary:
            "Watching over one parent only? Premium Care (Diaspora) at £99/month is the single-person version.",
        }
      : {
          plan: "ParentCare",
          price: "₦25,000/month for up to 2 parents",
          why: "Built specifically for keeping close watch over a parent's health: named doctor coordinator, scheduled reviews, quarterly family report.",
        };
  }
  if (who === "family") {
    if (from === "abroad") {
      return health === "multiple"
        ? {
            plan: "Family Plus (Diaspora)",
            price: "£890/year for up to 4 people",
            why: "A named family doctor coordinator and priority escalation for every member back home — billed in pounds, visible from anywhere.",
            secondary: "Family Lite (£590/year) works too if you mainly want everyone monitored on one bill.",
          }
        : {
            plan: "Family Lite (Diaspora)",
            price: "£590/year for up to 4 people",
            why: "One plan and one bill in pounds for your family in Nigeria, with monitoring matched to each member's needs.",
            secondary: "Covering just your parents? ParentCare (Diaspora) at £119/month covers up to 2 parents.",
          };
    }
    return health === "multiple"
      ? {
          plan: "Family Plus",
          price: "₦220,000/year for up to 4 people",
          why: "A named family doctor coordinator and priority escalation for every member — the closer coordination a household managing real conditions needs.",
          secondary: "Family Lite (₦150,000/year) works too if you mainly want everyone monitored on one bill.",
        }
      : {
          plan: "Family Lite",
          price: "₦150,000/year for up to 4 people",
          why: "One plan and one bill for the whole household, with monitoring matched to each member's needs.",
        };
  }
  // who === "me"
  if (health === "none") {
    return {
      plan: "Tarragon Free",
      price: "₦0, forever",
      why: "Track your own numbers and build the habit first — it never expires and never converts to a paid plan on its own.",
      secondary:
        "Want a one-off full check? The Annual Health Check (₦65,000) is available to anyone, on any plan.",
    };
  }
  if (health === "one") {
    return from === "abroad"
      ? {
          plan: "Essential Care (Diaspora)",
          price: "£25/month",
          why: "The same Essential Care monitoring, billed in pounds.",
        }
      : {
          plan: "Essential Care",
          price: "₦8,000/month",
          why: "Real clinical monitoring for one condition: a doctor reviews your readings every month and follows up on your medication.",
        };
  }
  return from === "abroad"
    ? {
        plan: "Complete Care (Diaspora)",
        price: "£59/month",
        why: "Weekly doctor review and support for multiple conditions on one care plan, billed in pounds.",
      }
    : {
        plan: "Complete Care",
        price: "₦15,000/month",
        why: "Weekly doctor review, multiple conditions on one care plan, and priority escalation when something needs attention.",
      };
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
      { value: "family", label: "My household or family" },
      { value: "parents", label: "My parent(s)" },
    ],
  },
  {
    key: "health",
    label: "What best describes the health situation?",
    options: [
      { value: "none", label: "No diagnosed condition — staying ahead" },
      { value: "one", label: "One condition (e.g. blood pressure or sugar)" },
      { value: "multiple", label: "More than one condition, or higher risk" },
    ],
  },
  {
    key: "from",
    label: "Where are you paying from?",
    options: [
      { value: "nigeria", label: "Nigeria (₦)" },
      { value: "abroad", label: "Abroad (£ / $)" },
    ],
  },
];

/** Three questions, one recommendation — cuts the tier-choice overload. */
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
            This is a suggestion, not a commitment — every plan is listed in full below, and you can
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
