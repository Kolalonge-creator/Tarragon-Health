import { t, type Locale } from "@tarragon/i18n";
import { YEARLY_PANEL_TESTS } from "@/lib/commerce/yearly-panel-tests";

/**
 * The tests in the yearly blood panel, on the Membership Plus card and the upgrade to it. The list is the one the public pricing page shows
 * (lib/commerce/yearly-panel-tests.ts), never typed again here. It is closed until the person opens it, so the payment screen stays short.
 */
export function YearlyPanelTests({ locale, id }: { locale: Locale; id: string }) {
  return (
    <details className="rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15" data-testid={`panel-tests-${id}`}>
      <summary className="min-h-11 cursor-pointer py-2 font-medium">{t("shop.panel_tests.summary", locale)}</summary>
      <dl className="mt-2 space-y-1.5 text-sm">
        {YEARLY_PANEL_TESTS.map((g) => (
          <div key={g.heading}>
            <dt className="inline font-medium">{g.heading}: </dt>
            <dd className="inline">{g.tests.join(", ")}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
