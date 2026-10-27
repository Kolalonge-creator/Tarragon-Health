"use client";

import Link from "next/link";
import { describePending } from "@tarragon/shared";
import { pendingActionLabel, t } from "@tarragon/i18n";
import { useMyPointsPending } from "@/lib/queries/wellness";

/**
 * S58b. Actions that are recorded but whose points are not added yet. Shows what the database says (when it expects them, and
 * whether it is time to ask), invents no hold and no clearing delay, and uses calm wording: nothing here says anything is lost.
 */
export function PendingCredit({ patientId }: { patientId: string }) {
  const { data: items } = useMyPointsPending(patientId);
  if (!items || items.length === 0) return null;
  const askSupport = items.some((i) => i.ask_support);

  return (
    <section aria-labelledby="points-pending" className="rounded-md bg-charcoal-ink/5 p-3 dark:bg-night-ink/10">
      <h3 id="points-pending" className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">{t("points.pending.title")}</h3>
      <p className="mb-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("points.pending.intro")}</p>
      <ul className="divide-y divide-charcoal-ink/10 text-sm dark:divide-night-ink/15">
        {items.map((item) => {
          const d = describePending(item);
          return (
            <li key={item.event_id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-charcoal-ink/80 dark:text-night-ink/80">{pendingActionLabel(item.rule_codes)}</span>
              <span className="shrink-0 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                {d.state === "expected" ? t("points.pending.expected", "en", { time: d.time }) : t("points.pending.later")}
              </span>
            </li>
          );
        })}
      </ul>
      {askSupport && (
        <p className="mt-2 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          {t("points.pending.ask")}{" "}
          <Link href="/patient/support?topic=points" className="font-medium text-brand-green underline dark:text-brand-green-bright">
            {t("points.pending.ask_link")}
          </Link>
        </p>
      )}
    </section>
  );
}
