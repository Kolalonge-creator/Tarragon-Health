"use client";

import { useEffect, useRef, useState } from "react";
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
export function PreventionTabs({ tabs, ariaLabel = "Prevention sections" }: { tabs: PreventionTab[]; ariaLabel?: string }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  // A person who has picked a tab themselves is never moved by a late hash check.
  const pickedByUser = useRef(false);

  // The row scrolls sideways at phone width. Keep the chosen tab fully in view so it never sits clipped at the edge. Only the row
  // scrolls: block "nearest" leaves the page where it is.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [activeId]);

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
    // On a cold load from another page the hash is not always readable the first time this runs (a link to /patient/labs#locations
    // opened on the first tab on production while the same hash changed after load worked). Check once more shortly after, unless
    // the person has already chosen a tab.
    const late = window.setTimeout(() => {
      if (!pickedByUser.current) resolveHash();
    }, 400);
    window.addEventListener("hashchange", resolveHash);
    return () => {
      window.clearTimeout(late);
      window.removeEventListener("hashchange", resolveHash);
    };
    // Deliberately mount-only: `tabs` is a fresh array/JSX literal every
    // render, so depending on it would re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex gap-1 overflow-x-auto border-b border-charcoal-ink/10 pb-px [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] dark:border-night-ink/15 sm:[mask-image:none]"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={isActive ? activeTabRef : undefined}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                pickedByUser.current = true;
                setActiveId(tab.id);
              }}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-t-lg border-b-2 min-h-11 px-3.5 py-2.5 text-sm font-medium transition-colors",
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
