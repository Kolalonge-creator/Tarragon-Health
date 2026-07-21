import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandLockup } from "./(marketing)/_components/brand-logo";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata = {
  title: "Page not found",
  description: "The page you were looking for isn't here.",
};

const LINKS = [
  { href: MARKETING_ROUTES.services, label: "Services" },
  { href: MARKETING_ROUTES.pricing, label: "Pricing" },
  { href: MARKETING_ROUTES.faq, label: "FAQ" },
  { href: MARKETING_ROUTES.contact, label: "Contact" },
];

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-warm-ivory px-4 py-16 text-center text-charcoal-ink">
      <Link
        href={MARKETING_ROUTES.home}
        aria-label="TarragonHealth home"
        className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
      >
        <BrandLockup />
      </Link>

      <p className="mt-12 font-heading text-6xl font-bold text-brand-green sm:text-7xl">404</p>
      <h1 className="mt-4 font-heading text-2xl font-semibold sm:text-3xl">
        We couldn&rsquo;t find that page
      </h1>
      <p className="mt-3 max-w-md text-charcoal-ink/70">
        The link may be old or the page may have moved. Let&rsquo;s get you back to your care.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild size="lg">
          <Link href={MARKETING_ROUTES.home}>Back to home</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/signup">Start monitoring</Link>
        </Button>
      </div>

      <nav aria-label="Helpful links" className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm font-medium text-deep-forest hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-sm"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
