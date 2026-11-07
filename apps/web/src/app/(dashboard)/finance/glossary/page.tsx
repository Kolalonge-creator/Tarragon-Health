import { FINANCE_TERMS } from "@/lib/finance/definitions";

export const metadata = { title: "Finance glossary" };

/**
 * What each money figure in the finance console means and what it counts.
 * Rendered from lib/finance/definitions.ts, the same entries every KPI links to.
 */
export default function FinanceGlossaryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">Finance glossary</h1>
        <p className="max-w-3xl text-charcoal-ink/60 dark:text-night-ink/60">
          What each figure means and exactly what it counts. Gross payment volume, net collections and recognised revenue
          are different things and are never added together. All amounts are naira, held in kobo, and all dates are Lagos time.
        </p>
      </div>
      <dl className="divide-y divide-charcoal-ink/10 rounded-xl border border-charcoal-ink/10 bg-white dark:divide-night-ink/15 dark:border-night-ink/15 dark:bg-night-card">
        {FINANCE_TERMS.map((t) => (
          <div key={t.key} id={t.key} className="scroll-mt-24 p-5 target:bg-soft-sage/50 dark:target:bg-brand-green/10">
            <dt className="font-heading text-base font-semibold text-charcoal-ink dark:text-night-ink">{t.term}</dt>
            <dd className="mt-1 text-sm text-charcoal-ink dark:text-night-ink">{t.definition}</dd>
            <dd className="mt-1 text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t.basis}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
