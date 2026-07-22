import Link from "next/link";
import { BrandLockup } from "./brand-logo";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

const FOOTER_LINKS = {
  care: [
    { href: MARKETING_ROUTES.services, label: "Services" },
    { href: MARKETING_ROUTES.chronicCare, label: "Chronic care" },
    { href: MARKETING_ROUTES.prevention, label: "Prevention" },
    { href: MARKETING_ROUTES.careCoordination, label: "Care coordination" },
  ],
  programmes: [
    { href: MARKETING_ROUTES.hypertension, label: "Hypertension" },
    { href: MARKETING_ROUTES.diabetes, label: "Diabetes" },
    { href: MARKETING_ROUTES.parentcare, label: "ParentCare" },
    { href: MARKETING_ROUTES.medication, label: "Medication" },
    { href: MARKETING_ROUTES.labs, label: "Labs" },
  ],
  company: [
    { href: MARKETING_ROUTES.pricing, label: "Pricing" },
    { href: MARKETING_ROUTES.whoItsFor, label: "Who it's for" },
    { href: MARKETING_ROUTES.about, label: "About" },
    { href: MARKETING_ROUTES.faq, label: "FAQ" },
    { href: MARKETING_ROUTES.contact, label: "Contact" },
  ],
  business: [
    { href: MARKETING_ROUTES.corporate, label: "Corporate Health" },
    { href: MARKETING_ROUTES.hmo, label: "HMO Support" },
  ],
  platform: [
    { href: "/login", label: "Sign in" },
    { href: "/signup", label: "Start monitoring" },
  ],
};

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
          </div>
        </div>

        <FooterGroup title="Care" links={FOOTER_LINKS.care} />
        <FooterGroup title="Programmes" links={FOOTER_LINKS.programmes} />
        <FooterGroup title="Company" links={FOOTER_LINKS.company} />
        <FooterGroup title="Business" links={FOOTER_LINKS.business} />
        <FooterGroup title="Platform" links={FOOTER_LINKS.platform} />
      </div>

      <div className="border-t border-white/10 px-4 py-5 sm:px-6">
        <p className="mx-auto max-w-3xl text-center text-xs leading-relaxed text-white/80">
          <span className="font-semibold text-white">TarragonHealth does not provide emergency care.</span>{" "}
          In a medical emergency, go to your nearest hospital immediately or call your local
          emergency number.
        </p>
      </div>

      <div className="border-t border-white/10 px-4 py-6 text-center text-xs text-white/70 sm:px-6">
        © {new Date().getFullYear()} TarragonHealth. Health monitoring for Nigerians.
      </div>
    </footer>
  );
}
