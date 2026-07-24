"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DIASPORA_FAMILY_NOTE,
  DIASPORA_SELF_USE_NOTE,
  GBP_TIERS,
  NGN_TIERS,
  PRICING_LABELS,
  type PricingTier,
} from "../_content/pricing";
import { PricingLabelBadge } from "./pricing-label";

function TierCard({ tier }: { tier: PricingTier }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border bg-white p-6 shadow-sm",
        tier.highlight ? "border-brand-green shadow-md" : "border-charcoal-ink/10"
      )}
    >
      {tier.highlight ? (
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-deep-forest">
          Most popular
        </p>
      ) : null}
      <h3 className="font-heading text-2xl font-semibold text-charcoal-ink">{tier.name}</h3>
      <p className="mt-1 text-sm text-charcoal-ink/70">{tier.whoFor}</p>
      <div className="mt-3 flex items-end gap-2">
        <p className="font-heading text-4xl font-bold text-clinical-navy">{tier.priceMain}</p>
        {tier.pricePeriod ? (
          <p className="pb-1 text-sm text-charcoal-ink/70">{tier.pricePeriod}</p>
        ) : null}
      </div>
      {tier.priceSecondary ? (
        <p className="mt-1 text-sm text-charcoal-ink/70">{tier.priceSecondary}</p>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">{tier.description}</p>
      <ul className="mt-6 space-y-3 border-t border-charcoal-ink/10 pt-6">
        {tier.items.map((item) => (
          <li key={item.feature} className="flex items-start justify-between gap-3">
            <span className="text-sm text-charcoal-ink/80">{item.feature}</span>
            <PricingLabelBadge label={item.label} />
          </li>
        ))}
      </ul>
      {tier.footnote ? (
        <p className="mt-4 text-xs leading-relaxed text-charcoal-ink/70">{tier.footnote}</p>
      ) : null}
      <div className="mt-6 pt-2">
        <Button asChild className="w-full">
          <Link href="/signup">Start monitoring</Link>
        </Button>
      </div>
    </div>
  );
}

/** Matches both NGN ("family-lite") and diaspora ("family-lite-gbp") ids. */
function isFamilyTier(tier: PricingTier): boolean {
  return tier.id.startsWith("family-");
}

function isParentcareTier(tier: PricingTier): boolean {
  return tier.id.startsWith("parentcare");
}

/**
 * The three family tiers collapsed into one card with a level toggle: a
 * buyer choosing "a family plan" first, then a level, faces 5 visual choices
 * on the NGN tab instead of 7 stacked cards.
 */
function FamilyPlansCard({ tiers }: { tiers: PricingTier[] }) {
  const [activeId, setActiveId] = useState(tiers[0]?.id);
  const active = tiers.find((t) => t.id === activeId) ?? tiers[0];
  if (!active) return null;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-deep-forest">
        Family plans · one bill, up to 4 people (extendable to 6)
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Family plan level">
        {tiers.map((tier) => (
          <button
            key={tier.id}
            type="button"
            role="tab"
            aria-selected={tier.id === active.id}
            onClick={() => setActiveId(tier.id)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
              tier.id === active.id
                ? "border-brand-green bg-brand-green/10 font-medium text-deep-forest"
                : "border-charcoal-ink/15 text-charcoal-ink/70 hover:border-charcoal-ink/30 hover:text-charcoal-ink"
            )}
          >
            {tier.name.replace(/^Family /, "")}
          </button>
        ))}
      </div>
      <h3 className="mt-4 font-heading text-2xl font-semibold text-charcoal-ink">{active.name}</h3>
      <p className="mt-1 text-sm text-charcoal-ink/70">{active.whoFor}</p>
      <div className="mt-3 flex items-end gap-2">
        <p className="font-heading text-4xl font-bold text-clinical-navy">{active.priceMain}</p>
        {active.pricePeriod ? (
          <p className="pb-1 text-sm text-charcoal-ink/70">{active.pricePeriod}</p>
        ) : null}
      </div>
      {active.priceSecondary ? (
        <p className="mt-1 text-sm text-charcoal-ink/70">{active.priceSecondary}</p>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">{active.description}</p>
      <ul className="mt-6 space-y-3 border-t border-charcoal-ink/10 pt-6">
        {active.items.map((item) => (
          <li key={item.feature} className="flex items-start justify-between gap-3">
            <span className="text-sm text-charcoal-ink/80">{item.feature}</span>
            <PricingLabelBadge label={item.label} />
          </li>
        ))}
      </ul>
      {active.footnote ? (
        <p className="mt-4 text-xs leading-relaxed text-charcoal-ink/70">{active.footnote}</p>
      ) : null}
      <div className="mt-auto pt-8">
        <Button asChild className="w-full">
          <Link href="/signup">Start monitoring</Link>
        </Button>
      </div>
    </div>
  );
}

export function PricingTable() {
  const [currency, setCurrency] = useState<"NGN" | "GBP">("NGN");
  const tiers = currency === "NGN" ? NGN_TIERS : GBP_TIERS;
  const individualTiers = tiers.filter((t) => !isFamilyTier(t) && !isParentcareTier(t));
  const familyTiers = tiers.filter(isFamilyTier);
  const parentcareTier = tiers.find(isParentcareTier);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => setCurrency("NGN")}
          className={cn(
            "rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
            currency === "NGN"
              ? "bg-brand-green text-white"
              : "bg-white text-charcoal-ink/70 hover:text-charcoal-ink"
          )}
        >
          Nigeria (₦)
        </button>
        <button
          type="button"
          onClick={() => setCurrency("GBP")}
          className={cn(
            "rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
            currency === "GBP"
              ? "bg-brand-green text-white"
              : "bg-white text-charcoal-ink/70 hover:text-charcoal-ink"
          )}
        >
          Diaspora (£)
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {individualTiers.map((tier) => (
          <TierCard key={tier.id} tier={tier} />
        ))}
      </div>

      {(familyTiers.length > 0 || parentcareTier) && (
        <>
          <h3 className="mt-12 text-center font-heading text-xl font-semibold text-charcoal-ink">
            For your family &amp; parents
          </h3>
          <div className="mt-6 grid items-stretch gap-6 lg:grid-cols-2">
            {familyTiers.length > 0 ? <FamilyPlansCard tiers={familyTiers} /> : null}
            {parentcareTier ? <TierCard tier={parentcareTier} /> : null}
          </div>
        </>
      )}

      {currency === "GBP" ? (
        <div className="mx-auto mt-6 max-w-2xl space-y-3 text-center text-sm text-charcoal-ink/70">
          <p>{DIASPORA_FAMILY_NOTE}</p>
          <p>{DIASPORA_SELF_USE_NOTE}</p>
        </div>
      ) : (
        <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-charcoal-ink/70">
          No plan has a set-up fee. No plan has a cancellation fee.
        </p>
      )}

      <div className="mt-10 rounded-2xl border border-charcoal-ink/10 bg-white p-6">
        <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
          How to read these labels
        </h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(PRICING_LABELS) as Array<keyof typeof PRICING_LABELS>).map((key) => (
            <div key={key} className="rounded-xl bg-warm-ivory p-4">
              <PricingLabelBadge label={key} />
              <p className="mt-2 text-sm text-charcoal-ink/65">{PRICING_LABELS[key].description}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm font-medium text-charcoal-ink">
          No hidden costs. Every price states its currency explicitly, and every line item carries
          exactly one label.
        </p>
      </div>
    </div>
  );
}
