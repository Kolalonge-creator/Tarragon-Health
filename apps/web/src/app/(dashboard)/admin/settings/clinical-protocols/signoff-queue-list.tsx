import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { NAV_ICON } from "@/lib/icons";
import type { SignoffQueueItem } from "@/lib/queries/signoff-queue";

const SEVERITY_BADGE: Record<SignoffQueueItem["severity"], { variant: BadgeProps["variant"]; label: string }> = {
  live_unsigned: { variant: "red", label: "Live, unsigned" },
  draft_pending: { variant: "amber", label: "Ready to sign" },
  setup_needed: { variant: "grey", label: "Needs setup" },
};

/**
 * The single line every outstanding clinical sign-off shows up on,
 * regardless of which of the eight-plus separate pages actually owns it —
 * built because finding "what still needs my signature" meant clicking
 * into every tile on this hub one at a time and reading its own page to
 * find out. Read fresh on every page load (no caching): a stale "nothing to
 * sign" here is the one wrong thing this list could say.
 */
export function SignoffQueueList({ items }: { items: SignoffQueueItem[] }) {
  if (items.length === 0) {
    return (
      <Card className="border-brand-green/30 bg-brand-green/5">
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-charcoal-ink/70">
          <NAV_ICON.review className="h-4 w-4 text-brand-green" strokeWidth={2} aria-hidden />
          Nothing here is waiting on a signature right now.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Needs your signature ({items.length})</CardTitle>
        <CardDescription>
          Every live-unsigned config, pending protocol draft, and clinical rule missing a signature —
          read fresh from the database, not a cached count.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => {
          const badge = SEVERITY_BADGE[item.severity];
          return (
            <Link
              key={item.key}
              href={item.href}
              className="flex items-start justify-between gap-3 rounded-md border border-mist-grey/40 p-3 text-sm transition-colors hover:border-brand-green/50 hover:bg-brand-green/5"
            >
              <div className="min-w-0">
                <p className="font-medium text-charcoal-ink">{item.title}</p>
                <p className="mt-0.5 text-xs text-charcoal-ink/60">{item.detail}</p>
              </div>
              <Badge variant={badge.variant} className="shrink-0">
                {badge.label}
              </Badge>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
