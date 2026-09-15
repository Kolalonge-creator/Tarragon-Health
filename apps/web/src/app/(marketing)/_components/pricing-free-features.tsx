import { FREE_FEATURES, FREE_FEATURES_NOTE } from "../_content/pricing";

/**
 * What the app gives every patient for nothing.
 *
 * This replaced the four-column plan table when the packs were retired. It is
 * deliberately the largest block on the pricing page: the headline of this
 * pricing model is how much costs nothing, so burying it under the paid list
 * would misrepresent the product.
 */
export function PricingFreeFeatures() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FREE_FEATURES.map((group) => (
          <div
            key={group.id}
            className="flex flex-col rounded-2xl border border-brand-green/20 bg-brand-green/[0.04] p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
                {group.title}
              </h3>
              <span className="shrink-0 rounded-full bg-brand-green/10 px-2.5 py-1 text-xs font-semibold text-deep-forest">
                Free
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{group.body}</p>
            <ul className="mt-4 space-y-2 border-t border-brand-green/15 pt-4">
              {group.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-charcoal-ink/80">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mx-auto max-w-3xl text-center text-sm leading-relaxed text-charcoal-ink/70">
        {FREE_FEATURES_NOTE}
      </p>
    </div>
  );
}
