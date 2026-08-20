"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { NGN_TIERS, USD_TIERS } from "../_content/pricing";

const ngnMonthlyPrice = (id: string) => `${NGN_TIERS.find((t) => t.id === id)!.priceMain}/month`;
const usdMonthlyPrice = (id: string) =>
  USD_TIERS.find((t) => t.id === id)!.priceSecondary!.replace(/^or /, "");

type Who = "me" | "someone-else";
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
 * the mapping is testable and every combination has a deliberate answer;
 * pricing decisions live in _content/pricing.ts, this only routes to them.
 *
 * Since removal 4 (2026-07-29) there is no household plan to route to, so
 * "who" no longer changes which plan is recommended; it changes whose plan it
 * is. Everyone enrols individually, so the answer for someone looking after a
 * parent is the plan that suits that parent, on that parent's own account,
 * funded by whoever is paying for it. Their lab tests stay paid straight to
 * the laboratory, never through Tarragon, even for a next-of-kin relationship.
 * The question is kept because it is the one people arrive with, and
 * answering it plainly is more useful than hiding it.
 */
export function recommendPlan(who: Who, health: Health, from: From): Recommendation {
  const forSomeoneElse =
    "They hold their own Tarragon account and their own subscription. Name each other as next of kin and you can follow their care and fund their plan; their lab tests are still paid straight to the laboratory.";

  const rec: Recommendation =
    health === "none"
      ? from === "abroad"
        ? {
            plan: "Tarragon Prevent (Diaspora)",
            price: usdMonthlyPrice("diaspora-prevent"),
            why: "The stay-healthy plan: a screening and vaccination calendar built around them, bookable when checks come due, plus personalised health education, so small things get caught before they become conditions.",
            secondary:
              "Just want to self-track for now? Tarragon Free is ₦0 forever, and the Annual Health Check comes with any paid plan: we say which tests are worth doing, you use any lab in Nigeria, and a doctor reads the result.",
          }
        : {
            plan: "Tarragon Prevent",
            price: ngnMonthlyPrice("prevent"),
            why: "The stay-healthy plan: a screening and vaccination calendar built around them, bookable when checks come due, plus personalised health education, so small things get caught before they become conditions.",
            secondary:
              "Just want to self-track for now? Tarragon Free is ₦0 forever, and the Annual Health Check comes with any paid plan: we say which tests are worth doing and a doctor reads whatever you upload.",
          }
      : health === "one"
        ? from === "abroad"
          ? {
              plan: "Essential Care (Diaspora)",
              price: usdMonthlyPrice("diaspora-essential"),
              why: "The same Essential Care monitoring, billed in dollars. The dollar price is the naira price converted, not a diaspora premium.",
            }
          : {
              plan: "Essential Care",
              price: ngnMonthlyPrice("essential"),
              why: "Real clinical monitoring for one condition, hypertension, diabetes, or weight management: a doctor reviews the readings every month and follows up on medication.",
            }
        : from === "abroad"
          ? {
              plan: "Complete Care (Diaspora)",
              price: usdMonthlyPrice("diaspora-complete"),
              why: "Weekly doctor review, with hypertension, diabetes, and weight all managed together on one care plan, billed in dollars.",
            }
          : {
              plan: "Complete Care",
              price: ngnMonthlyPrice("complete"),
              why: "Weekly doctor review, with hypertension, diabetes, and weight all managed together on one care plan, and priority escalation when something needs attention.",
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
