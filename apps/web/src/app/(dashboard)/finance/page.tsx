import Link from "next/link";
import { Suspense } from "react";
import { FinanceOverview } from "./_components/overview";
import { MoneyOverviewSection } from "./_components/money-overview";

export const metadata = { title: "Financial overview" };

export default function FinanceOverviewPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">Financial overview</h1>
        <p className="text-charcoal-ink/60 dark:text-night-ink/60">
          Revenue, Membership activity, payments, refunds and collections across Tarragon Health. Every figure links to
          its definition in the{" "}
          <Link href="/finance/glossary" className="font-medium text-brand-green hover:underline dark:text-brand-green-bright">
            finance glossary
          </Link>
          .
        </p>
      </div>

      {/* The period comes from the URL, which needs a Suspense boundary in Next 16. */}
      <Suspense fallback={null}>
        <MoneyOverviewSection />
      </Suspense>

      <section aria-labelledby="books-heading" className="space-y-4">
        <div>
          <h2 id="books-heading" className="font-heading text-lg font-semibold text-charcoal-ink dark:text-night-ink">
            The books
          </h2>
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Balances from the general ledger, as at today rather than the period above.
          </p>
        </div>
        <FinanceOverview />
      </section>
    </div>
  );
}
