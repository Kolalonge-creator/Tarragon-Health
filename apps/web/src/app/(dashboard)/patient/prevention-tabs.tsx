"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type PreventionTab = {
  id: string;
  label: string;
  /** In-page anchor ids this tab owns — a deep link to any of these lands here. */
  anchorIds?: string[];
  content: React.ReactNode;
};

/**
 * Groups the Prevention hub's sections into tabs instead of one long scroll —
 * patients were missing screenings/vaccinations/risk-assessment content
 * buried below the fold. Every panel stays mounted (CSS-hidden, not
 * unmounted) when its tab isn't active, so an in-progress RiskAssessmentForm
 * never loses typed input just for switching tabs.
 *
 * Onboarding and the Health Check journey (health-check/page.tsx) deep-link
 * here with a URL hash (#health-check, #screenings, #vaccinations,
 * #risk-assessment) expecting the browser's native hash-scroll to land the
 * reader on that section. A hidden tab panel is invisible to that, so we
 * resolve the hash to its owning tab on mount (and again on `hashchange`, in
 * case a link to another anchor is followed while already on this page),
 * switch to it, then scroll the actual anchor element into view once its
 * panel is visible.
 */
export function PreventionTabs({ tabs }: { tabs: PreventionTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);

  useEffect(() => {
    function resolveHash() {
      const hash = window.location.hash.replace("#", "");
      if (!hash) return;
      const owningTab = tabs.find((tab) => tab.anchorIds?.includes(hash));
      if (!owningTab) return;
      setActiveId(owningTab.id);
      requestAnimationFrame(() => {
        document.getElementById(hash)?.scrollIntoView({ block: "start" });
      });
    }
    resolveHash();
    window.addEventListener("hashchange", resolveHash);
    return () => window.removeEventListener("hashchange", resolveHash);
    // Deliberately mount-only: `tabs` is a fresh array/JSX literal every
    // render, so depending on it would re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div
        role="tablist"
        aria-label="Prevention sections"
        className="flex gap-1 overflow-x-auto border-b border-charcoal-ink/10 dark:border-night-ink/15 pb-px"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveId(tab.id)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-t-lg border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "border-brand-green dark:border-brand-green-bright text-deep-forest dark:text-brand-green-bright"
                  : "border-transparent text-charcoal-ink/55 dark:text-night-ink/60 hover:text-charcoal-ink dark:hover:text-night-ink"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} role="tabpanel" hidden={tab.id !== activeId} className="space-y-6 pt-6">
          {tab.content}
        </div>
      ))}
    </div>
  );
}
