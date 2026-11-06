import Link from "next/link";
import type { NavSection } from "@/lib/navigation";

/**
 * The governance index (DW-02): every governance, quality, rules and operations page in one place, grouped,
 * so the doctor's sidebar can hold daily clinical work. Plain links in labelled lists; nothing here is gated
 * by this page, each destination keeps its own access check.
 */
export function GovernanceIndex({ sections }: { sections: readonly NavSection[] }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {sections.map((section, index) => {
        const headingId = `gov-${index}`;
        return (
          <section key={section.label ?? index} aria-labelledby={headingId} className="rounded-2xl bg-white p-5">
            <h2 id={headingId} className="font-heading text-lg font-semibold text-charcoal-ink">
              {section.label}
            </h2>
            <ul className="mt-3 divide-y divide-charcoal-ink/10">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex min-h-11 items-center text-sm text-charcoal-ink hover:text-brand-green hover:underline focus-visible:outline-2 focus-visible:outline-brand-green"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
