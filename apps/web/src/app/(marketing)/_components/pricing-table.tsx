"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DIASPORA_FAMILY_NOTE,
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

export function PricingTable() {
  const [currency, setCurrency] = useState<"NGN" | "GBP">("NGN");
  const tiers = currency === "NGN" ? NGN_TIERS : GBP_TIERS;

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
        {tiers.map((tier) => (
          <TierCard key={tier.id} tier={tier} />
        ))}
      </div>

      {currency === "GBP" ? (
        <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-charcoal-ink/70">
          {DIASPORA_FAMILY_NOTE}
        </p>
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
