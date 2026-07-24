import Link from "next/link";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

/**
 * Factual trust signals only — every claim here maps to something the
 * platform actually enforces (MDCN verification gates on clinical_staff,
 * consent-gated family sharing, hosted Paystack/Stripe checkout, the
 * pricing page's no-hidden-cost promise). Never add a claim that isn't
 * structurally true in the product.
 */
const TRUST_ITEMS = [
  {
    title: "Named, registered doctors",
    body: "Care is delivered by MDCN-registered doctors, and a doctor review always carries the doctor's name — never an anonymous system.",
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
    body: "You see the exact price and confirm before anything is booked or charged — spelled out in full on the pricing page.",
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
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {TRUST_ITEMS.map((item) => (
          <div key={item.title} className="rounded-xl border border-white/15 bg-white/5 p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white" aria-hidden>
              {item.icon}
            </span>
            <h3 className="mt-4 font-heading text-lg font-semibold text-white">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/70">{item.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-8 text-center text-sm text-white/60">
        Read the full{" "}
        <Link href={MARKETING_ROUTES.pricing} className="font-medium text-white/85 underline-offset-2 hover:underline">
          No-Hidden-Cost Promise
        </Link>{" "}
        and{" "}
        <Link href={MARKETING_ROUTES.about} className="font-medium text-white/85 underline-offset-2 hover:underline">
          how we work
        </Link>
        .
      </p>
    </div>
  );
}
