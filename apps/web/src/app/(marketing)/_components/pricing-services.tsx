import { PAID_SERVICES, type PaidService } from "../_content/pricing";
import { PricingLabelBadge } from "./pricing-label";

/**
 * The paid menu: a doctor's time, priced per piece of work.
 *
 * The 12-week programme is rendered first and wider than the rest — it is the
 * only ongoing thing sold, and the one most patients managing a condition
 * actually want. Everything after it is a genuine one-off.
 *
 * Prices come from _content/pricing.ts as fallbacks and are overridden with the
 * live service_products price where one is passed in. Every entry here must
 * have an active service_products row; see that file's header for why.
 */
export function PricingServices({
  priceOverrides = {},
}: {
  priceOverrides?: Record<string, string>;
}) {
  const [programme, ...oneOffs] = PAID_SERVICES;
  const priceFor = (service: PaidService) => priceOverrides[service.code] ?? service.price;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border-2 border-brand-green/30 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-heading text-xl font-semibold text-charcoal-ink">
              {programme.name}
            </h3>
            <p className="mt-1 font-heading text-2xl font-bold text-brand-green">
              {priceFor(programme)}
              <span className="ml-2 align-middle text-sm font-normal text-charcoal-ink/60">
                for the full twelve weeks
              </span>
            </p>
          </div>
          <PricingLabelBadge label="PAID SERVICE" />
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-charcoal-ink/75">
          {programme.description}
        </p>
        {programme.breakdown ? (
          <ul className="mt-4 space-y-1.5 border-t border-charcoal-ink/10 pt-4">
            {programme.breakdown.map((line) => (
              <li key={line} className="flex items-start gap-2 text-sm text-charcoal-ink/80">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {programme.conditions ? (
          <div className="mt-4 grid gap-3 border-t border-charcoal-ink/10 pt-4 sm:grid-cols-2">
            {programme.conditions.map((c) => (
              <div key={c.condition} className="rounded-lg bg-brand-green/[0.04] p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-deep-forest">
                  {c.condition}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-charcoal-ink/70">{c.body}</p>
              </div>
            ))}
          </div>
        ) : null}
        {programme.optionalNote ? (
          <div className="mt-4 rounded-xl bg-clinical-navy/[0.04] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-clinical-navy">
              Optional
            </p>
            <p className="mt-1 text-xs leading-relaxed text-charcoal-ink/70">{programme.optionalNote}</p>
          </div>
        ) : null}
        <p className="mt-4 text-xs leading-relaxed text-charcoal-ink/60">
          {programme.availability}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {oneOffs.map((service) => (
          <div
            key={service.id}
            className="flex flex-col rounded-2xl border border-charcoal-ink/10 bg-white p-5 shadow-sm"
          >
            <h3 className="font-heading text-base font-semibold text-charcoal-ink">
              {service.name}
            </h3>
            <p className="mt-1 font-heading text-lg font-bold text-brand-green">
              {priceFor(service)}
            </p>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-charcoal-ink/70">
              {service.description}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-charcoal-ink/60">
              {service.availability}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
