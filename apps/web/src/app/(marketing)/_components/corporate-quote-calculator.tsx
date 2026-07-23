"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Indicative corporate pricing calculator — pure client-side arithmetic, no
 * data leaves the page (marketing pages never write to the platform; the CTA
 * routes to /contact). PER-EMPLOYEE RATES ARE PLACEHOLDERS for the founder
 * to confirm — shown as "indicative" and never as a binding quote.
 */
const TIERS = [
  {
    key: "screen",
    label: "Screen",
    ratePerYear: 25000,
    blurb: "Annual health check + risk profile for every employee, aggregated wellness report for HR.",
  },
  {
    key: "monitor",
    label: "Screen + Monitor",
    ratePerYear: 40000,
    blurb: "Adds year-round monitoring, reminders, and doctor escalation for flagged employees.",
  },
  {
    key: "full",
    label: "Full care",
    ratePerYear: 60000,
    blurb: "Adds chronic-condition management for affected staff and priority escalation.",
  },
] as const;

function volumeDiscount(headcount: number): number {
  if (headcount >= 500) return 0.15;
  if (headcount >= 100) return 0.1;
  return 0;
}

export function CorporateQuoteCalculator() {
  const [headcount, setHeadcount] = useState(50);
  const [tierKey, setTierKey] = useState<(typeof TIERS)[number]["key"]>("monitor");

  const tier = TIERS.find((t) => t.key === tierKey)!;
  const discount = volumeDiscount(headcount);
  const perEmployee = Math.round(tier.ratePerYear * (1 - discount));
  const total = perEmployee * Math.max(1, headcount);

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-8">
      <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
        What would this cost your organisation?
      </h3>
      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor="cq-headcount" className="text-sm font-medium text-charcoal-ink">
            Employees to cover: {headcount.toLocaleString()}
          </label>
          <input
            id="cq-headcount"
            type="range"
            min={10}
            max={2000}
            step={10}
            value={headcount}
            onChange={(e) => setHeadcount(Number(e.target.value))}
            className="mt-2 w-full accent-[#0E7C52]"
          />
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-charcoal-ink">Coverage level</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {TIERS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tierKey === t.key}
                onClick={() => setTierKey(t.key)}
                className={
                  tierKey === t.key
                    ? "rounded-xl border-2 border-brand-green bg-brand-green/5 p-3 text-left"
                    : "rounded-xl border border-charcoal-ink/15 p-3 text-left hover:border-charcoal-ink/30"
                }
              >
                <p className="text-sm font-semibold text-charcoal-ink">{t.label}</p>
                <p className="mt-1 text-xs text-charcoal-ink/60">{t.blurb}</p>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="rounded-xl bg-soft-sage p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-deep-forest">
            Indicative estimate
          </p>
          <p className="mt-1 font-heading text-2xl font-bold text-charcoal-ink">
            ₦{total.toLocaleString()}
            <span className="text-base font-normal text-charcoal-ink/60"> / year</span>
          </p>
          <p className="mt-1 text-xs text-charcoal-ink/60">
            ≈ ₦{perEmployee.toLocaleString()} per employee per year
            {discount > 0 && ` (includes ${Math.round(discount * 100)}% volume pricing)`}. An
            indication, not a quote — final pricing depends on your workforce profile and is
            always confirmed in writing.
          </p>
        </div>
        <Button asChild>
          <Link href="/contact">Get an exact quote</Link>
        </Button>
      </div>
    </div>
  );
}
