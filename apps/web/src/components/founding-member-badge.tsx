import { Sprout } from "lucide-react";
import { t, type Locale } from "@tarragon/i18n";
import { cn } from "@/lib/utils";

/**
 * The "Founding member" badge (founder decision 2026-11-04). Shown only when `public.my_founding_badge()` is true for the signed-in
 * person: the beneficiary of a paid, not refunded, Membership order that used the founding code. The caller reads that; this draws it.
 * Quiet on purpose: words carry the meaning, the sprout is decoration, and nothing moves.
 */
export function FoundingMemberBadge({ locale, className, withDetail = false }: { locale: Locale; className?: string; withDetail?: boolean }) {
  return (
    <span className={cn("inline-flex flex-col gap-1", className)} data-testid="founding-member-badge">
      <span className="inline-flex min-h-7 items-center gap-1.5 self-start rounded-full border border-brand-green/40 bg-soft-sage px-3 py-1 text-xs font-semibold tracking-wide text-deep-forest dark:border-brand-green-bright/40 dark:bg-brand-green/20 dark:text-brand-green-bright">
        <Sprout aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.25} />
        {t("founding.badge", locale)}
      </span>
      {withDetail ? <span className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("founding.badge.detail", locale)}</span> : null}
    </span>
  );
}
