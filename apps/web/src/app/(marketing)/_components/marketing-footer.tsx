import Link from "next/link";
import { BrandLockup } from "./brand-logo";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { SITE } from "@/lib/marketing/site";
import { CookieSettingsLink } from "./cookie-settings-link";

const FOOTER_FOCUS =
  "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sprout-gold focus-visible:ring-offset-2 focus-visible:ring-offset-clinical-navy";

/**
 * Footer, reorganised 2026-11-05 (website upgrade Phase 1, plan section 3.4):
 * four columns by what a visitor is looking for, instead of five columns and
 * about 40 links where Medication and Laboratories sat under "Conditions".
 * Pages planned for a 301 redirect (parentcare, annual-health-check,
 * advanced-diagnostics, who-its-for, screening-journey, health-education,
 * care-coordination, hmo) are no longer linked; they stay live and in the
 * sitemap until the redirects land in Phase 5.
 */
const FOOTER_LINKS = {
  care: [
    { href: MARKETING_ROUTES.howItWorks, label: "How it works" },
    { href: MARKETING_ROUTES.services, label: "Services" },
    { href: MARKETING_ROUTES.membership, label: "Membership" },
    { href: MARKETING_ROUTES.pricing, label: "Pricing" },
    { href: MARKETING_ROUTES.prevention, label: "Preventive care" },
    { href: MARKETING_ROUTES.chronicCare, label: "Chronic care" },
    { href: MARKETING_ROUTES.resultInterpretation, label: "Understand your lab results" },
    { href: MARKETING_ROUTES.monitoring, label: "Ongoing monitoring" },
    { href: MARKETING_ROUTES.medication, label: "Medication" },
    { href: MARKETING_ROUTES.therapy, label: "Talk to someone" },
    { href: MARKETING_ROUTES.devices, label: "Devices" },
  ],
  forYou: [
    { href: MARKETING_ROUTES.forYou, label: "For individuals" },
    { href: MARKETING_ROUTES.gift, label: "For families" },
    { href: MARKETING_ROUTES.corporate, label: "For employers" },
    { href: MARKETING_ROUTES.labs, label: "Diagnostic services" },
    { href: MARKETING_ROUTES.partners, label: "Our partners" },
    { href: MARKETING_ROUTES.coverage, label: "Where we work" },
  ],
  library: [
    { href: MARKETING_ROUTES.resources, label: "Health library" },
    { href: MARKETING_ROUTES.hypertension, label: "Blood pressure" },
    { href: MARKETING_ROUTES.diabetes, label: "Diabetes" },
    { href: MARKETING_ROUTES.obesity, label: "Weight health" },
    { href: MARKETING_ROUTES.vaccinations, label: "Vaccinations" },
    { href: MARKETING_ROUTES.bmiCalculator, label: "BMI calculator" },
    { href: MARKETING_ROUTES.activityCalculator, label: "Activity calculator" },
    { href: MARKETING_ROUTES.mentalWellbeingCheck, label: "Mental wellbeing check" },
    { href: MARKETING_ROUTES.symptomChecker, label: "Symptom checker" },
  ],
  company: [
    { href: MARKETING_ROUTES.about, label: "About" },
    { href: MARKETING_ROUTES.clinicalApproach, label: "Our clinical approach" },
    { href: MARKETING_ROUTES.accountability, label: "How we are accountable" },
    { href: MARKETING_ROUTES.impact, label: "Our impact" },
    { href: MARKETING_ROUTES.careers, label: "Careers" },
    { href: MARKETING_ROUTES.faq, label: "FAQ" },
    { href: MARKETING_ROUTES.contact, label: "Contact" },
  ],
  legal: [
    { href: MARKETING_ROUTES.privacy, label: "Privacy" },
    { href: MARKETING_ROUTES.terms, label: "Terms of service" },
    { href: MARKETING_ROUTES.telehealthConsent, label: "Telehealth consent" },
    { href: MARKETING_ROUTES.cookies, label: "Cookie Policy" },
    { href: MARKETING_ROUTES.accessibility, label: "Accessibility" },
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

function FooterLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className={`inline-block py-1 text-[15px] text-white/75 hover:text-white ${FOOTER_FOCUS}`}
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
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      {/* h3, under the footer's own visually-hidden h2. These were five <h2>s
          per page, so every page's heading outline ended with "Care",
          "Programmes", "Conditions", "Company", "Business" at the same level
          as its real section headings. */}
      <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
        {title}
      </h3>
      <ul className="mt-4 space-y-1">
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
      <h2 className="sr-only">Site footer</h2>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <div className="space-y-5">
          <BrandLockup tone="on-navy" markClassName="h-10 w-10" wordmarkClassName="text-xl" />
          <div className="space-y-2">
            <p className="font-heading text-lg font-semibold text-white">
              Care that stays with you.
            </p>
            <p className="max-w-xs text-sm leading-relaxed text-white/65">
              Preventive and ongoing healthcare for people in Nigeria: your
              plan, your results and your doctor, in one place.
            </p>
            <p className="text-sm text-white/65">
              <a
                href="mailto:hello@tarragonhealth.ng"
                className={`inline-block py-1 text-white/90 hover:text-white ${FOOTER_FOCUS}`}
              >
                hello@tarragonhealth.ng
              </a>
              <span className="text-white/40"> · </span>
              <a
                href="mailto:support@tarragonhealth.ng"
                className={`inline-block py-1 text-white/90 hover:text-white ${FOOTER_FOCUS}`}
              >
                support@tarragonhealth.ng
              </a>
            </p>
            <p className="text-sm text-white/65">
              <a
                href="tel:+2348061197940"
                className={`inline-block py-1 text-white/90 hover:text-white ${FOOTER_FOCUS}`}
              >
                +234 806 119 7940
              </a>
            </p>
            {/* Registered headquarters, locality level. Care is delivered in
                the app, so this is deliberately not framed as somewhere to
                visit. */}
            <p className="text-sm text-white/65">
              Headquarters: {SITE.headquarters}
            </p>
          </div>
          <SocialLinks />
        </div>

        <FooterGroup title="Care" links={FOOTER_LINKS.care} />
        <FooterGroup title="For you" links={FOOTER_LINKS.forYou} />
        <FooterGroup title="Health library" links={FOOTER_LINKS.library} />
        <FooterGroup title="Company" links={FOOTER_LINKS.company} />
      </div>

      <div className="border-t border-white/10 px-4 py-5 sm:px-6">
        <p className="mx-auto max-w-3xl text-center text-xs leading-relaxed text-white/80">
          <span className="font-semibold text-white">TarragonHealth does not provide emergency care.</span>{" "}
          In a medical emergency, go to your nearest hospital immediately.
        </p>
      </div>

      <div className="border-t border-white/10 px-4 py-6 text-center text-xs text-white/70 sm:px-6">
        <p>
          © {new Date().getFullYear()} TarragonHealth
          <span className="text-white/40"> · </span>
          RC 9702108
          <span className="text-white/40"> · </span>
          Registered with the Nigeria Data Protection Commission
        </p>
        <p className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          {FOOTER_LINKS.legal.map((link, i) => (
            <span key={link.href} className="flex items-center gap-x-3">
              {i > 0 ? <span className="text-white/30">·</span> : null}
              <Link
                href={link.href}
                className={`inline-block py-2 text-white/70 hover:text-white ${FOOTER_FOCUS}`}
              >
                {link.label}
              </Link>
            </span>
          ))}
          <span className="flex items-center gap-x-3">
            <span className="text-white/30">·</span>
            <CookieSettingsLink className={`inline-block py-2 text-white/70 hover:text-white ${FOOTER_FOCUS}`} />
          </span>
        </p>
      </div>
    </footer>
  );
}
