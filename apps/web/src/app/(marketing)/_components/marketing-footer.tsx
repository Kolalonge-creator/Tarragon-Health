import Link from "next/link";
import Image from "next/image";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

const FOOTER_LINKS = {
  services: [
    { href: MARKETING_ROUTES.hypertension, label: "Hypertension" },
    { href: MARKETING_ROUTES.diabetes, label: "Diabetes" },
    { href: MARKETING_ROUTES.parentcare, label: "ParentCare" },
    { href: MARKETING_ROUTES.prevention, label: "Prevention", soon: true },
    { href: MARKETING_ROUTES.medication, label: "Medication", soon: true },
    { href: MARKETING_ROUTES.labs, label: "Labs", soon: true },
  ],
  company: [
    { href: MARKETING_ROUTES.pricing, label: "Pricing", soon: true },
    { href: MARKETING_ROUTES.about, label: "About", soon: true },
    { href: MARKETING_ROUTES.contact, label: "Contact", soon: true },
  ],
};

export function MarketingFooter() {
  return (
    <footer className="border-t border-charcoal-ink/10 bg-clinical-navy text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-3">
        <div className="space-y-4">
          <Image
            src="/brand/guard-leaf-lockup.png"
            alt="TarragonHealth"
            width={160}
            height={48}
            className="h-10 w-auto brightness-0 invert"
          />
          <p className="text-sm text-white/70">Care that stays with you.</p>
        </div>

        <div>
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-white/90">
            Services
          </h2>
          <ul className="mt-4 space-y-2">
            {FOOTER_LINKS.services.map(({ href, label, soon }) => (
              <li key={label}>
                {soon ? (
                  <span className="text-sm text-white/50">{label} (soon)</span>
                ) : (
                  <Link
                    href={href}
                    className="text-sm text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 focus-visible:ring-offset-clinical-navy rounded-sm"
                  >
                    {label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-white/90">
            Company
          </h2>
          <ul className="mt-4 space-y-2">
            {FOOTER_LINKS.company.map(({ href, label, soon }) => (
              <li key={label}>
                {soon ? (
                  <span className="text-sm text-white/50">{label} (soon)</span>
                ) : (
                  <Link
                    href={href}
                    className="text-sm text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 focus-visible:ring-offset-clinical-navy rounded-sm"
                  >
                    {label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 px-4 py-6 text-center text-xs text-white/50 sm:px-6">
        © {new Date().getFullYear()} TarragonHealth. Clinician-led health monitoring for Nigerian families.
      </div>
    </footer>
  );
}
