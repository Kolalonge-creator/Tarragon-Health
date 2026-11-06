import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FREE_PLAN } from "@/lib/marketing/free-plan";

/**
 * The Free plan next to the Membership card (patient dashboard 2.0, spec 15.1: show the two tiers, Free at no cost, and what it
 * includes). Same wording as the public pricing page. Shown only to someone deciding for themselves, never to a Member or while
 * buying for another person.
 */
export function FreePlanCard() {
  return (
    <Card data-testid="free-plan-card">
      <CardHeader>
        <CardTitle>{FREE_PLAN.name}</CardTitle>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{FREE_PLAN.priceLine}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{FREE_PLAN.summary}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {FREE_PLAN.includes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p role="status" className="text-sm font-medium text-deep-forest dark:text-brand-green-bright">
          This is your plan now.
        </p>
      </CardContent>
    </Card>
  );
}
