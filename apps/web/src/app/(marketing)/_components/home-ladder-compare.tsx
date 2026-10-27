import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { renewalCopy } from "@/lib/marketing/membership";
import { LADDER_SAME_CARE_STATEMENT, type LadderCard } from "../_content/pricing-ladder";

/**
 * Free, Membership and Membership Plus side by side, for the homepage, shown only once the ladder is public
 * (marketing.membership_ladder_public). The cards, prices and wording come from the same content the pricing page renders
 * (_content/pricing-ladder.ts, prices formatted from commerce.membership_ladder), so the two pages cannot disagree.
 *
 * Founder rules: three equal cards (no card gets stronger visual weight), the single difference between the two paid plans is the
 * first line of each card, no countdowns or strikethroughs. Free's bullets stay the ones the pricing content already defines.
 */
export function HomeLadderCompare({ cards, refundDays, autoRenews }: { cards: readonly LadderCard[]; refundDays: number; autoRenews: boolean }) {
  return (
    <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-3" data-testid="home-ladder-cards">
      {cards.map((card) => (
        <Card key={card.id} className="rounded-2xl">
          <CardContent className="flex h-full flex-col p-7">
            <p className="text-xs font-semibold uppercase tracking-wide text-deep-forest">{card.difference}</p>
            <h3 className="mt-2 font-heading text-2xl font-bold text-charcoal-ink">{card.name}</h3>
            <p className="mt-1 text-base font-semibold text-charcoal-ink">{card.priceLine}</p>
            <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">{card.summary}</p>
            <ul className="mt-4 space-y-2 text-sm leading-relaxed text-charcoal-ink/80">
              {card.includes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="mt-auto pt-6">
              <Button asChild size="lg" variant={card.id === "free" ? "outline" : "default"} className="w-full">
                <Link href="/signup">{card.id === "free" ? "Create your free account" : "Get started"}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <p className="text-center text-sm text-charcoal-ink/70 md:col-span-3">{LADDER_SAME_CARE_STATEMENT}</p>
      <p className="text-center text-xs leading-relaxed text-charcoal-ink/65 md:col-span-3">{renewalCopy(autoRenews, refundDays).short}</p>
      <p className="text-center text-sm text-charcoal-ink/70 md:col-span-3">
        Buying for a parent or relative?{" "}
        <Link href={MARKETING_ROUTES.gift} className="font-medium text-brand-green underline-offset-2 hover:underline">
          Give them a year of Membership
        </Link>
        . Every price is in naira, and you confirm the exact price before anything is charged.{" "}
        <Link href={MARKETING_ROUTES.pricing} className="font-medium text-brand-green underline-offset-2 hover:underline">
          Full pricing and what is always free
        </Link>
      </p>
    </div>
  );
}
