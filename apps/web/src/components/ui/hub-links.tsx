import Link from "next/link";

/**
 * A quiet row of links to pages that used to have their own menu entry. A hub page shows these so the page is still one tap away after
 * its menu entry is removed (design audit P5).
 */
export function HubLinks({ label, links }: { label: string; links: readonly { href: string; label: string }[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2 text-sm">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="inline-flex min-h-11 items-center rounded-full border border-charcoal-ink/15 px-4 hover:bg-charcoal-ink/5 dark:border-night-ink/20 dark:hover:bg-night-ink/10"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
