"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AudienceTab } from "../_content/services";

const PILL_TONE = {
  green: "bg-soft-sage text-deep-forest",
  amber: "bg-sprout-gold/15 text-charcoal-ink",
  red: "bg-[#F8E4E1] text-[#B0453B]",
} as const;

export function AudienceTabs({ tabs }: { tabs: AudienceTab[] }) {
  const [active, setActive] = useState(tabs[0].key);
  const tab = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div>
      <div role="tablist" aria-label="Choose your audience" className="mb-10 flex flex-wrap justify-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === active}
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

      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
        <div>
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
              {tab.cta.label} →
            </Link>
          ) : null}
        </div>

        <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
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
                {stat.value}
                {stat.pill ? (
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", PILL_TONE[stat.pill.tone])}>
                    {stat.pill.text}
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
