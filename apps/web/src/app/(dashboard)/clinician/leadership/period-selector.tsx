import Link from "next/link";
import { LEADERSHIP_PERIODS, type LeadershipPeriod } from "@tarragon/shared";

/** Plain links (works on a slow connection, keeps the period in the URL so Back and a shared link return to it). */
export function PeriodSelector({ current, showAll = false }: { current: LeadershipPeriod; showAll?: boolean }) {
  return (
    <nav aria-label="Reporting period" className="print:hidden">
      <ul className="flex flex-wrap gap-1 rounded-full bg-white p-1 ring-1 ring-charcoal-ink/10">
        {LEADERSHIP_PERIODS.map((p) => {
          const active = p.key === current;
          return (
            <li key={p.key}>
              <Link
                href={`/clinician/leadership?period=${p.key}${showAll ? "&all=1" : ""}`}
                aria-current={active ? "page" : undefined}
                scroll={false}
                className={`inline-flex min-h-9 items-center rounded-full px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-green ${
                  active ? "bg-brand-green text-white" : "text-charcoal-ink/75 hover:text-brand-green"
                }`}
              >
                {p.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
