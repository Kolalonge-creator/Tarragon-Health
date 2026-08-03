"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type PatientRecordTab = {
  id: string;
  label: string;
  content: React.ReactNode;
};

/**
 * Groups the patient record's ~20 independently-fetching sections into a
 * handful of tabs instead of one unbroken scroll every doctor previously had
 * to page past for every patient regardless of condition. Every panel stays
 * mounted (CSS-hidden, not unmounted) when its tab isn't active — a doctor
 * mid-way through a form (e.g. ScreeningResultForm, ObesityEdScreenForm)
 * must never lose typed input just for switching tabs to check something
 * else. No section's own data-fetching, props, or conditional rendering
 * changes — this is purely a layout regrouping of the same JSX.
 */
export function PatientRecordTabs({ tabs }: { tabs: PatientRecordTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);

  return (
    <div>
      <div
        role="tablist"
        aria-label="Patient record sections"
        className="flex gap-1 overflow-x-auto border-b border-charcoal-ink/10 pb-px"
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
                  ? "border-brand-green text-deep-forest"
                  : "border-transparent text-charcoal-ink/55 hover:text-charcoal-ink"
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
