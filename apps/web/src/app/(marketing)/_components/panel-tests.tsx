import type { PanelTestGroup } from "../_content/pricing-ladder";

/** The tests in the yearly blood panel, shown under the Membership Plus card on the pricing page and the homepage. */
export function PanelTests({ groups }: { groups: readonly PanelTestGroup[] }) {
  return (
    <div className="mt-4 rounded-lg bg-brand-green/5 p-4" data-testid="panel-tests">
      <p className="text-sm font-semibold text-charcoal-ink">The yearly blood panel includes</p>
      <dl className="mt-2 space-y-1.5 text-sm leading-relaxed text-charcoal-ink/80">
        {groups.map((g) => (
          <div key={g.heading}>
            <dt className="inline font-medium">{g.heading}: </dt>
            <dd className="inline">{g.tests.join(", ")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
