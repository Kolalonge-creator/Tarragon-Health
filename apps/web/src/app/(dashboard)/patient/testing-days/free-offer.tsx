import Link from "next/link";
import { en, t } from "@tarragon/i18n";
import { formatNaira } from "@tarragon/commerce";
import { YEARLY_PANEL_TESTS, type TestingDaysOffer } from "@tarragon/shared";
import { Card, CardContent } from "@/components/ui/card";
import { isMessageKey } from "@/lib/commerce/model";

/**
 * What a Free account sees on Testing days: what a testing day includes and what Membership costs, then the plain "Part of Membership" prompt.
 * The prices and names come from the Membership catalogue (kobo, shown as naira) and the test list from the one yearly-panel list; with no
 * catalogue rows (closed or unreadable) only the prompt shows, never a guessed price.
 */
export function FreeTestingDaysOffer({ offer }: { offer: TestingDaysOffer }) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6" data-testid="testing-days-free-offer">
        <p className="text-sm font-medium text-charcoal-ink">Testing days are part of Membership.</p>
        {offer.showPanelTests ? (
          <div className="space-y-2">
            <p className="text-sm text-charcoal-ink/80">With Membership Plus, your yearly blood tests are taken at a testing day. They cover:</p>
            <dl className="space-y-1.5 text-sm">
              {YEARLY_PANEL_TESTS.map((g) => (
                <div key={g.heading}>
                  <dt className="inline font-medium">{g.heading}: </dt>
                  <dd className="inline">{g.tests.join(", ")}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
        {offer.options.length > 0 ? (
          <ul className="space-y-1 text-sm" aria-label="Membership prices for one year">
            {offer.options.map((o) => (
              <li key={o.code} className="flex justify-between gap-3">
                <span>{isMessageKey(o.nameKey, en) ? t(o.nameKey) : "Membership"}</span>
                <span className="font-medium">{"₦"}{formatNaira(o.amountKobo)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <Link href="/patient/membership" className="inline-flex min-h-11 items-center text-sm font-medium text-brand-green underline">
          See what Membership includes
        </Link>
      </CardContent>
    </Card>
  );
}
