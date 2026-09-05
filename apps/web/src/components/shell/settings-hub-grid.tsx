import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export type SettingsHubItem = {
  href: string;
  label: string;
  blurb: string;
  icon: LucideIcon;
};

/** Card grid for a settings tab's landing page — one card per sub-page. */
export function SettingsHubGrid({ items }: { items: SettingsHubItem[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="group flex flex-col gap-3 rounded-2xl border border-charcoal-ink/10 bg-white p-5 shadow-sm transition-all hover:border-brand-green/40 hover:shadow-md dark:border-night-ink/15 dark:bg-night-card dark:shadow-none"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-soft-sage dark:bg-brand-green/20">
            <item.icon className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-charcoal-ink group-hover:text-deep-forest dark:text-night-ink dark:group-hover:text-brand-green-bright">
              {item.label}
            </span>
            <span className="mt-1 block text-sm text-charcoal-ink/60 dark:text-night-ink/60">{item.blurb}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
