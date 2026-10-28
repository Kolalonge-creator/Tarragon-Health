import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { FREE_FEATURES } from "../_content/pricing";
import { paidProductName, renewalCopy } from "@/lib/marketing/membership";

/**
 * Free vs Membership, side by side, for the homepage.
 *
 * Replaces the homepage's old "The app is free. You pay for a doctor, not a
 * subscription" block, which contradicted the pricing page the moment the
 * two-tier model went live (that block said "no monthly fee" and "pay per
 * piece of work" while /pricing sold a ₦120,000 annual Membership).
 *
 * The price and refund window arrive as props from the page, which reads
 * them from versioned config exactly as /pricing does; nothing here types a
 * number. The renewal sentence is deliberately the same as /pricing's:
 * Membership lasts a year and does not renew by itself (there is no stored
 * card to renew against). If auto-renewal is ever built, change this line,
 * the pricing page and _content/pricing.ts together, never one alone.
 */
export function HomePlanCompare({
  price,
  refundDays,
  membershipIncludes,
  autoRenews,
}: {
  price: string;
  refundDays: number;
  membershipIncludes: readonly string[];
  /** The platform's renewal switch; every renewal sentence follows it (see lib/marketing/membership.ts). */
  autoRenews: boolean;
}) {
  return (
    <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
      <Card className="rounded-2xl">
        <CardContent className="flex h-full flex-col p-7">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">The app</p>
          <p className="mt-2 font-heading text-3xl font-bold text-charcoal-ink">Free</p>
          <p className="mt-1 text-sm text-charcoal-ink/65">No time limit. No card needed.</p>
          {/* Derived from the same FREE_FEATURES /pricing renders, so the homepage
              can never promise a free feature the pricing page does not. */}
          <ul className="mt-5 space-y-2 text-sm leading-relaxed text-charcoal-ink/80">
            {FREE_FEATURES.slice(0, 4).map((group) => (
              <li key={group.id}>{group.title}</li>
            ))}
          </ul>
          <div className="mt-auto pt-6">
            <Button asChild variant="outline" size="lg" className="w-full">
              <Link href="/signup">Create your free account</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-brand-green/40 shadow-md">
        <CardContent className="flex h-full flex-col p-7">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">{paidProductName()}</p>
          <p className="mt-2 font-heading text-3xl font-bold text-charcoal-ink">
            ₦{price}
            <span className="text-base font-medium text-charcoal-ink/65"> a year</span>
          </p>
          <p className="mt-1 text-sm text-charcoal-ink/65">Everything in Free, plus:</p>
          <ul className="mt-5 space-y-2 text-sm leading-relaxed text-charcoal-ink/80">
            {membershipIncludes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-charcoal-ink/65">{renewalCopy(autoRenews, refundDays).short}</p>
          <div className="mt-auto pt-6">
            <Button asChild size="lg" variant="accent" className="w-full">
              <Link href="/signup">Get started</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-sm text-charcoal-ink/70 md:col-span-2">
        Buying for a parent or relative?{" "}
        <Link href={MARKETING_ROUTES.gift} className="font-medium text-brand-green underline-offset-2 hover:underline">
          Give them a year of {paidProductName()}
        </Link>
        .
      </p>
      <p className="text-center text-sm text-charcoal-ink/70 md:col-span-2">
        Every price is in naira. You see the exact price and confirm it before anything is charged.{" "}
        <Link
          href={MARKETING_ROUTES.pricing}
          className="font-medium text-brand-green underline-offset-2 hover:underline"
        >
          Full pricing and what is always free
        </Link>
      </p>
    </div>
  );
}
