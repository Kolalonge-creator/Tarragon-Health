import { t, type Locale } from "@tarragon/i18n";
import { Badge } from "@/components/ui/badge";
import { slaState } from "@/lib/clinician/queue-console";

/** Overdue, or minutes left, from the task's own due time. Renders nothing when there is no due time. */
export function SlaBadge({ dueAt, now, locale = "en" }: { dueAt: string | null | undefined; now: Date; locale?: Locale }) {
  const sla = slaState(dueAt, now);
  if (sla.kind === "overdue") return <Badge variant="red">{t("queue.overdue", locale)}</Badge>;
  if (sla.kind === "due") return <Badge variant="blue">{t("queue.due_in", locale, { minutes: sla.minutes })}</Badge>;
  return null;
}
