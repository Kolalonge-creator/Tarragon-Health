import { t, type Locale } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";
import { Badge } from "@/components/ui/badge";
import { slaState } from "@/lib/clinician/queue-console";

function warnWindow(): number | undefined {
  const value = getProposedConfig("queue.sla_warning").value;
  const minutes = typeof value === "object" && value !== null ? (value as { warn_within_minutes?: unknown }).warn_within_minutes : undefined;
  return typeof minutes === "number" ? minutes : undefined;
}

/** Overdue, or minutes left (amber inside the warning window), from the task's own due time. Nothing without a due time. */
export function SlaBadge({ dueAt, now, locale = "en" }: { dueAt: string | null | undefined; now: Date; locale?: Locale }) {
  const sla = slaState(dueAt, now, warnWindow());
  if (sla.kind === "overdue") return <Badge variant="red">{t("queue.overdue", locale)}</Badge>;
  if (sla.kind === "due") return <Badge variant={sla.warn ? "amber" : "blue"}>{t("queue.due_in", locale, { minutes: sla.minutes })}</Badge>;
  return null;
}
