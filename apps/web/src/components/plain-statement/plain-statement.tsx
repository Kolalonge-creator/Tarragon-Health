import Link from "next/link";
import type { PlainStatement } from "@tarragon/i18n";

/**
 * The plain "Pricing and accessibility" statement. Presentational only (no auth, no data access), so the public site and the
 * signed-in Settings can both render it. Order matters: privacy first, then what costs money, then accessibility.
 */
export interface PlainStatementViewProps {
  readonly statement: PlainStatement;
  readonly headingLevel?: "h1" | "h2";
  readonly privacyHref: string;
  readonly accessibilityHref: string;
  readonly pricingHref: string;
  readonly idPrefix?: string;
}

const linkClass = "font-semibold text-brand-green underline underline-offset-2";
const bodyClass = "leading-relaxed text-charcoal-ink/80 dark:text-night-ink/80";
const headClass = "font-heading text-xl font-semibold text-charcoal-ink dark:text-night-ink";
const strongClass = "font-semibold text-charcoal-ink dark:text-night-ink";

export function PlainStatementView({
  statement: s,
  headingLevel = "h2",
  privacyHref,
  accessibilityHref,
  pricingHref,
  idPrefix = "plain",
}: PlainStatementViewProps) {
  const Title = headingLevel;
  const Sub = headingLevel === "h1" ? "h2" : "h3";
  const Minor = headingLevel === "h1" ? "h3" : "h4";
  const Third = headingLevel === "h1" ? "h4" : "h5";
  return (
    <div className="space-y-8">
      <header>
        <Title className="font-heading text-3xl font-bold leading-tight text-charcoal-ink dark:text-night-ink">{s.title}</Title>
        <p className={`mt-3 ${bodyClass}`}>{s.intro}</p>
      </header>

      <section aria-labelledby={`${idPrefix}-privacy`}>
        <Sub id={`${idPrefix}-privacy`} className={headClass}>{s.privacy.title}</Sub>
        <ul className={`mt-3 list-disc space-y-2 pl-5 ${bodyClass}`}>
          {s.privacy.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="mt-3">
          <Link href={privacyHref} className={linkClass}>{s.privacy.fullLink}</Link>
        </p>
      </section>

      <section aria-labelledby={`${idPrefix}-pricing`}>
        <Sub id={`${idPrefix}-pricing`} className={headClass}>{s.pricing.title}</Sub>
        <Minor className={`mt-4 ${strongClass}`}>{s.pricing.freeHead}</Minor>
        <p className={`mt-1 ${bodyClass}`}>{s.pricing.freeBody}</p>
        <Minor className={`mt-4 ${strongClass}`}>{s.pricing.paidHead}</Minor>
        {s.pricing.difference ? <p className={`mt-1 ${bodyClass}`}>{s.pricing.difference}</p> : null}
        {s.pricing.offers.map((o) => (
          <div key={o.name} className="mt-3">
            <Third className={strongClass}>{o.name}</Third>
            <p className={`mt-1 ${bodyClass}`}>{o.description}</p>
            <ul className={`mt-2 list-disc space-y-1 pl-5 ${bodyClass}`}>
              {o.includes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className={`mt-2 ${strongClass}`}>{o.priceLine}</p>
          </div>
        ))}
        {s.pricing.renewalLine ? <p className={`mt-2 ${bodyClass}`}>{s.pricing.renewalLine}</p> : null}
        {s.pricing.refundLine ? <p className={`mt-2 ${bodyClass}`}>{s.pricing.refundLine}</p> : null}
        <p className={`mt-1 ${bodyClass}`}>{s.pricing.noTricks}</p>
        <p className="mt-3">
          <Link href={pricingHref} className={linkClass}>{s.pricing.seePage}</Link>
        </p>
      </section>

      <section aria-labelledby={`${idPrefix}-access`}>
        <Sub id={`${idPrefix}-access`} className={headClass}>{s.access.title}</Sub>
        <ul className={`mt-3 list-disc space-y-2 pl-5 ${bodyClass}`}>
          {s.access.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className={`mt-3 ${bodyClass}`}>{s.access.limits}</p>
        <p className="mt-3">
          <Link href={accessibilityHref} className={linkClass}>{s.access.fullLink}</Link>
        </p>
      </section>

      <section aria-labelledby={`${idPrefix}-ads`}>
        <Sub id={`${idPrefix}-ads`} className={headClass}>{s.ads.title}</Sub>
        <p className={`mt-3 ${bodyClass}`}>{s.ads.body}</p>
      </section>
    </div>
  );
}
