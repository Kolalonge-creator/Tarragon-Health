import Image from "next/image";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

/**
 * Factual trust signals only; every claim here maps to something the
 * platform actually enforces (MDCN verification gates on clinical_staff,
 * consent-gated family sharing, hosted Paystack/Stripe checkout, the
 * pricing page's no-hidden-cost promise). Never add a claim that isn't
 * structurally true in the product.
 */
const TRUST_ITEMS = [
  {
    title: "A real care team, always accountable",
    body: "Care is delivered by a team of MDCN-registered doctors. Whoever's covering reviews your case, and every review always carries that doctor's real name, never an anonymous system.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Your record stays yours",
    body: "Your health record is encrypted in transit and at rest, and it is never shared with family members without your consent.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    ),
  },
  {
    title: "Payments handled by Paystack & Stripe",
    body: "Every payment is processed by Paystack (Nigeria) or Stripe (diaspora). Tarragon never stores your card details.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18" />
      </svg>
    ),
  },
  {
    title: "No hidden costs, ever",
    body: "Anything Tarragon itself charges you, you see the exact price and confirm first. Tests and refills you pay the provider directly, and we take nothing on them: all spelled out in full on the pricing page.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M4 7h16M4 12h16M4 17h10" />
      </svg>
    ),
  },
];

export function TrustBand() {
  return (
    <div>
      <div className="grid items-stretch gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-10">
        <div className="relative overflow-hidden rounded-2xl">
          <Image
            src="/marketing/photos/body/trust-care-team.jpg"
            alt="Clinicians talking together in a bright hospital hallway"
            width={1120}
            height={1400}
            className="h-full min-h-[280px] w-full object-cover"
            sizes="(min-width: 1024px) 420px, 100vw"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-clinical-navy/90 to-transparent p-5">
            <p className="text-sm font-medium text-white/85">Your care team, whoever&apos;s covering</p>
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {TRUST_ITEMS.map((item) => (
            <Card key={item.title} variant="dark" className="hover:shadow-none">
              <CardContent className="p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white" aria-hidden>
                  {item.icon}
                </span>
                <h3 className="mt-4 font-heading text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/70">{item.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      <p className="mt-8 text-center text-sm text-white/60">
        Read the full{" "}
        <Link href={MARKETING_ROUTES.howPricingWorks} className="font-medium text-white/85 underline-offset-2 hover:underline">
          No-Hidden-Cost Promise
        </Link>{" "}
        and{" "}
        <Link href={MARKETING_ROUTES.about} className="font-medium text-white/85 underline-offset-2 hover:underline">
          how we work
        </Link>
        , or see{" "}
        <Link href={MARKETING_ROUTES.impact} className="font-medium text-white/85 underline-offset-2 hover:underline">
          our impact
        </Link>{" "}
        in numbers.
      </p>
    </div>
  );
}
