"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./animated-number";
import type { AudienceTab } from "../_content/services";
import { PILL_TONE } from "../_content/pill-tone";

export function AudienceTabs({ tabs }: { tabs: AudienceTab[] }) {
  const [active, setActive] = useState(tabs[0].key);
  const tab = tabs.find((t) => t.key === active) ?? tabs[0];

  // Complete the ARIA tabs contract: tabs and panel reference each other,
  // arrow keys move between tabs, and only the active tab is in the tab
  // order (roving tabindex). Without these, role="tab" announces a control
  // the screen-reader user can't actually navigate.
  const onTablistKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = tabs.findIndex((t) => t.key === active);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    setActive(next.key);
    document.getElementById(`audience-tab-${next.key}`)?.focus();
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Choose your audience"
        className="mb-10 flex flex-wrap justify-center gap-2"
        onKeyDown={onTablistKeyDown}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`audience-tab-${t.key}`}
            aria-controls={`audience-panel-${t.key}`}
            aria-selected={t.key === active}
            tabIndex={t.key === active ? 0 : -1}
            onClick={() => setActive(t.key)}
            className={cn(
              "rounded-full border px-5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
              t.key === active
                ? "border-brand-green bg-brand-green text-white"
                : "border-charcoal-ink/15 bg-white text-charcoal-ink/70 hover:text-charcoal-ink"
            )}
          >
            {t.tabLabel}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`audience-panel-${tab.key}`}
        aria-labelledby={`audience-tab-${tab.key}`}
        className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14"
      >
        <div key={`${tab.key}-content`} className="motion-safe:opacity-0 motion-safe:[animation:marketing-fade-in_0.45s_ease-out_forwards]">
          <h3 className="font-heading text-2xl font-semibold leading-snug text-charcoal-ink sm:text-3xl">
            {tab.title}
          </h3>
          <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">{tab.body}</p>
          <ul className="mt-6 space-y-3">
            {tab.points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm text-charcoal-ink">
                <svg
                  viewBox="0 0 24 24"
                  className="mt-0.5 h-5 w-5 shrink-0 text-brand-green"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
                {point}
              </li>
            ))}
          </ul>
          {tab.cta ? (
            <Link
              href={tab.cta.source ? `${tab.cta.href}?source=${tab.cta.source}` : tab.cta.href}
              className="mt-6 inline-flex text-sm font-medium text-brand-green hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-sm"
            >
              {tab.cta.label} <span aria-hidden>→</span>
            </Link>
          ) : null}
        </div>

        <div
          key={`${tab.key}-stats`}
          className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm motion-safe:opacity-0 motion-safe:[animation:marketing-fade-in_0.45s_ease-out_0.05s_forwards]"
        >
          {tab.stats.map((stat, index) => (
            <div
              key={stat.label}
              className={cn(
                "flex items-center justify-between gap-3 py-3.5",
                index !== tab.stats.length - 1 && "border-b border-charcoal-ink/10"
              )}
            >
              <span className="text-sm font-medium text-charcoal-ink/70">{stat.label}</span>
              <span className="flex items-center gap-2 font-heading text-sm font-semibold text-charcoal-ink">
                <AnimatedNumber value={stat.value} />
                {stat.pill ? (
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", PILL_TONE[stat.pill.tone])}>
                    <AnimatedNumber value={stat.pill.text} />
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
