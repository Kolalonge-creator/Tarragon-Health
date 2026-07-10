import Link from "next/link";
import Image from "next/image";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

const FOOTER_LINKS = {
  priorityProgrammes: [
    { href: MARKETING_ROUTES.hypertension, label: "Hypertension" },
    { href: MARKETING_ROUTES.diabetes, label: "Diabetes" },
    { href: MARKETING_ROUTES.parentcare, label: "ParentCare" },
    { href: MARKETING_ROUTES.prevention, label: "Preventive Health" },
  ],
  coordination: [
    { href: MARKETING_ROUTES.medication, label: "Medication", soon: true },
    { href: MARKETING_ROUTES.labs, label: "Labs", soon: true },
  ],
  company: [
    { href: MARKETING_ROUTES.pricing, label: "Pricing", soon: true },
    { href: MARKETING_ROUTES.about, label: "About", soon: true },
    { href: MARKETING_ROUTES.contact, label: "Contact", soon: true },
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
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]">
        <div className="space-y-5">
          <Image
            src="/brand/guard-leaf-lockup.png"
            alt="TarragonHealth"
            width={160}
            height={48}
            className="h-10 w-auto brightness-0 invert"
          />
          <div className="space-y-2">
            <p className="font-heading text-lg font-semibold text-white">
              Care that stays with you.
            </p>
            <p className="max-w-xs text-sm leading-relaxed text-white/65">
              Clinician-led monitoring for chronic disease, preventive health,
              family care, and the follow-up between visits.
            </p>
          </div>
        </div>

        <FooterGroup title="Priority programmes" links={FOOTER_LINKS.priorityProgrammes} />
        <FooterGroup title="Coordination" links={FOOTER_LINKS.coordination} />
        <FooterGroup title="Company" links={FOOTER_LINKS.company} />
        <FooterGroup title="Platform" links={FOOTER_LINKS.platform} />
      </div>

      <div className="border-t border-white/10 px-4 py-6 text-center text-xs text-white/50 sm:px-6">
        © {new Date().getFullYear()} TarragonHealth. Clinician-led health monitoring for Nigerian families.
      </div>
    </footer>
  );
}
