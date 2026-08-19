import Link from "next/link";
import { BrandLockup } from "./brand-logo";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { SITE } from "@/lib/marketing/site";

const FOOTER_LINKS = {
  care: [
    { href: MARKETING_ROUTES.services, label: "Services" },
    { href: MARKETING_ROUTES.chronicCare, label: "Chronic care" },
    { href: MARKETING_ROUTES.prevention, label: "Prevention" },
    { href: MARKETING_ROUTES.careCoordination, label: "Care coordination" },
  ],
  programmes: [
    { href: MARKETING_ROUTES.prevention, label: "Preventive Health" },
    { href: MARKETING_ROUTES.annualHealthCheck, label: "Annual Health Check" },
    { href: MARKETING_ROUTES.screeningJourney, label: "Screening Journey" },
    { href: MARKETING_ROUTES.vaccinations, label: "Vaccinations" },
    { href: MARKETING_ROUTES.healthEducation, label: "Health Education" },
    { href: MARKETING_ROUTES.mentalWellbeingCheck, label: "Mental Well-being Check" },
    { href: MARKETING_ROUTES.parentcare, label: "Caring for a parent" },
  ],
  conditions: [
    { href: MARKETING_ROUTES.hypertension, label: "Hypertension" },
    { href: MARKETING_ROUTES.diabetes, label: "Diabetes" },
    { href: MARKETING_ROUTES.obesity, label: "Weight Health" },
    { href: MARKETING_ROUTES.medication, label: "Medication" },
    { href: MARKETING_ROUTES.labs, label: "Labs" },
    { href: MARKETING_ROUTES.bmiCalculator, label: "BMI & Calorie Calculator" },
    { href: MARKETING_ROUTES.activityCalculator, label: "Activity Calculator" },
  ],
  company: [
    { href: MARKETING_ROUTES.pricing, label: "Pricing" },
    { href: MARKETING_ROUTES.gift, label: "Gift Tarragon" },
    { href: MARKETING_ROUTES.whoItsFor, label: "Who it's for" },
    { href: MARKETING_ROUTES.forYou, label: "For you" },
    { href: MARKETING_ROUTES.about, label: "About" },
    { href: MARKETING_ROUTES.careers, label: "Careers" },
    { href: MARKETING_ROUTES.resources, label: "Resources" },
    { href: MARKETING_ROUTES.impact, label: "Our impact" },
    { href: MARKETING_ROUTES.accountability, label: "How we're accountable" },
    { href: MARKETING_ROUTES.coverage, label: "Where we work" },
    { href: MARKETING_ROUTES.faq, label: "FAQ" },
    { href: MARKETING_ROUTES.contact, label: "Contact" },
  ],
  business: [
    { href: MARKETING_ROUTES.corporate, label: "Corporate Health" },
    { href: MARKETING_ROUTES.hmo, label: "HMO Support" },
    { href: "/login", label: "Sign in" },
    { href: "/signup", label: "Get started" },
  ],
  legal: [
    { href: MARKETING_ROUTES.privacy, label: "Privacy" },
    { href: MARKETING_ROUTES.telehealthConsent, label: "Telehealth consent" },
    { href: MARKETING_ROUTES.terms, label: "Terms of service" },
    { href: MARKETING_ROUTES.accessibility, label: "Accessibility" },
    { href: MARKETING_ROUTES.cookies, label: "Cookies" },
  ],
};

function FacebookGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M13.5 21v-7.6h2.55l.38-2.96h-2.93V8.53c0-.86.24-1.44 1.47-1.44h1.57V4.46c-.27-.04-1.2-.12-2.29-.12-2.26 0-3.81 1.38-3.81 3.92v2.18H7.98v2.96h2.46V21h3.06z" />
    </svg>
  );
}

function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
      className={className}
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function XGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M14.05 10.3 21.1 3h-1.67l-6.13 6.34L8.4 3H3l7.4 10.02L3.4 21h1.67l6.48-6.7L16.8 21H22l-7.95-10.7Zm-2.3 2.38-.75-1.02L5.06 4.17h2.57l4.82 6.56.75 1.02 6.27 8.53h-2.57l-5.15-6.6Z" />
    </svg>
  );
}

const SOCIAL_LINKS = [
  { href: SITE.sameAs[0], label: "Facebook", Glyph: FacebookGlyph },
  { href: SITE.sameAs[1], label: "Instagram", Glyph: InstagramGlyph },
  { href: SITE.sameAs[2], label: "X (Twitter)", Glyph: XGlyph },
];

function SocialLinks() {
  return (
    <ul className="flex items-center gap-3">
      {SOCIAL_LINKS.map(({ href, label, Glyph }) => (
        <li key={label}>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={`TarragonHealth on ${label}`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-white/70 transition-colors hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 focus-visible:ring-offset-clinical-navy"
          >
            <Glyph className="h-4 w-4" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function FooterLink({
  href,
  label,
  soon,
}: {
  href: string;
  label: string;
  soon?: boolean;
}) {
  if (soon) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-white/45">
        {label}
        <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wide">
          soon
        </span>
      </span>
    );
  }

  return (
    <Link
      href={href}
      className="text-sm text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 focus-visible:ring-offset-clinical-navy rounded-sm"
    >
      {label}
    </Link>
  );
}

function FooterGroup({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string; soon?: boolean }[];
}) {
  return (
    <div>
      <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-white/90">
        {title}
      </h2>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.label}>
            <FooterLink {...link} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-charcoal-ink/10 bg-clinical-navy text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr_1fr]">
        <div className="space-y-5">
          <BrandLockup tone="on-navy" markClassName="h-10 w-10" wordmarkClassName="text-xl" />
          <div className="space-y-2">
            <p className="font-heading text-lg font-semibold text-white">
              Care that stays with you.
            </p>
            <p className="max-w-xs text-sm leading-relaxed text-white/65">
              Continuous monitoring for chronic disease, preventive health,
              family care, and the follow-up between visits.
            </p>
            <p className="text-sm text-white/65">
              <a
                href="mailto:hello@tarragonhealth.ng"
                className="text-white/90 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 focus-visible:ring-offset-clinical-navy rounded-sm"
              >
                hello@tarragonhealth.ng
              </a>
              <span className="text-white/40"> · </span>
              <a
                href="mailto:support@tarragonhealth.ng"
                className="text-white/90 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 focus-visible:ring-offset-clinical-navy rounded-sm"
              >
                support@tarragonhealth.ng
              </a>
            </p>
            <p className="text-sm text-white/65">
              <a
                href="tel:+2348061197940"
                className="text-white/90 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 focus-visible:ring-offset-clinical-navy rounded-sm"
              >
                +234 806 119 7940
              </a>
            </p>
          </div>
          <SocialLinks />
        </div>

        <FooterGroup title="Care" links={FOOTER_LINKS.care} />
        <FooterGroup title="Programmes" links={FOOTER_LINKS.programmes} />
        <FooterGroup title="Conditions" links={FOOTER_LINKS.conditions} />
        <FooterGroup title="Company" links={FOOTER_LINKS.company} />
        <FooterGroup title="Business" links={FOOTER_LINKS.business} />
      </div>

      <div className="border-t border-white/10 px-4 py-5 sm:px-6">
        <p className="mx-auto max-w-3xl text-center text-xs leading-relaxed text-white/80">
          <span className="font-semibold text-white">TarragonHealth does not provide emergency care.</span>{" "}
          In a medical emergency, go to your nearest hospital immediately or call your local
          emergency number.
        </p>
      </div>

      <div className="border-t border-white/10 px-4 py-6 text-center text-xs text-white/70 sm:px-6">
        <p>
          © {new Date().getFullYear()} TarragonHealth. Health monitoring for Nigerians.
          <span className="text-white/40"> · </span>
          RC 9702108
        </p>
        <p className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          {FOOTER_LINKS.legal.map((link, i) => (
            <span key={link.href} className="flex items-center gap-x-3">
              {i > 0 ? <span className="text-white/30">·</span> : null}
              <Link
                href={link.href}
                className="text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 focus-visible:ring-offset-clinical-navy rounded-sm"
              >
                {link.label}
              </Link>
            </span>
          ))}
        </p>
      </div>
    </footer>
  );
}
