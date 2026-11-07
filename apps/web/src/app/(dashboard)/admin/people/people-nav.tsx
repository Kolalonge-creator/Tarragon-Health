import Link from "next/link";

const LINKS = [
  { href: "/admin/people", label: "Overview" },
  { href: "/admin/people/directory", label: "Staff directory" },
  { href: "/admin/people/training", label: "Training" },
  { href: "/admin/people/departments", label: "Departments" },
] as const;

/** The HR area's own tabs (HR Phase A, Training in Phase B). Later phases add Leave and Supervision here. */
export function PeopleNav({ active }: { active: (typeof LINKS)[number]["href"] }) {
  return (
    <nav aria-label="People and HR" className="flex flex-wrap gap-2 border-b pb-2 text-sm">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={l.href === active ? "page" : undefined}
          className={`rounded-md px-3 py-2 ${l.href === active ? "bg-brand-green/10 font-medium text-brand-green" : "hover:bg-charcoal-ink/5"}`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
/** Formats YYYY-MM-DD or a timestamp as a Lagos date. */
export function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  return DATE.format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
}
