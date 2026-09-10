import Link from "next/link";
import { PAID_SERVICES, WEIGHT_MANAGEMENT, type PaidService } from "../_content/pricing";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { PricingLabelBadge } from "./pricing-label";

/**
 * The paid menu: a doctor's time, priced per piece of work, plus the one
 * ongoing product.
 *
 * The lead entry is rendered first and wider than the rest. It used to be the
 * 12-week pack and is now Continuous Monitoring, which is why the price caption
 * moved onto the data (PaidService.priceCaption) instead of being the hardcoded
 * string "for the full twelve weeks" it was here — that string silently became
 * a lie the moment the lead product changed. Everything after it is a genuine
 * one-off.
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
              {programme.priceCaption ? (
                <span className="ml-2 align-middle text-sm font-normal text-charcoal-ink/60">
                  {programme.priceCaption}
                </span>
              ) : null}
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
        {programme.terms ? (
          <div className="mt-4 grid gap-3 border-t border-charcoal-ink/10 pt-4 sm:grid-cols-3">
            {programme.terms.map((term) => (
              <div key={term.code} className="rounded-lg border border-charcoal-ink/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/55">
                  {term.label}
                </p>
                <p className="mt-0.5 font-heading text-lg font-bold text-brand-green">
                  {priceOverrides[term.code] ?? term.price}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-charcoal-ink/65">{term.perMonth}</p>
              </div>
            ))}
          </div>
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

      {/* Its own block, not a card in the grid above. It is a course of medical
          supervision rather than a piece of work, and it needs its own
          disclosure: Tarragon does not prescribe or supply weight-loss
          medication, and the database refuses an enrolment against a medicine
          Tarragon started. Never let this collapse into the one-off grid, and
          never drop the disclosure to make it fit. */}
      <div className="rounded-2xl border border-clinical-navy/20 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-heading text-xl font-semibold text-charcoal-ink">
              {WEIGHT_MANAGEMENT.name}
            </h3>
            <p className="mt-1 font-heading text-2xl font-bold text-brand-green">
              {priceOverrides[WEIGHT_MANAGEMENT.terms[0].code] ?? WEIGHT_MANAGEMENT.price}
              <span className="ml-2 align-middle text-sm font-normal text-charcoal-ink/60">
                {WEIGHT_MANAGEMENT.priceCaption}
              </span>
            </p>
          </div>
          <PricingLabelBadge label="PAID SERVICE" />
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-charcoal-ink/75">
          {WEIGHT_MANAGEMENT.description}
        </p>
        <div className="mt-4 rounded-xl border-l-2 border-clinical-navy bg-clinical-navy/[0.04] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-clinical-navy">
            What we do not do
          </p>
          <p className="mt-1 text-xs leading-relaxed text-charcoal-ink/75">
            {WEIGHT_MANAGEMENT.disclosure}
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {WEIGHT_MANAGEMENT.terms.map((term) => (
            <div key={term.code} className="rounded-lg border border-charcoal-ink/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/55">
                {term.label}
              </p>
              <p className="mt-0.5 font-heading text-lg font-bold text-brand-green">
                {priceOverrides[term.code] ?? term.price}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-charcoal-ink/65">{term.perMonth}</p>
            </div>
          ))}
        </div>
        <Link
          href={MARKETING_ROUTES.weightManagement}
          className="mt-4 inline-block text-sm font-medium text-brand-green underline decoration-brand-green/40 underline-offset-4 hover:decoration-brand-green"
        >
          How supervision works, and who it is not for
        </Link>
      </div>
    </div>
  );
}
