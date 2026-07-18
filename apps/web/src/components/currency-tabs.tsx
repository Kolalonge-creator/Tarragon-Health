"use client";

import type { Currency } from "@tarragon/shared";

const CURRENCIES: Currency[] = ["NGN", "USD", "GBP"];

/** NGN/USD/GBP tab selector for plan-picker UIs (onboarding, /patient/
 * subscription) — visually matches the existing monthly/yearly interval
 * toggle already used alongside it. */
export function CurrencyTabs({
  value,
  onChange,
}: {
  value: Currency;
  onChange: (currency: Currency) => void;
}) {
  return (
    <div className="flex gap-2 text-xs">
      {CURRENCIES.map((currency) => (
        <button
          key={currency}
          type="button"
          onClick={() => onChange(currency)}
          className={`rounded-full border px-2.5 py-1 font-medium ${
            value === currency
              ? "border-brand-green bg-brand-green/10 text-brand-green"
              : "border-charcoal-ink/20 bg-white text-charcoal-ink/70"
          }`}
        >
          {currency}
        </button>
      ))}
    </div>
  );
}
