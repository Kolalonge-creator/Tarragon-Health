import Link from "next/link";
import Image from "next/image";
import { MARKETING_ROUTES, MARKETING_ROUTES_BUILT } from "@/lib/marketing/routes";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { key: "hypertension" as const, label: "Hypertension" },
  { key: "diabetes" as const, label: "Diabetes" },
  { key: "parentcare" as const, label: "ParentCare" },
  { key: "prevention" as const, label: "Prevention" },
];

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-charcoal-ink/10 bg-warm-ivory/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href={MARKETING_ROUTES.home} className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-sm">
          <Image
            src="/brand/guard-leaf-mark.png"
            alt=""
            width={36}
            height={36}
            className="h-9 w-9"
            priority
          />
          <span className="font-heading text-lg font-semibold text-brand-green">
            TarragonHealth
          </span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map(({ key, label }) => (
            <Link
              key={key}
              href={MARKETING_ROUTES[key]}
              className={cn(
                "text-sm font-medium text-charcoal-ink/80 transition-colors hover:text-brand-green",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-sm",
                !MARKETING_ROUTES_BUILT.includes(key) && "opacity-50 pointer-events-none"
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden text-sm font-medium text-charcoal-ink/70 hover:text-brand-green sm:inline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-sm px-1"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-9 items-center justify-center rounded-md bg-brand-green px-4 text-sm font-medium text-white transition-colors hover:bg-brand-green/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
          >
            Start monitoring
          </Link>
        </div>
      </div>
    </header>
  );
}
