import { ADD_ONS } from "../_content/pricing";
import { PricingLabelBadge } from "./pricing-label";

export function PricingAddOns() {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {ADD_ONS.map((addOn) => (
        <div
          key={addOn.id}
          className="flex flex-col rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{addOn.name}</h3>
            <PricingLabelBadge label={addOn.label} />
          </div>
          <p className="mt-1 text-sm font-semibold text-brand-green">{addOn.price}</p>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">{addOn.description}</p>
          {addOn.items ? (
            <ul className="mt-4 space-y-2 border-t border-charcoal-ink/10 pt-4">
              {addOn.items.map((item) => (
                <li key={item.feature} className="flex items-start justify-between gap-3">
                  <span className="text-sm text-charcoal-ink/80">{item.feature}</span>
                  <PricingLabelBadge label={item.label} />
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-4 text-xs leading-relaxed text-charcoal-ink/70">{addOn.availability}</p>
        </div>
      ))}
    </div>
  );
}
