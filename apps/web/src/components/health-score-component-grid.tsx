"use client";

import Link from "next/link";
import { NAV_ICON } from "@/lib/icons";
import type { HealthScoreComponent } from "@/lib/rules/health-score";
import {
  ALL_HEALTH_SCORE_COMPONENT_KEYS,
  HEALTH_SCORE_COMPONENT_HREF,
  HEALTH_SCORE_COMPONENT_LABEL,
} from "@/lib/rules/health-score-labels";

/**
 * The full "what's behind your score" breakdown, shared by HealthScoreCard,
 * BiologicalAgeCard, and both trend pages so the tile styling/behaviour/link
 * targets can't drift between the four surfaces (they used to each carry
 * their own copy of this grid). Every possible component gets a tile — not
 * just the ones the patient already has data for — so a patient can see
 * everything that could move their score, not only what already has. A
 * component with no data yet renders a "Get started" prompt instead of a
 * number, still linking to the same real action page a completed one does.
 */
export function HealthScoreComponentGrid({
  components,
  columns = 2,
}: {
  components: HealthScoreComponent[];
  columns?: 2 | 3;
}) {
  const byKey = new Map(components.map((c) => [c.key, c]));
  const gridClass =
    columns === 3 ? "grid grid-cols-2 gap-2 sm:grid-cols-3" : "grid grid-cols-2 gap-2";

  return (
    <div className={gridClass}>
      {ALL_HEALTH_SCORE_COMPONENT_KEYS.map((key) => {
        const component = byKey.get(key);
        return (
          <Link
            key={key}
            href={HEALTH_SCORE_COMPONENT_HREF[key]}
            className="group flex flex-col gap-0.5 rounded-lg bg-warm-ivory px-3 py-2.5 transition-colors hover:bg-soft-sage dark:bg-night-ink/10 dark:hover:bg-brand-green/20"
          >
            <span className="flex items-center justify-between gap-1 text-[11px] text-charcoal-ink/55 dark:text-night-ink/55">
              {HEALTH_SCORE_COMPONENT_LABEL[key]}
              <NAV_ICON.chevronRight
                className="h-3 w-3 shrink-0 text-charcoal-ink/30 opacity-0 transition-opacity group-hover:opacity-100 dark:text-night-ink/40"
                strokeWidth={2}
                aria-hidden
              />
            </span>
            {component ? (
              <>
                <span className="text-[17px] font-semibold text-charcoal-ink dark:text-night-ink">
                  {Math.round(component.value)}
                  <span className="text-[11px] font-medium text-charcoal-ink/40 dark:text-night-ink/40">
                    /100
                  </span>
                </span>
                {component.detail && (
                  <span className="text-[11px] text-charcoal-ink/50 dark:text-night-ink/50">
                    {component.detail}
                  </span>
                )}
              </>
            ) : (
              <span className="text-[13px] font-medium text-brand-green dark:text-brand-green-bright">
                Get started
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
