"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SectionNavItem {
  id: string;
  label: string;
}

/** Sticky chip row that tracks which DashboardSection is in view (scrollspy)
 * and jumps between them. Pure presentation — sections render server-side. */
export function SectionNav({ items }: { items: SectionNavItem[] }) {
  const [activeId, setActiveId] = React.useState<string | null>(items[0]?.id ?? null);

  React.useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the top-most section currently intersecting the reading band.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      // The band starts below the sticky chrome and covers the upper half of
      // the viewport, so the active chip matches what the eye is reading.
      { rootMargin: "-140px 0px -50% 0px" }
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Page sections"
      className="sticky top-[57px] z-30 -mx-4 border-b border-charcoal-ink/10 bg-warm-ivory/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <div className="flex gap-1.5 overflow-x-auto whitespace-nowrap py-0.5 [scrollbar-width:none]">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={activeId === item.id ? "true" : undefined}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              activeId === item.id
                ? "bg-deep-forest text-white"
                : "text-charcoal-ink/60 hover:bg-charcoal-ink/5 hover:text-charcoal-ink"
            )}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
