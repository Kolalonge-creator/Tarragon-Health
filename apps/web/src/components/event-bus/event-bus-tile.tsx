import Link from "next/link";
import { t, type Locale } from "@tarragon/i18n";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { loadSubscriberStatus } from "@/lib/event-bus/load";
import { summarise, summaryTone } from "@/lib/event-bus/model";

/**
 * A health tile for the event bus (S10x), for the admin operations board and the go-live dashboard. It says what is wrong in words
 * (dead deliveries, subscribers falling behind) and links to the explorer. If the read fails it says so; a tile that goes quiet
 * when its own check breaks reads as "all well", which is the failure it exists to catch.
 */
export async function EventBusTile({ locale }: { locale: Locale }) {
  const { rows, failed } = await loadSubscriberStatus();
  if (failed) return <LoadFailure>{t("busops.load_failed", locale)}</LoadFailure>;
  const s = summarise(rows);
  const tone = summaryTone(s);
  const lines: string[] = [];
  if (s.dead > 0) lines.push(t("busops.tile.dead", locale, { count: s.dead }));
  if (s.lagging > 0) lines.push(t("busops.tile.lagging", locale, { count: s.lagging }));
  if (s.waiting > 0) lines.push(t("busops.tile.waiting", locale, { count: s.waiting }));
  if (lines.length === 0) lines.push(t("busops.tile.healthy", locale));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{t("busops.tile.title", locale)}</span>
          <Badge variant={tone}>{tone === "green" ? t("busops.status.done", locale) : tone === "amber" ? t("busops.status.pending", locale) : t("busops.status.dead", locale)}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-charcoal-ink">
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
        <Link href="/admin/ops/event-bus" className="inline-block text-sm font-medium text-brand-green underline">
          {t("busops.tile.open", locale)}
        </Link>
      </CardContent>
    </Card>
  );
}
